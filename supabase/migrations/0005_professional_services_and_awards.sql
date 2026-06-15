create table if not exists public.professional_services (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(user_id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  offering_type text not null default 'service' check (offering_type in ('service', 'product')),
  title text not null,
  description text not null,
  image_url text not null,
  price_min numeric(12, 2) not null check (price_min >= 0),
  price_max numeric(12, 2) not null check (price_max >= 0),
  currency text not null default 'NGN',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_services_price_range_valid check (price_max >= price_min)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'professional-service-images',
  'professional-service-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create index if not exists professional_services_professional_idx
on public.professional_services(professional_id, is_active, created_at desc);

create index if not exists professional_services_category_idx
on public.professional_services(category_id);

drop trigger if exists professional_services_touch_updated_at on public.professional_services;
create trigger professional_services_touch_updated_at
before update on public.professional_services
for each row execute function public.touch_updated_at();

alter table public.professional_services enable row level security;

drop policy if exists "professional services are readable" on public.professional_services;
create policy "professional services are readable"
on public.professional_services for select
to authenticated
using (
  is_active = true
  or professional_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "professionals manage own services" on public.professional_services;
create policy "professionals manage own services"
on public.professional_services for all
to authenticated
using (professional_id = auth.uid() or public.is_admin())
with check (professional_id = auth.uid() or public.is_admin());

grant select on public.professional_services to authenticated;
grant select, insert, update, delete on public.professional_services to service_role;

alter table public.professional_profiles
drop column if exists hourly_rate;

alter table public.jobs
drop constraint if exists budget_range_valid,
drop column if exists budget_min,
drop column if exists budget_max,
drop column if exists budget_type;

update public.jobs
set status = 'open'
where status = 'in_discussion'
  and awarded_to is null;

create or replace function public.apply_to_job(
  p_job_id uuid,
  p_pitch text,
  p_proposed_rate numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_application_id uuid;
begin
  if public.user_role() <> 'professional' then
    raise exception 'Only professionals can apply to jobs';
  end if;

  select client_id into v_client_id
  from public.jobs
  where id = p_job_id
    and status = 'open'
    and awarded_to is null
    and public.professional_can_see_job(category_id)
  for update;

  if v_client_id is null then
    raise exception 'Job is not open or not visible to this professional';
  end if;

  insert into public.applications (job_id, professional_id, pitch, proposed_rate)
  values (p_job_id, auth.uid(), p_pitch, p_proposed_rate)
  returning id into v_application_id;

  update public.jobs
  set applications_count = applications_count + 1
  where id = p_job_id;

  insert into public.messages (sender_id, receiver_id, job_id, application_id, body)
  values (auth.uid(), v_client_id, p_job_id, v_application_id, p_pitch);

  insert into public.notifications (user_id, type, title, body, data, channel)
  values (
    v_client_id,
    'application_received',
    'New application received',
    'A professional applied to your job.',
    jsonb_build_object('job_id', p_job_id, 'application_id', v_application_id),
    'in_app'
  );

  insert into public.job_progress (job_id, status, note, updated_by)
  values (p_job_id, 'in_discussion', 'A professional submitted an offer.', auth.uid());

  return v_application_id;
end;
$$;

create or replace function public.award_application(
  p_application_id uuid,
  p_agreed_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_job_title text;
  v_client_id uuid;
  v_professional_id uuid;
  v_application_status text;
  v_job_status text;
begin
  select a.job_id, j.title, j.client_id, a.professional_id, a.status, j.status
  into v_job_id, v_job_title, v_client_id, v_professional_id, v_application_status, v_job_status
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.id = p_application_id
  for update of j, a;

  if v_job_id is null or v_client_id <> auth.uid() then
    raise exception 'Application not found or not owned by this client';
  end if;

  if v_job_status not in ('open', 'in_discussion') then
    raise exception 'Job cannot be awarded from its current status';
  end if;

  if v_application_status not in ('pending', 'reviewed', 'shortlisted') then
    raise exception 'Application cannot be awarded from its current status';
  end if;

  update public.jobs
  set status = 'awarded',
      awarded_to = v_professional_id,
      agreed_amount = p_agreed_amount
  where id = v_job_id;

  update public.applications
  set status = case when id = p_application_id then 'awarded' else 'rejected' end
  where job_id = v_job_id;

  insert into public.job_progress (job_id, status, note, updated_by)
  values (v_job_id, 'awarded', 'Client awarded the job to a professional.', auth.uid());

  insert into public.notifications (user_id, type, title, body, data, channel)
  values (
    v_professional_id,
    'job_awarded',
    'You were awarded a job',
    'A client selected your offer for "' || v_job_title || '".',
    jsonb_build_object('job_id', v_job_id, 'application_id', p_application_id),
    'in_app'
  );

  insert into public.notifications (user_id, type, title, body, data, channel)
  select
    a.professional_id,
    'application_not_selected',
    'Job awarded to another professional',
    'The client selected another offer for "' || v_job_title || '".',
    jsonb_build_object('job_id', v_job_id, 'application_id', a.id),
    'in_app'
  from public.applications a
  where a.job_id = v_job_id
    and a.id <> p_application_id;

  return v_job_id;
end;
$$;

grant execute on function public.apply_to_job(uuid, text, numeric) to authenticated, service_role;
grant execute on function public.award_application(uuid, numeric) to authenticated, service_role;

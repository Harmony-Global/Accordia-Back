create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  phone text unique not null,
  role text not null check (role in ('professional', 'client', 'admin')),
  first_name text not null,
  last_name text not null,
  avatar_url text,
  phone_verified boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.profiles(id) on delete cascade,
  bio text,
  years_experience integer not null default 0 check (years_experience >= 0),
  hourly_rate numeric(12, 2) check (hourly_rate >= 0),
  location text,
  state text,
  is_available boolean not null default true,
  total_jobs_completed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  icon text,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.professional_categories (
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (professional_id, category_id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  title text not null,
  description text not null,
  budget_min numeric(12, 2) check (budget_min >= 0),
  budget_max numeric(12, 2) check (budget_max >= 0),
  budget_type text not null default 'fixed' check (budget_type in ('fixed', 'hourly')),
  currency text not null default 'NGN',
  location text,
  state text,
  is_remote boolean not null default false,
  status text not null default 'open' check (
    status in ('open', 'in_discussion', 'awarded', 'in_progress', 'in_review', 'delivered', 'closed', 'cancelled')
  ),
  awarded_to uuid references public.profiles(id),
  views_count integer not null default 0,
  applications_count integer not null default 0,
  agreed_amount numeric(12, 2) check (agreed_amount >= 0),
  payment_note text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_range_valid check (budget_max is null or budget_min is null or budget_max >= budget_min)
);

create table public.job_views (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  unique (job_id, professional_id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  pitch text not null,
  proposed_rate numeric(12, 2) check (proposed_rate >= 0),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'shortlisted', 'rejected', 'awarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, professional_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.job_progress (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null check (
    status in ('posted', 'in_discussion', 'awarded', 'in_progress', 'in_review', 'delivered', 'closed', 'cancelled')
  ),
  note text,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'phone' check (type in ('phone')),
  value text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, type)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text,
  body text,
  data jsonb not null default '{}',
  is_read boolean not null default false,
  channel text not null default 'email' check (channel in ('email', 'sms', 'in_app')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);
create index professional_profiles_user_idx on public.professional_profiles(user_id);
create index professional_profiles_state_idx on public.professional_profiles(state);
create index categories_active_sort_idx on public.categories(is_active, sort_order);
create index professional_categories_category_idx on public.professional_categories(category_id);
create index jobs_client_idx on public.jobs(client_id);
create index jobs_category_idx on public.jobs(category_id);
create index jobs_status_idx on public.jobs(status);
create index jobs_state_idx on public.jobs(state);
create index jobs_created_idx on public.jobs(created_at desc);
create index job_views_job_idx on public.job_views(job_id);
create index applications_job_idx on public.applications(job_id);
create index applications_pro_idx on public.applications(professional_id);
create index messages_participants_idx on public.messages(sender_id, receiver_id, created_at desc);
create index messages_receiver_unread_idx on public.messages(receiver_id, is_read);
create index job_progress_job_idx on public.job_progress(job_id, created_at desc);
create index verifications_status_idx on public.verifications(status);
create index notifications_user_idx on public.notifications(user_id, is_read, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger professional_profiles_touch_updated_at
before update on public.professional_profiles
for each row execute function public.touch_updated_at();

create trigger jobs_touch_updated_at
before update on public.jobs
for each row execute function public.touch_updated_at();

create trigger applications_touch_updated_at
before update on public.applications
for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role = 'admin'
    and is_active = true
  );
$$;

create or replace function public.user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.professional_can_see_job(job_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.professional_profiles pp
    join public.professional_categories pc on pc.professional_id = pp.id
    where pp.user_id = auth.uid()
      and pp.is_available = true
      and pc.category_id = job_category_id
  );
$$;

create or replace function public.record_job_view(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.user_role() <> 'professional' then
    raise exception 'Only professionals can record job views';
  end if;

  if not exists (
    select 1 from public.jobs j
    where j.id = p_job_id
      and j.status in ('open', 'in_discussion')
      and public.professional_can_see_job(j.category_id)
  ) then
    raise exception 'Job is not visible to this professional';
  end if;

  insert into public.job_views (job_id, professional_id)
  values (p_job_id, auth.uid())
  on conflict do nothing;

  if found then
    update public.jobs
    set views_count = views_count + 1
    where id = p_job_id;
  end if;
end;
$$;

create or replace function public.apply_to_job(p_job_id uuid, p_pitch text, p_proposed_rate numeric default null)
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
    and public.professional_can_see_job(category_id);

  if v_client_id is null then
    raise exception 'Job is not open or not visible to this professional';
  end if;

  insert into public.applications (job_id, professional_id, pitch, proposed_rate)
  values (p_job_id, auth.uid(), p_pitch, p_proposed_rate)
  returning id into v_application_id;

  update public.jobs
  set applications_count = applications_count + 1,
      status = 'in_discussion'
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
    'email'
  );

  insert into public.job_progress (job_id, status, note, updated_by)
  values (p_job_id, 'in_discussion', 'A professional applied and discussion started.', auth.uid());

  return v_application_id;
end;
$$;

create or replace function public.award_application(p_application_id uuid, p_agreed_amount numeric default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_client_id uuid;
  v_professional_id uuid;
begin
  select a.job_id, j.client_id, a.professional_id
  into v_job_id, v_client_id, v_professional_id
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.id = p_application_id;

  if v_job_id is null or v_client_id <> auth.uid() then
    raise exception 'Application not found or not owned by this client';
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
    'A client selected you for a job on Accordia.',
    jsonb_build_object('job_id', v_job_id, 'application_id', p_application_id),
    'email'
  );

  return v_job_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.professional_categories enable row level security;
alter table public.jobs enable row level security;
alter table public.job_views enable row level security;
alter table public.applications enable row level security;
alter table public.messages enable row level security;
alter table public.job_progress enable row level security;
alter table public.verifications enable row level security;
alter table public.notifications enable row level security;

create policy "profiles are readable to authenticated users"
on public.profiles for select
to authenticated
using (is_active = true);

create policy "users can insert own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

create policy "professional profile visible to authenticated users"
on public.professional_profiles for select
to authenticated
using (true);

create policy "professionals manage own profile"
on public.professional_profiles for all
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create policy "categories are public to authenticated users"
on public.categories for select
to authenticated
using (is_active = true);

create policy "admins manage categories"
on public.categories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "professionals manage own categories"
on public.professional_categories for all
to authenticated
using (
  exists (
    select 1 from public.professional_profiles pp
    where pp.id = professional_id and pp.user_id = auth.uid()
  ) or public.is_admin()
)
with check (
  exists (
    select 1 from public.professional_profiles pp
    where pp.id = professional_id and pp.user_id = auth.uid()
  ) or public.is_admin()
);

create policy "professionals read own category links"
on public.professional_categories for select
to authenticated
using (
  exists (
    select 1 from public.professional_profiles pp
    where pp.id = professional_id and pp.user_id = auth.uid()
  ) or public.is_admin()
);

create policy "clients read own jobs and pros read matching jobs"
on public.jobs for select
to authenticated
using (
  client_id = auth.uid()
  or awarded_to = auth.uid()
  or public.is_admin()
  or (status in ('open', 'in_discussion') and public.professional_can_see_job(category_id))
);

create policy "clients create jobs"
on public.jobs for insert
to authenticated
with check (client_id = auth.uid() and public.user_role() = 'client');

create policy "clients and admins update jobs"
on public.jobs for update
to authenticated
using (client_id = auth.uid() or public.is_admin())
with check (client_id = auth.uid() or public.is_admin());

create policy "job views readable by job client or viewing pro"
on public.job_views for select
to authenticated
using (
  professional_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.jobs j where j.id = job_id and j.client_id = auth.uid())
);

create policy "applications visible to job client or applicant"
on public.applications for select
to authenticated
using (
  professional_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.jobs j where j.id = job_id and j.client_id = auth.uid())
);

create policy "messages visible to participants"
on public.messages for select
to authenticated
using (sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin());

create policy "participants can send messages"
on public.messages for insert
to authenticated
with check (sender_id = auth.uid());

create policy "receiver can mark messages read"
on public.messages for update
to authenticated
using (receiver_id = auth.uid() or public.is_admin())
with check (receiver_id = auth.uid() or public.is_admin());

create policy "progress visible to job participants"
on public.job_progress for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.jobs j
    where j.id = job_id
      and (j.client_id = auth.uid() or j.awarded_to = auth.uid() or public.professional_can_see_job(j.category_id))
  )
);

create policy "progress insert by job participants"
on public.job_progress for insert
to authenticated
with check (
  updated_by = auth.uid()
  and exists (
    select 1 from public.jobs j
    where j.id = job_id
      and (j.client_id = auth.uid() or j.awarded_to = auth.uid() or public.is_admin())
  )
);

create policy "users read own verification"
on public.verifications for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "users create own phone verification"
on public.verifications for insert
to authenticated
with check (user_id = auth.uid() and type = 'phone');

create policy "admins update verification"
on public.verifications for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users read own notifications"
on public.notifications for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "users update own notifications"
on public.notifications for update
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant select on public.categories to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.professional_profiles to authenticated;
grant select, insert, update, delete on public.professional_categories to authenticated;
grant select, insert, update on public.jobs to authenticated;
grant select, insert on public.job_views to authenticated;
grant select, insert, update on public.applications to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select, insert on public.job_progress to authenticated;
grant select, insert, update on public.verifications to authenticated;
grant select, update on public.notifications to authenticated;

grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.user_role() to authenticated, service_role;
grant execute on function public.professional_can_see_job(uuid) to authenticated, service_role;
grant execute on function public.record_job_view(uuid) to authenticated, service_role;
grant execute on function public.apply_to_job(uuid, text, numeric) to authenticated, service_role;
grant execute on function public.award_application(uuid, numeric) to authenticated, service_role;

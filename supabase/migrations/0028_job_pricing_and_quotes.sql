alter table public.jobs
add column if not exists price_type text not null default 'negotiable',
add column if not exists price_amount numeric(12, 2);

alter table public.jobs
drop constraint if exists jobs_price_type_check,
add constraint jobs_price_type_check check (price_type in ('fixed', 'negotiable'));

alter table public.jobs
drop constraint if exists jobs_price_amount_check,
add constraint jobs_price_amount_check check (price_amount is null or price_amount >= 0);

create table if not exists public.job_quotes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.job_conversations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'sent' check (status in ('sent', 'review_requested', 'accepted', 'superseded')),
  project_title text not null,
  project_description text not null,
  total_budget numeric(12, 2) not null check (total_budget >= 0),
  duration_days integer not null check (duration_days between 1 and 365),
  attachments jsonb not null default '[]'::jsonb,
  review_note text,
  created_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  review_requested_by uuid references public.profiles(id) on delete set null,
  review_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_quotes_conversation_idx
on public.job_quotes(conversation_id, created_at desc);

create index if not exists job_quotes_job_idx
on public.job_quotes(job_id, created_at desc);

create unique index if not exists job_quotes_one_accepted_per_conversation_idx
on public.job_quotes(conversation_id)
where status = 'accepted';

drop trigger if exists job_quotes_touch_updated_at on public.job_quotes;
create trigger job_quotes_touch_updated_at
before update on public.job_quotes
for each row execute function public.touch_updated_at();

alter table public.job_quotes enable row level security;

drop policy if exists "job quotes visible to participants" on public.job_quotes;
create policy "job quotes visible to participants"
on public.job_quotes for select
to authenticated
using (
  client_id = auth.uid()
  or professional_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "service role manages job quotes" on public.job_quotes;
create policy "service role manages job quotes"
on public.job_quotes for all
to service_role
using (true)
with check (true);

grant select on public.job_quotes to authenticated;
grant select, insert, update, delete on public.job_quotes to service_role;

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
  v_application_deleted_at timestamptz;
  v_price_type text;
  v_price_amount numeric;
  v_proposed_rate numeric;
begin
  if public.user_role() <> 'professional' then
    raise exception 'Only professionals can apply to jobs';
  end if;

  select id, deleted_at into v_application_id, v_application_deleted_at
  from public.applications
  where job_id = p_job_id
    and professional_id = auth.uid();

  if v_application_id is not null then
    if v_application_deleted_at is not null then
      raise exception 'Application was deleted and cannot be sent again';
    end if;

    return v_application_id;
  end if;

  select client_id, price_type, price_amount
  into v_client_id, v_price_type, v_price_amount
  from public.jobs
  where id = p_job_id
    and status = 'open'
    and awarded_to is null
    and public.professional_can_see_job(category_id)
  for update;

  if v_client_id is null then
    raise exception 'Job is not open or not visible to this professional';
  end if;

  v_proposed_rate := case
    when v_price_type = 'fixed' then v_price_amount
    else p_proposed_rate
  end;

  insert into public.applications (job_id, professional_id, pitch, proposed_rate)
  values (p_job_id, auth.uid(), p_pitch, v_proposed_rate)
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

grant execute on function public.apply_to_job(uuid, text, numeric) to authenticated, service_role;

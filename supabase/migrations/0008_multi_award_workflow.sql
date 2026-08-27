alter table public.applications
drop constraint if exists applications_status_check;

alter table public.applications
add constraint applications_status_check check (
  status in ('pending', 'reviewed', 'shortlisted', 'selected', 'awarded', 'not_awarded', 'rejected')
);

create table if not exists public.job_awards (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  agreed_amount numeric(12, 2) check (agreed_amount >= 0),
  created_at timestamptz not null default now(),
  unique (application_id),
  unique (job_id, professional_id)
);

create table if not exists public.application_award_audit_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  professional_id uuid references public.profiles(id) on delete set null,
  client_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('selected', 'selection_removed', 'sealed')),
  previous_status text,
  next_status text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists job_awards_job_idx
on public.job_awards(job_id, created_at desc);

create index if not exists job_awards_professional_idx
on public.job_awards(professional_id, created_at desc);

create index if not exists application_award_audit_job_idx
on public.application_award_audit_logs(job_id, created_at desc);

create index if not exists application_award_audit_application_idx
on public.application_award_audit_logs(application_id, created_at desc);

alter table public.job_awards enable row level security;
alter table public.application_award_audit_logs enable row level security;

drop policy if exists "job awards visible to participants" on public.job_awards;
create policy "job awards visible to participants"
on public.job_awards for select
to authenticated
using (
  professional_id = auth.uid()
  or client_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "admins read award audit logs" on public.application_award_audit_logs;
create policy "admins read award audit logs"
on public.application_award_audit_logs for select
to authenticated
using (public.is_admin());

grant select on public.job_awards to authenticated;
grant select, insert, update, delete on public.job_awards to service_role;
grant select on public.application_award_audit_logs to authenticated;
grant select, insert on public.application_award_audit_logs to service_role;

drop function if exists public.award_application(uuid, numeric);
create function public.award_application(
  p_application_id uuid,
  p_agreed_amount numeric default null
)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_previous_status text;
  v_job_id uuid;
  v_client_id uuid;
  v_job_status text;
begin
  select a.*
  into v_application
  from public.applications a
  where a.id = p_application_id
  for update;

  if v_application.id is not null then
    select j.id, j.client_id, j.status
    into v_job_id, v_client_id, v_job_status
    from public.jobs j
    where j.id = v_application.job_id
    for update;
  end if;

  if v_application.id is null or v_client_id <> auth.uid() then
    raise exception 'Application not found or not owned by this client';
  end if;

  if v_job_status not in ('open', 'in_discussion') then
    raise exception 'Job cannot be changed from its current status';
  end if;

  if v_application.status = 'selected' then
    return v_application;
  end if;

  if v_application.status not in ('pending', 'reviewed', 'shortlisted') then
    raise exception 'Application cannot be selected from its current status';
  end if;

  v_previous_status := v_application.status;

  update public.applications
  set status = 'selected'
  where id = p_application_id
  returning * into v_application;

  insert into public.application_award_audit_logs (
    job_id,
    application_id,
    professional_id,
    client_id,
    action,
    previous_status,
    next_status,
    metadata
  )
  values (
    v_application.job_id,
    v_application.id,
    v_application.professional_id,
    auth.uid(),
    'selected',
    v_previous_status,
    'selected',
    jsonb_build_object('agreed_amount', p_agreed_amount)
  );

  return v_application;
end;
$$;

create or replace function public.undo_award_application(p_application_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_restore_status text;
  v_job_id uuid;
  v_client_id uuid;
  v_job_status text;
begin
  select a.*
  into v_application
  from public.applications a
  where a.id = p_application_id
  for update;

  if v_application.id is not null then
    select j.id, j.client_id, j.status
    into v_job_id, v_client_id, v_job_status
    from public.jobs j
    where j.id = v_application.job_id
    for update;
  end if;

  if v_application.id is null or v_client_id <> auth.uid() then
    raise exception 'Application not found or not owned by this client';
  end if;

  if v_job_status not in ('open', 'in_discussion') then
    raise exception 'Awards are already sealed for this job';
  end if;

  if v_application.status <> 'selected' then
    raise exception 'Only selected applications can be undone';
  end if;

  select previous_status
  into v_restore_status
  from public.application_award_audit_logs
  where application_id = p_application_id
    and action = 'selected'
  order by created_at desc
  limit 1;

  if v_restore_status not in ('pending', 'reviewed', 'shortlisted') then
    v_restore_status := 'pending';
  end if;

  update public.applications
  set status = v_restore_status
  where id = p_application_id
  returning * into v_application;

  insert into public.application_award_audit_logs (
    job_id,
    application_id,
    professional_id,
    client_id,
    action,
    previous_status,
    next_status
  )
  values (
    v_application.job_id,
    v_application.id,
    v_application.professional_id,
    auth.uid(),
    'selection_removed',
    'selected',
    v_restore_status
  );

  return v_application;
end;
$$;

create or replace function public.seal_job_awards(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_selected_application_ids uuid[];
  v_first_professional_id uuid;
begin
  select *
  into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if v_job.id is null or v_job.client_id <> auth.uid() then
    raise exception 'Job not found or not owned by this client';
  end if;

  if v_job.status not in ('open', 'in_discussion') then
    raise exception 'Job awards are already sealed';
  end if;

  select array_agg(a.id order by a.created_at), (array_agg(a.professional_id order by a.created_at))[1]
  into v_selected_application_ids, v_first_professional_id
  from public.applications a
  where a.job_id = p_job_id
    and a.status = 'selected';

  if v_selected_application_ids is null or array_length(v_selected_application_ids, 1) = 0 then
    raise exception 'Select at least one application before sealing awards';
  end if;

  insert into public.job_awards (job_id, application_id, professional_id, client_id)
  select a.job_id, a.id, a.professional_id, v_job.client_id
  from public.applications a
  where a.id = any(v_selected_application_ids)
  on conflict do nothing;

  update public.applications
  set status = 'awarded'
  where id = any(v_selected_application_ids);

  insert into public.application_award_audit_logs (
    job_id,
    application_id,
    professional_id,
    client_id,
    action,
    previous_status,
    next_status
  )
  select
    a.job_id,
    a.id,
    a.professional_id,
    v_job.client_id,
    'sealed',
    'selected',
    'awarded'
  from public.applications a
  where a.id = any(v_selected_application_ids);

  with candidates as (
    select id, job_id, professional_id, status as previous_status
    from public.applications
    where job_id = p_job_id
      and status in ('pending', 'reviewed', 'shortlisted')
  ),
  not_awarded as (
    update public.applications
    set status = 'not_awarded'
    from candidates
    where public.applications.id = candidates.id
    returning public.applications.id, public.applications.job_id, public.applications.professional_id, candidates.previous_status
  )
  insert into public.application_award_audit_logs (
    job_id,
    application_id,
    professional_id,
    client_id,
    action,
    previous_status,
    next_status
  )
  select
    job_id,
    id,
    professional_id,
    v_job.client_id,
    'sealed',
    previous_status,
    'not_awarded'
  from not_awarded;

  update public.jobs
  set status = 'awarded',
      awarded_to = v_first_professional_id
  where id = p_job_id;

  insert into public.job_progress (job_id, status, note, updated_by)
  values (p_job_id, 'awarded', 'Client sealed awarded professionals for this job.', auth.uid());

  insert into public.notifications (user_id, type, title, body, data, channel)
  select
    a.professional_id,
    'job_awarded',
    'You were awarded a job',
    'A client selected you for "' || v_job.title || '".',
    jsonb_build_object('job_id', p_job_id, 'application_id', a.id),
    'in_app'
  from public.applications a
  where a.id = any(v_selected_application_ids);

  insert into public.notifications (user_id, type, title, body, data, channel)
  select
    a.professional_id,
    'application_not_awarded',
    'Job awarded to other professionals',
    'The client awarded "' || v_job.title || '" to other professionals.',
    jsonb_build_object('job_id', p_job_id, 'application_id', a.id),
    'in_app'
  from public.applications a
  where a.job_id = p_job_id
    and a.status = 'not_awarded';

  return jsonb_build_object(
    'job_id', p_job_id,
    'awarded_application_ids', v_selected_application_ids
  );
end;
$$;

create or replace function public.is_job_participant(p_job_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and (
        j.client_id = p_user_id
        or j.awarded_to = p_user_id
        or exists (
          select 1
          from public.job_awards ja
          where ja.job_id = j.id
            and ja.professional_id = p_user_id
        )
        or exists (
          select 1
          from public.applications a
          where a.job_id = j.id
            and a.professional_id = p_user_id
        )
        or public.is_admin()
      )
  );
$$;

create or replace function public.can_message_for_job(
  p_job_id uuid,
  p_sender_id uuid,
  p_receiver_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and (
        (j.client_id = p_sender_id and (
          j.awarded_to = p_receiver_id
          or exists (
            select 1 from public.job_awards ja
            where ja.job_id = j.id and ja.professional_id = p_receiver_id
          )
          or exists (
            select 1 from public.applications a
            where a.job_id = j.id and a.professional_id = p_receiver_id
          )
        ))
        or (j.client_id = p_receiver_id and (
          j.awarded_to = p_sender_id
          or exists (
            select 1 from public.job_awards ja
            where ja.job_id = j.id and ja.professional_id = p_sender_id
          )
          or exists (
            select 1 from public.applications a
            where a.job_id = j.id and a.professional_id = p_sender_id
          )
        ))
      )
  );
$$;

create or replace function public.has_job_application(p_job_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    where a.job_id = p_job_id
      and a.professional_id = p_user_id
  );
$$;

create or replace function public.has_job_award(p_job_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.job_awards ja
    where ja.job_id = p_job_id
      and ja.professional_id = p_user_id
  );
$$;

create or replace function public.add_job_progress(
  p_job_id uuid,
  p_status text,
  p_note text default null
)
returns public.job_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_progress public.job_progress;
  v_is_awarded_professional boolean;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  select exists (
    select 1 from public.job_awards ja
    where ja.job_id = p_job_id
      and ja.professional_id = auth.uid()
  ) into v_is_awarded_professional;

  if not (
    v_job.client_id = auth.uid()
    or v_job.awarded_to = auth.uid()
    or v_is_awarded_professional
    or public.is_admin()
  ) then
    raise exception 'Only job participants can update progress';
  end if;

  if p_status = 'cancelled' then
    if not (v_job.client_id = auth.uid() or public.is_admin()) then
      raise exception 'Only the client or an admin can cancel a job';
    end if;
    if v_job.status in ('closed', 'cancelled') then
      raise exception 'Job is already final';
    end if;
  elsif not (
    (v_job.status = 'awarded' and p_status = 'in_progress')
    or (v_job.status = 'in_progress' and p_status = 'in_review')
    or (v_job.status = 'in_review' and p_status = 'delivered')
    or (v_job.status = 'delivered' and p_status = 'closed')
  ) then
    raise exception 'Invalid job status transition';
  end if;

  update public.jobs
  set status = p_status
  where id = p_job_id;

  insert into public.job_progress (job_id, status, note, updated_by)
  values (p_job_id, p_status, p_note, auth.uid())
  returning * into v_progress;

  return v_progress;
end;
$$;

drop policy if exists "clients read own jobs and pros read matching jobs" on public.jobs;
create policy "clients read own jobs and pros read matching jobs"
on public.jobs for select
to authenticated
using (
  client_id = auth.uid()
  or awarded_to = auth.uid()
  or public.is_admin()
  or public.has_job_award(id, auth.uid())
  or public.has_job_application(id, auth.uid())
  or (status = 'open' and public.professional_can_see_job(category_id))
);

drop policy if exists "progress visible to actual job participants" on public.job_progress;
drop policy if exists "progress visible to job participants" on public.job_progress;
create policy "progress visible to actual job participants"
on public.job_progress for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.jobs j
    where j.id = job_id
      and (
        j.client_id = auth.uid()
        or j.awarded_to = auth.uid()
        or public.has_job_award(j.id, auth.uid())
        or public.has_job_application(j.id, auth.uid())
        or (
          j.status = 'open'
          and public.professional_can_see_job(j.category_id)
        )
      )
  )
);

grant execute on function public.award_application(uuid, numeric) to authenticated, service_role;
grant execute on function public.undo_award_application(uuid) to authenticated, service_role;
grant execute on function public.seal_job_awards(uuid) to authenticated, service_role;
grant execute on function public.is_job_participant(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_message_for_job(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.has_job_application(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_job_award(uuid, uuid) to authenticated, service_role;
grant execute on function public.add_job_progress(uuid, text, text) to authenticated, service_role;

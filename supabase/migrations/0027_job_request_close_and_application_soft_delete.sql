alter table public.applications
add column if not exists deleted_at timestamptz,
add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
add column if not exists deleted_reason text;

create index if not exists applications_active_professional_idx
on public.applications(professional_id, created_at desc)
where deleted_at is null;

create index if not exists applications_active_job_idx
on public.applications(job_id, created_at desc)
where deleted_at is null;

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

create or replace function public.close_job_request(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_closed_job public.jobs;
  v_closed_application_ids uuid[];
begin
  select *
  into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not (v_job.client_id = auth.uid() or public.is_admin()) then
    raise exception 'Only the client or an admin can close this job request';
  end if;

  if v_job.status = 'closed' then
    raise exception 'Job request is already closed';
  end if;

  if v_job.status not in ('open', 'in_discussion') then
    raise exception 'Only open job requests can be closed manually';
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
  into v_closed_application_ids
  from public.applications
  where job_id = p_job_id
    and deleted_at is null
    and status in ('pending', 'reviewed', 'shortlisted');

  update public.applications
  set status = 'not_awarded'
  where id = any(v_closed_application_ids);

  update public.job_conversations
  set status = 'archived'
  where job_id = p_job_id
    and status = 'open'
    and upfront_payment_made_at is null;

  update public.jobs
  set status = 'closed'
  where id = p_job_id
  returning * into v_closed_job;

  insert into public.job_progress (job_id, status, note, updated_by)
  values (p_job_id, 'closed', 'Client closed the job request manually.', auth.uid());

  insert into public.notifications (user_id, type, title, body, data, channel)
  select
    a.professional_id,
    'job_request_closed',
    'Job request closed',
    'The client closed "' || v_job.title || '".',
    jsonb_build_object('job_id', p_job_id, 'application_id', a.id),
    'in_app'
  from public.applications a
  where a.id = any(v_closed_application_ids);

  return v_closed_job;
end;
$$;

create or replace function public.soft_delete_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
begin
  select *
  into v_application
  from public.applications
  where id = p_application_id
  for update;

  if v_application.id is null or v_application.professional_id <> auth.uid() then
    raise exception 'Application not found';
  end if;

  if v_application.deleted_at is not null then
    return jsonb_build_object(
      'application_id', v_application.id,
      'deleted', true,
      'already_deleted', true
    );
  end if;

  if v_application.status not in ('withdrawn', 'rejected', 'not_awarded') then
    raise exception 'Only inactive applications can be deleted. Withdraw the application first.';
  end if;

  update public.applications
  set deleted_at = now(),
      deleted_by = auth.uid(),
      deleted_reason = 'professional_deleted'
  where id = v_application.id;

  return jsonb_build_object(
    'application_id', v_application.id,
    'deleted', true,
    'already_deleted', false
  );
end;
$$;

grant execute on function public.apply_to_job(uuid, text, numeric) to authenticated, service_role;
grant execute on function public.close_job_request(uuid) to authenticated, service_role;
grant execute on function public.soft_delete_application(uuid) to authenticated, service_role;

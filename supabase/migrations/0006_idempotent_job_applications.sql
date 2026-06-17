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

  select id into v_application_id
  from public.applications
  where job_id = p_job_id
    and professional_id = auth.uid();

  if v_application_id is not null then
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

grant execute on function public.apply_to_job(uuid, text, numeric) to authenticated, service_role;

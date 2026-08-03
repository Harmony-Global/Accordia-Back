alter table public.jobs
drop constraint if exists jobs_status_check;

alter table public.jobs
add constraint jobs_status_check
check (
  status in ('open', 'in_discussion', 'awarded', 'in_progress', 'in_review', 'delivered', 'completed', 'closed', 'cancelled')
);

alter table public.job_progress
drop constraint if exists job_progress_status_check;

alter table public.job_progress
add constraint job_progress_status_check
check (
  status in ('posted', 'in_discussion', 'awarded', 'in_progress', 'in_review', 'delivered', 'completed', 'closed', 'cancelled')
);

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
    if v_job.status in ('completed', 'closed', 'cancelled') then
      raise exception 'Job is already final';
    end if;
  elsif not (
    (v_job.status = 'awarded' and p_status = 'in_progress')
    or (v_job.status = 'in_progress' and p_status = 'in_review')
    or (v_job.status = 'in_review' and p_status in ('delivered', 'completed'))
    or (v_job.status = 'delivered' and p_status in ('completed', 'closed'))
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

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
    select 1
    from public.jobs j
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

grant execute on function public.has_job_application(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_job_award(uuid, uuid) to authenticated, service_role;

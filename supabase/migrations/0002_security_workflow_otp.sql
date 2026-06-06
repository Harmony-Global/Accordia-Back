alter table public.verifications
  add column if not exists otp_hash text,
  add column if not exists otp_expires_at timestamptz,
  add column if not exists otp_attempts integer not null default 0,
  add column if not exists last_sent_at timestamptz;

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
            select 1 from public.applications a
            where a.job_id = j.id and a.professional_id = p_receiver_id
          )
        ))
        or (j.client_id = p_receiver_id and (
          j.awarded_to = p_sender_id
          or exists (
            select 1 from public.applications a
            where a.job_id = j.id and a.professional_id = p_sender_id
          )
        ))
      )
  );
$$;

create or replace function public.update_my_profile(
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_avatar_url text default null,
  p_set_avatar_url boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  update public.profiles p
  set
    first_name = coalesce(p_first_name, p.first_name),
    last_name = coalesce(p_last_name, p.last_name),
    phone = coalesce(p_phone, p.phone),
    avatar_url = case when p_set_avatar_url then p_avatar_url else p.avatar_url end,
    phone_verified = case
      when p_phone is not null and p_phone <> p.phone then false
      else p.phone_verified
    end
  where p.id = auth.uid()
    and p.is_active = true
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Profile not found or inactive';
  end if;

  return v_profile;
end;
$$;

create or replace function public.mark_notification_read(
  p_notification_id uuid,
  p_is_read boolean default true
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.notifications;
begin
  update public.notifications
  set is_read = p_is_read
  where id = p_notification_id
    and user_id = auth.uid()
  returning * into v_notification;

  if v_notification.id is null then
    raise exception 'Notification not found';
  end if;

  return v_notification;
end;
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
begin
  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not (
    v_job.client_id = auth.uid()
    or v_job.awarded_to = auth.uid()
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
  v_application_status text;
  v_job_status text;
begin
  select a.job_id, j.client_id, a.professional_id, a.status, j.status
  into v_job_id, v_client_id, v_professional_id, v_application_status, v_job_status
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
    'A client selected you for a job on Accordia.',
    jsonb_build_object('job_id', v_job_id, 'application_id', p_application_id),
    'email'
  );

  return v_job_id;
end;
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
      and j.status = 'open'
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

drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "clients and admins update jobs" on public.jobs;
drop policy if exists "admins update jobs" on public.jobs;
create policy "admins update jobs"
on public.jobs for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send job messages"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and job_id is not null
  and public.can_message_for_job(job_id, sender_id, receiver_id)
);

drop policy if exists "receiver can mark messages read" on public.messages;
create policy "receiver can mark messages read"
on public.messages for update
to authenticated
using (receiver_id = auth.uid() or public.is_admin())
with check (receiver_id = auth.uid() or public.is_admin());

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
        or (
          j.status in ('open', 'in_discussion')
          and public.professional_can_see_job(j.category_id)
        )
      )
  )
);

drop policy if exists "users update own notifications" on public.notifications;
create policy "users mark own notifications read"
on public.notifications for update
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

revoke insert, update on public.profiles from authenticated;
revoke update on public.jobs from authenticated;
revoke update on public.messages from authenticated;
revoke update on public.notifications from authenticated;

grant execute on function public.is_job_participant(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_message_for_job(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.update_my_profile(text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.mark_notification_read(uuid, boolean) to authenticated, service_role;
grant execute on function public.add_job_progress(uuid, text, text) to authenticated, service_role;

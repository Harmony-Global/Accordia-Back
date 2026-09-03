alter table public.applications
add column if not exists chat_accepted_at timestamptz,
add column if not exists chat_accepted_by uuid references public.profiles(id) on delete set null,
add column if not exists proposed_start_at timestamptz;

alter table public.job_conversations
add column if not exists work_starts_at timestamptz,
add column if not exists work_ends_at timestamptz;

alter table public.job_conversations
drop constraint if exists job_conversations_work_schedule_valid;

alter table public.job_conversations
add constraint job_conversations_work_schedule_valid check (
  work_starts_at is null
  or work_ends_at is null
  or work_ends_at > work_starts_at
);

alter table public.applications
drop constraint if exists applications_status_check;

alter table public.applications
add constraint applications_status_check check (
  status in ('pending', 'reviewed', 'shortlisted', 'selected', 'awarded', 'not_awarded', 'rejected', 'withdrawn')
);

create table if not exists public.proposal_drafts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  pitch text,
  proposed_rate numeric(12, 2) check (proposed_rate is null or proposed_rate >= 0),
  estimated_days integer check (estimated_days is null or (estimated_days >= 1 and estimated_days <= 365)),
  proposed_start_at timestamptz,
  reference_image_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, professional_id)
);

create index if not exists proposal_drafts_professional_idx
on public.proposal_drafts(professional_id, updated_at desc);

drop trigger if exists proposal_drafts_touch_updated_at on public.proposal_drafts;
create trigger proposal_drafts_touch_updated_at
before update on public.proposal_drafts
for each row execute function public.touch_updated_at();

alter table public.proposal_drafts enable row level security;

drop policy if exists "professionals manage own proposal drafts" on public.proposal_drafts;
create policy "professionals manage own proposal drafts"
on public.proposal_drafts for all
to authenticated
using (professional_id = auth.uid() or public.is_admin())
with check (professional_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.proposal_drafts to authenticated;
grant select, insert, update, delete on public.proposal_drafts to service_role;

create or replace function public.invite_application_to_chat(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_job public.jobs;
  v_existing_conversation_id uuid;
  v_was_invited boolean;
begin
  select *
  into v_application
  from public.applications
  where id = p_application_id
  for update;

  if v_application.id is null then
    raise exception 'Application not found';
  end if;

  select *
  into v_job
  from public.jobs
  where id = v_application.job_id;

  if v_job.id is null or v_job.client_id <> auth.uid() then
    raise exception 'Application not found or not owned by this client';
  end if;

  if v_application.status in ('rejected', 'not_awarded', 'withdrawn') then
    raise exception 'This application can no longer be invited to chat';
  end if;

  select id
  into v_existing_conversation_id
  from public.job_conversations
  where application_id = v_application.id
    and status = 'open'
  limit 1;

  v_was_invited := v_application.chat_invited_at is not null;

  if not v_was_invited then
    update public.applications
    set chat_invited_at = now(),
        chat_invited_by = auth.uid()
    where id = v_application.id;

    insert into public.notifications (user_id, type, title, body, data, channel)
    values (
      v_application.professional_id,
      'chat_invited',
      'Client invited you to chat',
      'The client wants to continue the conversation about "' || v_job.title || '".',
      jsonb_build_object('job_id', v_application.job_id, 'application_id', v_application.id),
      'in_app'
    );
  end if;

  return jsonb_build_object(
    'application_id', v_application.id,
    'conversation_id', v_existing_conversation_id,
    'already_invited', v_was_invited,
    'accepted', v_existing_conversation_id is not null
  );
end;
$$;

create or replace function public.accept_application_invitation(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_job public.jobs;
  v_conversation_id uuid;
  v_was_accepted boolean;
begin
  select *
  into v_application
  from public.applications
  where id = p_application_id
  for update;

  if v_application.id is null or v_application.professional_id <> auth.uid() then
    raise exception 'Application not found';
  end if;

  if v_application.chat_invited_at is null then
    raise exception 'This application has not been invited to chat';
  end if;

  if v_application.status in ('rejected', 'not_awarded', 'withdrawn') then
    raise exception 'This application can no longer accept invitations';
  end if;

  select *
  into v_job
  from public.jobs
  where id = v_application.job_id;

  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  v_was_accepted := v_application.chat_accepted_at is not null;

  insert into public.job_conversations (job_id, application_id, client_id, professional_id, opened_by, status)
  values (v_application.job_id, v_application.id, v_job.client_id, v_application.professional_id, auth.uid(), 'open')
  on conflict (application_id) do update
  set status = 'open',
      opened_by = coalesce(public.job_conversations.opened_by, excluded.opened_by),
      updated_at = now()
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select id
    into v_conversation_id
    from public.job_conversations
    where application_id = v_application.id;
  end if;

  if not v_was_accepted then
    update public.applications
    set chat_accepted_at = now(),
        chat_accepted_by = auth.uid()
    where id = v_application.id;

    insert into public.notifications (user_id, type, title, body, data, channel)
    values (
      v_job.client_id,
      'chat_invitation_accepted',
      'Chat invitation accepted',
      'A professional accepted your chat invitation for "' || v_job.title || '".',
      jsonb_build_object(
        'job_id', v_application.job_id,
        'application_id', v_application.id,
        'conversation_id', v_conversation_id,
        'professional_id', v_application.professional_id
      ),
      'in_app'
    );
  end if;

  return jsonb_build_object(
    'application_id', v_application.id,
    'conversation_id', v_conversation_id,
    'already_accepted', v_was_accepted
  );
end;
$$;

create or replace function public.withdraw_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_job public.jobs;
  v_previous_status text;
begin
  select *
  into v_application
  from public.applications
  where id = p_application_id
  for update;

  if v_application.id is null or v_application.professional_id <> auth.uid() then
    raise exception 'Application not found';
  end if;

  if v_application.status in ('selected', 'awarded') then
    raise exception 'Hired applications cannot be withdrawn';
  end if;

  if v_application.status in ('rejected', 'not_awarded', 'withdrawn') then
    return jsonb_build_object(
      'application_id', v_application.id,
      'previous_status', v_application.status,
      'next_status', v_application.status
    );
  end if;

  select *
  into v_job
  from public.jobs
  where id = v_application.job_id;

  v_previous_status := v_application.status;

  update public.applications
  set status = 'withdrawn'
  where id = v_application.id;

  update public.job_conversations
  set status = 'archived'
  where application_id = v_application.id;

  insert into public.notifications (user_id, type, title, body, data, channel)
  values (
    v_job.client_id,
    'application_withdrawn',
    'Application withdrawn',
    'A professional withdrew their application for "' || v_job.title || '".',
    jsonb_build_object('job_id', v_application.job_id, 'application_id', v_application.id, 'professional_id', v_application.professional_id),
    'in_app'
  );

  return jsonb_build_object(
    'application_id', v_application.id,
    'previous_status', v_previous_status,
    'next_status', 'withdrawn'
  );
end;
$$;

grant execute on function public.invite_application_to_chat(uuid) to authenticated, service_role;
grant execute on function public.accept_application_invitation(uuid) to authenticated, service_role;
grant execute on function public.withdraw_application(uuid) to authenticated, service_role;

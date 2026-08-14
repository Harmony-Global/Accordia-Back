alter table public.applications
add column if not exists estimated_days integer check (estimated_days is null or (estimated_days >= 1 and estimated_days <= 365)),
add column if not exists proposal_attachments jsonb not null default '[]'::jsonb,
add column if not exists chat_invited_at timestamptz,
add column if not exists chat_invited_by uuid references public.profiles(id) on delete set null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-proposal-attachments',
  'application-proposal-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.invite_application_to_chat(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_job public.jobs;
  v_conversation_id uuid;
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

  if v_application.status in ('rejected', 'not_awarded') then
    raise exception 'This application can no longer be invited to chat';
  end if;

  v_was_invited := v_application.chat_invited_at is not null;

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
      jsonb_build_object(
        'job_id', v_application.job_id,
        'application_id', v_application.id,
        'conversation_id', v_conversation_id
      ),
      'in_app'
    );
  end if;

  return jsonb_build_object(
    'application_id', v_application.id,
    'conversation_id', v_conversation_id,
    'already_invited', v_was_invited
  );
end;
$$;

create or replace function public.decline_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications;
  v_job public.jobs;
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

  if v_application.status in ('awarded', 'not_awarded') then
    raise exception 'This finalized application cannot be declined';
  end if;

  if v_application.status <> 'rejected' then
    update public.applications
    set status = 'rejected'
    where id = v_application.id;

    update public.job_conversations
    set status = 'archived'
    where application_id = v_application.id;

    insert into public.notifications (user_id, type, title, body, data, channel)
    values (
      v_application.professional_id,
      'application_rejected',
      'Application declined',
      'The client declined your application for "' || v_job.title || '".',
      jsonb_build_object('job_id', v_application.job_id, 'application_id', v_application.id),
      'in_app'
    );
  end if;

  return jsonb_build_object(
    'application_id', v_application.id,
    'previous_status', v_application.status,
    'next_status', 'rejected'
  );
end;
$$;

grant execute on function public.invite_application_to_chat(uuid) to authenticated, service_role;
grant execute on function public.decline_application(uuid) to authenticated, service_role;

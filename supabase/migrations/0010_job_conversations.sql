create table if not exists public.job_conversations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  opened_by uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id),
  unique (job_id, professional_id)
);

alter table public.messages
add column if not exists conversation_id uuid references public.job_conversations(id) on delete cascade;

create index if not exists job_conversations_client_idx
on public.job_conversations(client_id, created_at desc);

create index if not exists job_conversations_professional_idx
on public.job_conversations(professional_id, created_at desc);

create index if not exists job_conversations_job_idx
on public.job_conversations(job_id, created_at desc);

create index if not exists messages_conversation_idx
on public.messages(conversation_id, created_at desc);

drop trigger if exists job_conversations_touch_updated_at on public.job_conversations;
create trigger job_conversations_touch_updated_at
before update on public.job_conversations
for each row execute function public.touch_updated_at();

alter table public.job_conversations enable row level security;

create or replace function public.can_access_job_conversation(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.job_conversations jc
    where jc.id = p_conversation_id
      and jc.status = 'open'
      and (
        jc.client_id = p_user_id
        or jc.professional_id = p_user_id
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
        (
          j.status in ('open', 'in_discussion')
          and (
            (
              j.client_id = p_sender_id
              and exists (
                select 1
                from public.applications a
                where a.job_id = j.id
                  and a.professional_id = p_receiver_id
                  and a.status in ('pending', 'reviewed', 'shortlisted', 'selected')
              )
            )
            or (
              j.client_id = p_receiver_id
              and exists (
                select 1
                from public.applications a
                where a.job_id = j.id
                  and a.professional_id = p_sender_id
                  and a.status in ('pending', 'reviewed', 'shortlisted', 'selected')
              )
            )
          )
        )
        or (
          j.client_id = p_sender_id
          and (
            j.awarded_to = p_receiver_id
            or exists (
              select 1
              from public.job_awards ja
              where ja.job_id = j.id
                and ja.professional_id = p_receiver_id
            )
          )
        )
        or (
          j.client_id = p_receiver_id
          and (
            j.awarded_to = p_sender_id
            or exists (
              select 1
              from public.job_awards ja
              where ja.job_id = j.id
                and ja.professional_id = p_sender_id
            )
          )
        )
      )
  );
$$;

drop policy if exists "job conversations visible to participants" on public.job_conversations;
create policy "job conversations visible to participants"
on public.job_conversations for select
to authenticated
using (
  client_id = auth.uid()
  or professional_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "service role manages job conversations" on public.job_conversations;
create policy "service role manages job conversations"
on public.job_conversations for all
to service_role
using (true)
with check (true);

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and (
    public.is_admin()
    or (
      conversation_id is not null
      and public.can_access_job_conversation(conversation_id, auth.uid())
    )
    or (
      conversation_id is null
      and job_id is not null
      and receiver_id is not null
      and public.can_message_for_job(job_id, sender_id, receiver_id)
    )
  )
);

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
  v_conversation_ids uuid[];
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

  insert into public.job_conversations (job_id, application_id, client_id, professional_id, opened_by, status)
  select a.job_id, a.id, v_job.client_id, a.professional_id, auth.uid(), 'open'
  from public.applications a
  where a.id = any(v_selected_application_ids)
  on conflict (job_id, professional_id) do update
  set status = 'open',
      opened_by = excluded.opened_by;

  select array_agg(jc.id order by jc.created_at)
  into v_conversation_ids
  from public.job_conversations jc
  where jc.job_id = p_job_id
    and jc.application_id = any(v_selected_application_ids);

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

  insert into public.notifications (user_id, type, title, body, data, channel)
  select
    jc.professional_id,
    'job_chat_opened',
    'Chat opened for your awarded job',
    'You can now chat with the client about "' || v_job.title || '".',
    jsonb_build_object('job_id', p_job_id, 'conversation_id', jc.id, 'application_id', jc.application_id),
    'in_app'
  from public.job_conversations jc
  where jc.id = any(v_conversation_ids)
  union all
  select
    jc.client_id,
    'job_chat_opened',
    'Chat opened with awarded professional',
    'You can now chat with an awarded professional about "' || v_job.title || '".',
    jsonb_build_object('job_id', p_job_id, 'conversation_id', jc.id, 'application_id', jc.application_id, 'professional_id', jc.professional_id),
    'in_app'
  from public.job_conversations jc
  where jc.id = any(v_conversation_ids);

  return jsonb_build_object(
    'job_id', p_job_id,
    'awarded_application_ids', v_selected_application_ids,
    'conversation_ids', coalesce(v_conversation_ids, array[]::uuid[])
  );
end;
$$;

grant select on public.job_conversations to authenticated;
grant select, insert, update, delete on public.job_conversations to service_role;
grant execute on function public.can_access_job_conversation(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_message_for_job(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.seal_job_awards(uuid) to authenticated, service_role;

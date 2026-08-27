create or replace function public.message_matches_job_conversation(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_receiver_id uuid,
  p_job_id uuid,
  p_application_id uuid
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
      and jc.job_id = p_job_id
      and jc.application_id = p_application_id
      and (
        (
          jc.client_id = p_sender_id
          and jc.professional_id = p_receiver_id
        )
        or (
          jc.professional_id = p_sender_id
          and jc.client_id = p_receiver_id
        )
      )
      and (
        jc.client_id = auth.uid()
        or jc.professional_id = auth.uid()
        or public.is_admin()
      )
  );
$$;

create or replace function public.mark_conversation_messages_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer;
begin
  if not public.can_access_job_conversation(p_conversation_id, auth.uid()) then
    raise exception 'Conversation not found or not accessible';
  end if;

  update public.messages
  set is_read = true
  where conversation_id = p_conversation_id
    and receiver_id = auth.uid()
    and is_read = false;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and (
    (
      conversation_id is not null
      and job_id is not null
      and application_id is not null
      and public.message_matches_job_conversation(
        conversation_id,
        sender_id,
        receiver_id,
        job_id,
        application_id
      )
    )
    or (
      conversation_id is null
      and job_id is not null
      and receiver_id is not null
      and public.can_message_for_job(job_id, sender_id, receiver_id)
    )
  )
);

grant execute on function public.message_matches_job_conversation(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.mark_conversation_messages_read(uuid) to authenticated, service_role;

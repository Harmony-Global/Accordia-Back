alter table public.profiles
drop constraint if exists profiles_avatar_url_not_inline_data;

alter table public.profiles
add constraint profiles_avatar_url_not_inline_data
check (
  avatar_url is null
  or (
    length(avatar_url) <= 2048
    and avatar_url !~* '^data:image/'
  )
) not valid;

create index if not exists jobs_client_created_idx
on public.jobs(client_id, created_at desc);

create index if not exists jobs_client_status_created_idx
on public.jobs(client_id, status, created_at desc);

create index if not exists job_conversations_job_status_created_idx
on public.job_conversations(job_id, status, created_at desc);

create index if not exists job_conversations_client_status_created_idx
on public.job_conversations(client_id, status, created_at desc);

create index if not exists job_conversations_professional_status_created_idx
on public.job_conversations(professional_id, status, created_at desc);

create index if not exists messages_conversation_unread_receiver_idx
on public.messages(conversation_id, receiver_id, is_read)
where is_read = false;

alter table public.job_conversations
  add column if not exists work_status text not null default 'in_progress',
  add column if not exists work_submitted_at timestamptz,
  add column if not exists revision_requested_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists final_payment_made_at timestamptz,
  add column if not exists final_payment_made_by uuid references public.profiles(id) on delete set null,
  add column if not exists deliverables jsonb not null default '[]'::jsonb,
  add column if not exists revision_note text;

alter table public.job_conversations
  drop constraint if exists job_conversations_work_status_check;

alter table public.job_conversations
  add constraint job_conversations_work_status_check
  check (work_status in ('in_progress', 'submitted', 'revision_requested', 'completed'));

create index if not exists job_conversations_work_status_idx
  on public.job_conversations(work_status);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-deliverables',
  'job-deliverables',
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
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

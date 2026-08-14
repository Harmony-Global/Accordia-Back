alter table public.job_conversations
add column if not exists upfront_payment_made_at timestamptz,
add column if not exists upfront_payment_made_by uuid references public.profiles(id) on delete set null;

create index if not exists job_conversations_upfront_payment_idx
on public.job_conversations(upfront_payment_made_at)
where upfront_payment_made_at is not null;

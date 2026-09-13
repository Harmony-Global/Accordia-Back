create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.job_conversations(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  quote_id uuid references public.job_quotes(id) on delete set null,
  payer_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid references public.profiles(id) on delete set null,
  payment_type text not null check (payment_type in ('job_upfront', 'job_final', 'appointment_full')),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'NGN',
  provider text not null default 'paystack',
  provider_reference text not null unique,
  provider_transaction_id text,
  access_code text,
  authorization_url text,
  status text not null default 'initialized' check (status in ('initialized', 'pending', 'success', 'failed', 'abandoned')),
  paid_at timestamptz,
  verified_at timestamptz,
  webhook_received_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_conversation_idx
on public.payments(conversation_id, created_at desc)
where conversation_id is not null;

create index if not exists payments_appointment_idx
on public.payments(appointment_id, created_at desc)
where appointment_id is not null;

create index if not exists payments_payer_idx
on public.payments(payer_id, created_at desc);

create index if not exists payments_status_idx
on public.payments(status, created_at desc);

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
before update on public.payments
for each row execute function public.touch_updated_at();

alter table public.payments enable row level security;

drop policy if exists "payments visible to participants" on public.payments;
create policy "payments visible to participants"
on public.payments for select
to authenticated
using (
  payer_id = auth.uid()
  or professional_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "service role manages payments" on public.payments;
create policy "service role manages payments"
on public.payments for all
to service_role
using (true)
with check (true);

grant select on public.payments to authenticated;
grant select, insert, update, delete on public.payments to service_role;

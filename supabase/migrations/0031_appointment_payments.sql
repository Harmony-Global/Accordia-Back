alter table public.appointments
add column if not exists payment_made_at timestamptz,
add column if not exists payment_made_by uuid references public.profiles(id) on delete set null,
add column if not exists payment_reference text;

create index if not exists appointments_payment_made_idx
on public.appointments(payment_made_at)
where payment_made_at is not null;

create index if not exists appointments_payment_reference_idx
on public.appointments(payment_reference)
where payment_reference is not null;

alter table public.payments
add column if not exists receipt_number text,
add column if not exists receipt_issued_at timestamptz;

create unique index if not exists payments_receipt_number_unique_idx
on public.payments(receipt_number)
where receipt_number is not null;

update public.payments
set
  receipt_number = 'ACC-RCPT-'
    || to_char(coalesce(paid_at, verified_at, webhook_received_at, updated_at, created_at, now()), 'YYYYMMDD')
    || '-'
    || upper(substr(replace(id::text, '-', ''), 1, 8)),
  receipt_issued_at = coalesce(receipt_issued_at, paid_at, verified_at, webhook_received_at, updated_at, created_at, now())
where status = 'success'
  and receipt_number is null;

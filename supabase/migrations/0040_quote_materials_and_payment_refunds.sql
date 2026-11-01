alter table public.job_quotes
  add column requires_material_payment boolean not null default false,
  add column material_payment_amount numeric(12, 2),
  add column material_payment_covers text;

alter table public.job_quotes add constraint job_quotes_material_payment_valid check (
  (not requires_material_payment and material_payment_amount is null and material_payment_covers is null)
  or (requires_material_payment and material_payment_amount is not null
      and material_payment_covers is not null and material_payment_amount > 0
      and material_payment_amount <= total_budget
      and length(btrim(material_payment_covers)) between 1 and 2000)
);

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  provider_refund_id text not null unique,
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null check (currency = 'NGN'),
  status text not null check (status in ('pending', 'processing', 'needs-attention', 'failed', 'processed')),
  initiated_at timestamptz not null,
  processed_at timestamptz,
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles(id),
  reconciliation_note text,
  updated_at timestamptz not null default now(),
  check ((status = 'processed') = (processed_at is not null)),
  check (reconciled_at is null or (reconciled_by is not null and length(btrim(reconciliation_note)) >= 10))
);

create index payment_refunds_payment_idx on public.payment_refunds(payment_id, initiated_at desc);
create index payment_refunds_status_idx on public.payment_refunds(status, updated_at desc);
create index payments_provider_transaction_idx on public.payments(provider_transaction_id)
where provider = 'paystack' and provider_transaction_id is not null;

create or replace function public.guard_refund_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('processed', 'failed') and new.status <> old.status then
    raise exception 'Final refund status cannot be changed';
  end if;
  if old.payment_id <> new.payment_id or old.provider_refund_id <> new.provider_refund_id
    or old.amount_kobo <> new.amount_kobo or old.currency <> new.currency
    or old.initiated_at <> new.initiated_at then
    raise exception 'Refund identity cannot be changed';
  end if;
  return new;
end $$;

create trigger guard_refund_status before update on public.payment_refunds
for each row execute function public.guard_refund_status();

create or replace function public.guard_refund_amount() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_payment public.payments; v_other bigint;
begin
  select * into v_payment from public.payments where id = new.payment_id for update;
  if not found or v_payment.status <> 'success' or v_payment.currency <> new.currency then
    raise exception 'Refund must match a verified payment';
  end if;
  perform 1 from public.professional_earnings e where
    (v_payment.conversation_id is not null and e.source_type = 'job' and e.source_id = v_payment.conversation_id)
    or (v_payment.appointment_id is not null and e.source_type = 'appointment' and e.source_id = v_payment.appointment_id)
    for update;
  select coalesce(sum(amount_kobo), 0) into v_other from public.payment_refunds
  where payment_id = new.payment_id and id <> new.id and status <> 'failed';
  if new.status <> 'failed' and v_other + new.amount_kobo > round(v_payment.amount * 100) then
    raise exception 'Refunds exceed original charge';
  end if;
  return new;
end $$;

create trigger guard_refund_amount before insert or update on public.payment_refunds
for each row execute function public.guard_refund_amount();

create or replace function public.hold_earning_for_refund() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.payments p join public.payment_refunds r on r.payment_id = p.id
    where ((new.source_type = 'job' and p.conversation_id = new.source_id)
      or (new.source_type = 'appointment' and p.appointment_id = new.source_id))
      and r.status <> 'failed' and r.reconciled_at is null
  ) then
    update public.professional_earnings set hold_reason = 'Refund requires admin reconciliation'
    where id = new.id and hold_reason is null;
  end if;
  return new;
end $$;

create trigger hold_earning_for_refund after insert on public.professional_earnings
for each row execute function public.hold_earning_for_refund();

create or replace function public.guard_refunded_earning_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.hold_reason is not null and new.hold_reason is null and exists (
    select 1 from public.payments p join public.payment_refunds r on r.payment_id = p.id
    where ((old.source_type = 'job' and p.conversation_id = old.source_id)
      or (old.source_type = 'appointment' and p.appointment_id = old.source_id))
      and r.status <> 'failed' and r.reconciled_at is null
  ) then
    raise exception 'Refund must be reconciled before releasing this earning';
  end if;
  return new;
end $$;

create trigger guard_refunded_earning_release before update of hold_reason on public.professional_earnings
for each row execute function public.guard_refunded_earning_release();

alter table public.payment_refunds enable row level security;
create policy "refunds visible to payer or admin" on public.payment_refunds for select to authenticated
using (exists (select 1 from public.payments p where p.id = payment_id
  and (p.payer_id = auth.uid() or public.is_admin())));
grant select on public.payment_refunds to authenticated;
grant all on public.payment_refunds to service_role;

create or replace function public.guard_refunded_earning_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_earning public.professional_earnings;
begin
  select * into v_earning from public.professional_earnings where id = new.earning_id;
  if exists (
    select 1 from public.payments p join public.payment_refunds r on r.payment_id = p.id
    where ((v_earning.source_type = 'job' and p.conversation_id = v_earning.source_id)
      or (v_earning.source_type = 'appointment' and p.appointment_id = v_earning.source_id))
      and r.status <> 'failed' and r.reconciled_at is null
  ) then raise exception 'Refunded earnings require manual reconciliation before payout'; end if;
  return new;
end $$;

create trigger guard_refunded_earning_allocation before insert or update on public.payout_allocations
for each row execute function public.guard_refunded_earning_allocation();

create or replace function public.client_completed_payment_total(p_client_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with completed_payments as (
    select p.id, round(p.amount * 100)::bigint as amount_kobo
    from public.payments p
    left join public.job_conversations c on c.id = p.conversation_id
    left join public.appointments a on a.id = p.appointment_id
    where p.payer_id = p_client_id and p.provider = 'paystack' and p.status = 'success'
      and p.provider_transaction_id is not null and p.currency = 'NGN'
      and (c.work_status = 'completed' or a.status = 'completed')
  )
  select jsonb_build_object(
    'gross_kobo', coalesce(sum(cp.amount_kobo), 0),
    'refunded_kobo', coalesce((select sum(r.amount_kobo) from public.payment_refunds r
      join completed_payments eligible on eligible.id = r.payment_id where r.status = 'processed'), 0),
    'completed_charge_count', count(*)
  ) from completed_payments cp;
$$;

revoke all on function public.client_completed_payment_total(uuid) from public, anon, authenticated;
grant execute on function public.client_completed_payment_total(uuid) to service_role;

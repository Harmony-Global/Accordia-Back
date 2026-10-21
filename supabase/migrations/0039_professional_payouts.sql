create table public.professional_earnings (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id),
  client_id uuid not null references public.profiles(id),
  source_type text not null check (source_type in ('appointment', 'job')),
  source_id uuid not null,
  title text not null,
  gross_kobo bigint not null check (gross_kobo > 0),
  fee_kobo bigint not null check (fee_kobo >= 0),
  net_kobo bigint not null check (net_kobo = gross_kobo - fee_kobo and net_kobo > 0),
  earned_at timestamptz not null,
  hold_reason text,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index professional_earnings_owner_date_idx on public.professional_earnings(professional_id, earned_at desc);

create table public.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id),
  bank_code text not null,
  bank_name text not null,
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  resolved_name text not null,
  holder_name text not null,
  notification_email text not null,
  recipient_code text not null,
  status text not null check (status in ('verified', 'pending_review')),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payout_destinations_current_idx on public.payout_destinations(professional_id) where is_current;

create table public.professional_payouts (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id),
  destination_id uuid not null references public.payout_destinations(id),
  provider_reference text not null unique,
  transfer_code text,
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null check (status in ('pending', 'success', 'failed', 'reversed')),
  transferred_at timestamptz,
  reconciled_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  display_at timestamptz generated always as (coalesce(transferred_at, created_at)) stored,
  updated_at timestamptz not null default now()
);

create index professional_payouts_owner_date_idx on public.professional_payouts(professional_id, transferred_at desc, created_at desc);

create or replace function public.guard_professional_payout_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('failed', 'reversed') and new.status is distinct from old.status then
    raise exception 'Terminal payout status cannot be changed';
  end if;
  if old.status = 'success' and new.status not in ('success', 'reversed') then
    raise exception 'Confirmed payout can only be reversed';
  end if;
  return new;
end $$;

create trigger guard_professional_payout_status before update of status on public.professional_payouts
for each row execute function public.guard_professional_payout_status();

create table public.payout_allocations (
  payout_id uuid not null references public.professional_payouts(id),
  earning_id uuid not null references public.professional_earnings(id),
  amount_kobo bigint not null check (amount_kobo > 0),
  primary key (payout_id, earning_id)
);

create index payout_allocations_earning_idx on public.payout_allocations(earning_id);

create table public.payout_exceptions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid references public.profiles(id),
  source_type text not null check (source_type in ('appointment', 'job', 'transfer')),
  source_id uuid,
  reason text not null,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (source_type, source_id, reason)
);

create index payout_exceptions_open_idx on public.payout_exceptions(created_at desc) where resolved_at is null;

create or replace function public.flag_reversed_professional_payout() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'success' and new.status = 'reversed' then
    insert into public.payout_exceptions(professional_id, source_type, source_id, reason)
    values (new.professional_id, 'transfer', new.id, 'Confirmed payout was reversed; manual recovery required')
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger flag_reversed_professional_payout after update of status on public.professional_payouts
for each row execute function public.flag_reversed_professional_payout();

alter table public.professional_earnings enable row level security;
alter table public.payout_destinations enable row level security;
alter table public.professional_payouts enable row level security;
alter table public.payout_allocations enable row level security;
alter table public.payout_exceptions enable row level security;

create policy "earnings visible to owner or admin" on public.professional_earnings for select to authenticated
using (professional_id = auth.uid() or public.is_admin());
create policy "destinations visible to owner or admin" on public.payout_destinations for select to authenticated
using (professional_id = auth.uid() or public.is_admin());
create policy "payouts visible to owner or admin" on public.professional_payouts for select to authenticated
using (professional_id = auth.uid() or public.is_admin());
create policy "allocations visible to owner or admin" on public.payout_allocations for select to authenticated
using (exists (select 1 from public.professional_earnings e where e.id = earning_id and (e.professional_id = auth.uid() or public.is_admin())));
create policy "exceptions visible to admin" on public.payout_exceptions for select to authenticated
using (public.is_admin());

grant select on public.professional_earnings, public.payout_destinations, public.professional_payouts, public.payout_allocations, public.payout_exceptions to authenticated;
grant all on public.professional_earnings, public.payout_destinations, public.professional_payouts, public.payout_allocations, public.payout_exceptions to service_role;

create or replace function public.refresh_professional_earning(p_source_type text, p_source_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_professional_id uuid;
  v_client_id uuid;
  v_title text;
  v_earned_at timestamptz;
  v_payment_count integer;
  v_upfront_count integer;
  v_final_count integer;
  v_gross_kobo bigint;
  v_reason text;
begin
  if p_source_type = 'appointment' then
    select a.professional_id, a.client_id, coalesce(s.title, 'Appointment'),
      (select min(l.created_at) from public.appointment_audit_logs l where l.appointment_id = a.id and l.action = 'completed')
      into v_professional_id, v_client_id, v_title, v_earned_at
    from public.appointments a left join public.professional_services s on s.id = a.service_id
    where a.id = p_source_id and a.status = 'completed';
    if v_professional_id is null then return; end if;
    select count(*), coalesce(sum(round(p.amount * 100)::bigint), 0)
      into v_payment_count, v_gross_kobo
    from public.payments p where p.appointment_id = p_source_id and p.payment_type = 'appointment_full'
      and p.status = 'success' and p.provider = 'paystack' and p.provider_transaction_id is not null
      and p.currency = 'NGN' and p.payer_id = v_client_id and p.professional_id = v_professional_id;
    if v_payment_count <> 1 then v_reason := 'Expected exactly one verified appointment payment'; end if;
  elsif p_source_type = 'job' then
    select c.professional_id, c.client_id, coalesce(j.title, 'Job request'), c.completed_at
      into v_professional_id, v_client_id, v_title, v_earned_at
    from public.job_conversations c left join public.jobs j on j.id = c.job_id
    where c.id = p_source_id and c.work_status = 'completed';
    if v_professional_id is null then return; end if;
    select count(*), count(*) filter (where p.payment_type = 'job_upfront'),
      count(*) filter (where p.payment_type = 'job_final'),
      coalesce(sum(round(p.amount * 100)::bigint), 0)
      into v_payment_count, v_upfront_count, v_final_count, v_gross_kobo
    from public.payments p where p.conversation_id = p_source_id
      and p.payment_type in ('job_upfront', 'job_final') and p.status = 'success'
      and p.provider = 'paystack' and p.provider_transaction_id is not null and p.currency = 'NGN'
      and p.payer_id = v_client_id and p.professional_id = v_professional_id;
    if v_payment_count <> 2 or v_upfront_count <> 1 or v_final_count <> 1 then
      v_reason := 'Expected one verified upfront and one verified final payment';
    end if;
  else
    raise exception 'Unknown earning source';
  end if;

  if v_earned_at is null then v_reason := 'Completed work has no reliable completion timestamp'; end if;
  if v_reason is not null then
    insert into public.payout_exceptions(professional_id, source_type, source_id, reason)
    values (v_professional_id, p_source_type, p_source_id, v_reason) on conflict do nothing;
    update public.professional_earnings set hold_reason = 'Payment records require reconciliation'
    where source_type = p_source_type and source_id = p_source_id and hold_reason is null;
    return;
  end if;

  insert into public.professional_earnings
    (professional_id, client_id, source_type, source_id, title, gross_kobo, fee_kobo, net_kobo, earned_at)
  values
    (v_professional_id, v_client_id, p_source_type, p_source_id, v_title, v_gross_kobo,
      round(v_gross_kobo * 0.10)::bigint, v_gross_kobo - round(v_gross_kobo * 0.10)::bigint, v_earned_at)
  on conflict (source_type, source_id) do nothing;

  update public.professional_earnings set hold_reason = 'Payment amount changed; admin review required'
  where source_type = p_source_type and source_id = p_source_id and gross_kobo <> v_gross_kobo;

  update public.payout_exceptions set resolved_at = now()
  where source_type = p_source_type and source_id = p_source_id and resolved_at is null;
end $$;

revoke all on function public.refresh_professional_earning(text, uuid) from public, anon, authenticated;
grant execute on function public.refresh_professional_earning(text, uuid) to service_role;

create or replace function public.refresh_earning_after_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    if new.appointment_id is not null then perform public.refresh_professional_earning('appointment', new.appointment_id); end if;
    if new.conversation_id is not null then perform public.refresh_professional_earning('job', new.conversation_id); end if;
  end if;
  return new;
end $$;

create trigger payment_refresh_earning after update of status on public.payments
for each row execute function public.refresh_earning_after_payment();

create or replace function public.refresh_earning_after_completion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.work_status = 'completed' and old.work_status is distinct from 'completed' then
    perform public.refresh_professional_earning('job', new.id);
  end if;
  return new;
end $$;

create trigger job_refresh_earning after update of work_status on public.job_conversations
for each row execute function public.refresh_earning_after_completion();

create or replace function public.refresh_earning_after_appointment_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action = 'completed' and new.appointment_id is not null then
    perform public.refresh_professional_earning('appointment', new.appointment_id);
  end if;
  return new;
end $$;

create trigger appointment_audit_refresh_earning after insert on public.appointment_audit_logs
for each row execute function public.refresh_earning_after_appointment_audit();

select public.refresh_professional_earning('appointment', id) from public.appointments where status = 'completed';
select public.refresh_professional_earning('job', id) from public.job_conversations where work_status = 'completed';

create or replace function public.record_verified_professional_payout(
  p_destination_id uuid,
  p_reference text,
  p_transfer_code text,
  p_amount_kobo bigint,
  p_status text,
  p_transferred_at timestamptz,
  p_reconciled_by uuid,
  p_allocations jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_destination public.payout_destinations%rowtype;
  v_payout public.professional_payouts%rowtype;
  v_row record;
  v_earning public.professional_earnings%rowtype;
  v_reserved bigint;
  v_sum bigint := 0;
begin
  select * into v_destination from public.payout_destinations where id = p_destination_id;
  if not found or v_destination.status <> 'verified' then raise exception 'Verified payout destination required'; end if;
  if p_status not in ('pending', 'success', 'failed', 'reversed') or p_amount_kobo <= 0 then
    raise exception 'Invalid verified transfer';
  end if;

  select * into v_payout from public.professional_payouts where provider_reference = p_reference for update;
  if found then
    if v_payout.destination_id <> p_destination_id or v_payout.amount_kobo <> p_amount_kobo then
      raise exception 'Transfer reference already belongs to another payout';
    end if;
    if v_payout.status = 'reversed' and p_status <> 'reversed' then raise exception 'Reversed payout cannot be restored'; end if;
    update public.professional_payouts set status = p_status, transfer_code = p_transfer_code,
      transferred_at = case when p_status = 'success' then coalesce(p_transferred_at, transferred_at) else transferred_at end,
      updated_at = now()
    where id = v_payout.id;
    return v_payout.id;
  end if;

  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Payout allocations required';
  end if;
  for v_row in select id, amount_kobo from jsonb_to_recordset(p_allocations) as x(id uuid, amount_kobo bigint) order by id loop
    select * into v_earning from public.professional_earnings where id = v_row.id for update;
    if not found or v_earning.professional_id <> v_destination.professional_id or v_earning.hold_reason is not null then
      raise exception 'Earning is unavailable for this professional';
    end if;
    if v_earning.earned_at >= ((date_trunc('week', now() at time zone 'Africa/Lagos')
      + interval '4 days' - case when extract(isodow from now() at time zone 'Africa/Lagos') < 5
        then interval '7 days' else interval '0 days' end) at time zone 'Africa/Lagos') then
      raise exception 'Earning has not reached the Friday cutoff';
    end if;
    if v_row.amount_kobo is null or v_row.amount_kobo <= 0 then raise exception 'Allocation must be positive'; end if;
    select coalesce(sum(a.amount_kobo), 0) into v_reserved
    from public.payout_allocations a join public.professional_payouts p on p.id = a.payout_id
    where a.earning_id = v_row.id and p.status in ('pending', 'success');
    if v_reserved + v_row.amount_kobo > v_earning.net_kobo then raise exception 'Allocation exceeds unpaid earning'; end if;
    v_sum := v_sum + v_row.amount_kobo;
  end loop;
  if v_sum <> p_amount_kobo then raise exception 'Transfer amount does not match allocations'; end if;

  insert into public.professional_payouts
    (professional_id, destination_id, provider_reference, transfer_code, amount_kobo, status, transferred_at, reconciled_by)
  values
    (v_destination.professional_id, p_destination_id, p_reference, p_transfer_code, p_amount_kobo,
      p_status, case when p_status = 'success' then p_transferred_at else null end, p_reconciled_by)
  returning * into v_payout;
  insert into public.payout_allocations(payout_id, earning_id, amount_kobo)
  select v_payout.id, id, amount_kobo from jsonb_to_recordset(p_allocations) as x(id uuid, amount_kobo bigint);
  return v_payout.id;
end $$;

revoke all on function public.record_verified_professional_payout(uuid, text, text, bigint, text, timestamptz, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_professional_payout(uuid, text, text, bigint, text, timestamptz, uuid, jsonb) to service_role;

create or replace function public.professional_payout_metrics(
  p_professional_id uuid, p_from timestamptz default null, p_to timestamptz default null
) returns jsonb language sql security definer set search_path = public as $$
  with earned as (
    select e.id, e.net_kobo, e.hold_reason, e.earned_at,
      coalesce((select sum(a.amount_kobo) from public.payout_allocations a
        join public.professional_payouts p on p.id = a.payout_id
        where a.earning_id = e.id and p.status = 'success'), 0)::bigint as paid_kobo,
      coalesce((select sum(a.amount_kobo) from public.payout_allocations a
        join public.professional_payouts p on p.id = a.payout_id
        where a.earning_id = e.id and p.status = 'pending'), 0)::bigint as pending_kobo
    from public.professional_earnings e where e.professional_id = p_professional_id
      and (p_from is null or e.earned_at >= p_from) and (p_to is null or e.earned_at < p_to)
  )
  select jsonb_build_object(
    'total_net_kobo', coalesce(sum(net_kobo), 0),
    'total_paid_out_kobo', (select coalesce(sum(amount_kobo), 0) from public.professional_payouts
      where professional_id = p_professional_id and status = 'success'),
    'paid_earnings_count', count(*) filter (where hold_reason is null and paid_kobo >= net_kobo),
    'total_earnings_count', count(*) filter (where hold_reason is null),
    'unpaid_kobo', coalesce(sum(greatest(net_kobo - paid_kobo, 0)), 0),
    'available_kobo', coalesce(sum(case when hold_reason is null then greatest(net_kobo - paid_kobo - pending_kobo, 0) else 0 end), 0)
  ) from earned;
$$;

revoke all on function public.professional_payout_metrics(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.professional_payout_metrics(uuid, timestamptz, timestamptz) to service_role;

create or replace function public.replace_payout_destination(
  p_professional_id uuid, p_bank_code text, p_bank_name text, p_last4 text,
  p_resolved_name text, p_holder_name text, p_email text, p_recipient_code text,
  p_status text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_previous public.payout_destinations%rowtype; v_id uuid;
begin
  if p_status not in ('verified', 'pending_review') then raise exception 'Invalid destination status'; end if;
  select * into v_previous from public.payout_destinations where professional_id = p_professional_id and is_current for update;
  if found and v_previous.recipient_code = p_recipient_code and v_previous.bank_code = p_bank_code
    and v_previous.account_last4 = p_last4 then
    update public.payout_destinations set notification_email = p_email, holder_name = p_holder_name,
      status = case when v_previous.status = 'pending_review' then 'pending_review' else p_status end,
      updated_at = now() where id = v_previous.id;
    return v_previous.id;
  end if;
  update public.payout_destinations set is_current = false, updated_at = now()
  where professional_id = p_professional_id and is_current;
  insert into public.payout_destinations
    (professional_id, bank_code, bank_name, account_last4, resolved_name, holder_name, notification_email, recipient_code, status)
  values (p_professional_id, p_bank_code, p_bank_name, p_last4, p_resolved_name, p_holder_name, p_email, p_recipient_code,
    case when v_previous.id is not null then 'pending_review' else p_status end)
  returning id into v_id;
  if found and v_previous.id is not null then
    update public.professional_earnings e set hold_reason = 'Payout bank changed; admin review required'
    where e.professional_id = p_professional_id and e.hold_reason is null
      and e.net_kobo > coalesce((select sum(a.amount_kobo) from public.payout_allocations a
        join public.professional_payouts p on p.id = a.payout_id
        where a.earning_id = e.id and p.status = 'success'), 0);
  end if;
  return v_id;
end $$;

revoke all on function public.replace_payout_destination(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_payout_destination(uuid, text, text, text, text, text, text, text, text) to service_role;

create or replace function public.approve_payout_destination(p_destination_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_professional_id uuid;
begin
  update public.payout_destinations set status = 'verified', updated_at = now()
  where id = p_destination_id and is_current and status = 'pending_review'
  returning professional_id into v_professional_id;
  if v_professional_id is null then raise exception 'Destination is not awaiting review'; end if;
  update public.professional_earnings set hold_reason = null
  where professional_id = v_professional_id and hold_reason = 'Payout bank changed; admin review required';
end $$;

revoke all on function public.approve_payout_destination(uuid) from public, anon, authenticated;
grant execute on function public.approve_payout_destination(uuid) to service_role;

create or replace function public.admin_payout_queue(p_cutoff timestamptz, p_limit integer, p_offset integer)
returns table (
  earning_id uuid, professional_id uuid, professional_name text, title text, earned_at timestamptz,
  net_kobo bigint, paid_kobo bigint, reserved_kobo bigint, available_kobo bigint, hold_reason text,
  destination_id uuid, destination_status text, bank_name text, account_last4 text
) language sql security definer set search_path = public as $$
  with balances as (
    select e.*,
      coalesce((select sum(a.amount_kobo) from public.payout_allocations a join public.professional_payouts p on p.id = a.payout_id
        where a.earning_id = e.id and p.status = 'success'), 0)::bigint as paid,
      coalesce((select sum(a.amount_kobo) from public.payout_allocations a join public.professional_payouts p on p.id = a.payout_id
        where a.earning_id = e.id and p.status = 'pending'), 0)::bigint as reserved
    from public.professional_earnings e where e.earned_at < p_cutoff
  )
  select b.id, b.professional_id, trim(concat_ws(' ', p.first_name, p.last_name)), b.title, b.earned_at,
    b.net_kobo, b.paid, b.reserved, greatest(b.net_kobo - b.paid - b.reserved, 0), b.hold_reason,
    d.id, d.status, d.bank_name, d.account_last4
  from balances b join public.profiles p on p.id = b.professional_id
    left join public.payout_destinations d on d.professional_id = b.professional_id and d.is_current
  where b.net_kobo > b.paid + b.reserved
  order by b.earned_at, b.id limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

revoke all on function public.admin_payout_queue(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_payout_queue(timestamptz, integer, integer) to service_role;

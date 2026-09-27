alter table public.professional_availability
  add column if not exists capacity integer not null default 1,
  add column if not exists is_paused boolean not null default false;

alter table public.appointments
  add column if not exists price_amount numeric(12,2),
  add column if not exists price_currency text;

alter table public.appointments
  drop constraint if exists appointments_price_amount_check;
alter table public.appointments
  add constraint appointments_price_amount_check check (price_amount is null or price_amount > 0);

create or replace function public.prevent_unpaid_appointment_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and new.payment_made_at is null then
    raise exception 'Payment must be confirmed before completion';
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_require_payment_for_completion on public.appointments;
create trigger appointments_require_payment_for_completion
before insert or update on public.appointments
for each row execute function public.prevent_unpaid_appointment_completion();

create or replace function public.guard_appointment_payment_initialization()
returns trigger language plpgsql as $$
declare
  v_appointment public.appointments;
begin
  if new.payment_type <> 'appointment_full' then return new; end if;
  select * into v_appointment from public.appointments where id = new.appointment_id for update;
  if v_appointment.id is null or v_appointment.status <> 'accepted'
    or v_appointment.hired_at is null or v_appointment.price_amount is null
    or v_appointment.payment_made_at is not null then
    raise exception 'Appointment is not ready for payment';
  end if;
  return new;
end;
$$;
drop trigger if exists payments_guard_appointment_initialization on public.payments;
create trigger payments_guard_appointment_initialization
before insert on public.payments
for each row execute function public.guard_appointment_payment_initialization();

alter table public.professional_availability
  drop constraint if exists professional_availability_capacity_check;
alter table public.professional_availability
  add constraint professional_availability_capacity_check check (capacity > 0);

update public.professional_availability
set is_paused = true
where status = 'blocked' and is_paused = false;

update public.professional_availability as slot
set status = case
  when (select count(*) from public.appointments a where a.availability_id = slot.id and a.status in ('accepted', 'completed')) >= slot.capacity then 'booked'
  when slot.is_paused or slot.service_id is null then 'blocked'
  else 'open'
end;

drop index if exists public.appointments_active_availability_unique_idx;
create unique index if not exists appointments_client_active_slot_unique_idx
  on public.appointments(availability_id, client_id)
  where availability_id is not null and status in ('requested', 'accepted');
create index if not exists appointments_availability_confirmed_idx
  on public.appointments(availability_id, status)
  where availability_id is not null and status in ('accepted', 'completed');

create table if not exists public.appointment_reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  rating integer,
  review_text text,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  constraint appointment_reviews_rating_check check (
    (skipped and rating is null) or (not skipped and rating between 1 and 5)
  )
);
create index if not exists appointment_reviews_professional_idx
  on public.appointment_reviews(professional_id, created_at desc);
alter table public.appointment_reviews enable row level security;
drop policy if exists "appointment reviews visible to participants" on public.appointment_reviews;
create policy "appointment reviews visible to participants"
  on public.appointment_reviews for select to authenticated
  using (client_id = auth.uid() or professional_id = auth.uid() or public.is_admin());
drop policy if exists "service role manages appointment reviews" on public.appointment_reviews;
create policy "service role manages appointment reviews"
  on public.appointment_reviews for all to service_role
  using (true) with check (true);
grant select on public.appointment_reviews to authenticated;
grant select, insert on public.appointment_reviews to service_role;

drop function if exists public.create_professional_availability(uuid, timestamptz, timestamptz, text);
create function public.create_professional_availability(
  p_service_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text,
  p_capacity integer default 1
)
returns public.professional_availability
language plpgsql security definer set search_path = public
as $$
declare
  v_slot public.professional_availability;
begin
  if public.user_role() <> 'professional' then raise exception 'Only professionals can create availability'; end if;
  if p_capacity is null or p_capacity < 1 then raise exception 'Number of slots must be at least one'; end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at <= now() or p_ends_at <= p_starts_at then
    raise exception 'Choose a valid future appointment schedule';
  end if;
  if not exists (
    select 1 from public.professional_services s
    where s.id = p_service_id and s.professional_id = auth.uid() and s.is_active
      and s.price_min > 0 and s.price_max = s.price_min
  ) then raise exception 'Choose an active service with one fixed price'; end if;
  insert into public.professional_availability (professional_id, service_id, starts_at, ends_at, note, capacity, status)
  values (auth.uid(), p_service_id, p_starts_at, p_ends_at, p_note, p_capacity, 'open')
  returning * into v_slot;
  return v_slot;
end;
$$;
grant execute on function public.create_professional_availability(uuid, timestamptz, timestamptz, text, integer) to authenticated, service_role;

create function public.update_professional_availability(
  p_availability_id uuid,
  p_action text,
  p_service_id uuid default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_note text default null,
  p_capacity integer default null
)
returns public.professional_availability
language plpgsql security definer set search_path = public
as $$
declare
  v_slot public.professional_availability;
  v_confirmed integer;
  v_has_bookings boolean;
begin
  select * into v_slot from public.professional_availability where id = p_availability_id for update;
  if v_slot.id is null then raise exception 'Availability not found'; end if;
  if v_slot.professional_id <> auth.uid() then raise exception 'Forbidden for this availability'; end if;
  select count(*) into v_confirmed from public.appointments
    where availability_id = v_slot.id and status in ('accepted', 'completed');
  select exists(select 1 from public.appointments where availability_id = v_slot.id) into v_has_bookings;

  if p_action = 'edit' then
    if p_capacity is null or p_capacity < 1 or p_capacity < v_confirmed then
      raise exception 'Capacity cannot be lower than confirmed bookings or less than one';
    end if;
    if p_starts_at is null or p_ends_at is null or p_starts_at <= now() or p_ends_at <= p_starts_at then
      raise exception 'Choose a valid future appointment schedule';
    end if;
    if v_has_bookings and (p_service_id is distinct from v_slot.service_id
      or p_starts_at is distinct from v_slot.starts_at or p_ends_at is distinct from v_slot.ends_at) then
      raise exception 'Time and service cannot change after a booking request';
    end if;
    if not exists (
      select 1 from public.professional_services s
      where s.id = p_service_id and s.professional_id = auth.uid() and s.is_active
        and s.price_min > 0 and s.price_max = s.price_min
    ) then raise exception 'Choose an active service with one fixed price'; end if;
    v_slot.service_id := p_service_id;
    v_slot.starts_at := p_starts_at;
    v_slot.ends_at := p_ends_at;
    v_slot.note := p_note;
    v_slot.capacity := p_capacity;
  elsif p_action = 'pause' then
    v_slot.is_paused := true;
  elsif p_action = 'resume' then
    if v_confirmed >= v_slot.capacity then raise exception 'Increase capacity before resuming this fully booked slot'; end if;
    if v_slot.starts_at <= now() then raise exception 'Past slots cannot be resumed'; end if;
    if not exists (
      select 1 from public.professional_services s
      where s.id = v_slot.service_id and s.professional_id = auth.uid() and s.is_active
        and s.price_min > 0 and s.price_max = s.price_min
    ) then raise exception 'Choose an active service with one fixed price'; end if;
    v_slot.is_paused := false;
  else
    raise exception 'Invalid slot action';
  end if;

  v_slot.status := case
    when v_confirmed >= v_slot.capacity then 'booked'
    when v_slot.is_paused or v_slot.service_id is null then 'blocked'
    else 'open'
  end;
  update public.professional_availability set
    service_id = v_slot.service_id, starts_at = v_slot.starts_at, ends_at = v_slot.ends_at,
    note = v_slot.note, capacity = v_slot.capacity, is_paused = v_slot.is_paused, status = v_slot.status
  where id = v_slot.id returning * into v_slot;
  return v_slot;
end;
$$;
grant execute on function public.update_professional_availability(uuid, text, uuid, timestamptz, timestamptz, text, integer) to authenticated, service_role;

create or replace function public.request_appointment(
  p_availability_id uuid, p_service_id uuid default null, p_inquiry_id uuid default null, p_note text default null
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare
  v_slot public.professional_availability;
  v_appointment public.appointments;
  v_inquiry_id uuid;
  v_price numeric(12,2);
  v_currency text;
begin
  if public.user_role() <> 'client' then raise exception 'Only clients can request appointments'; end if;
  select * into v_slot from public.professional_availability where id = p_availability_id for update;
  if v_slot.id is null then raise exception 'Availability not found'; end if;
  if v_slot.status <> 'open' or v_slot.is_paused or v_slot.starts_at <= now() then
    raise exception 'Availability is no longer open';
  end if;
  if v_slot.professional_id = auth.uid() then raise exception 'You cannot book your own availability'; end if;
  if p_service_id is not null and p_service_id <> v_slot.service_id then raise exception 'Choose the service linked to this slot'; end if;
  select s.price_min, s.currency into v_price, v_currency
  from public.professional_services s
  where s.id = v_slot.service_id and s.professional_id = v_slot.professional_id and s.is_active
    and s.price_min > 0 and s.price_max = s.price_min;
  if v_price is null then raise exception 'This slot needs a fixed-price service before booking'; end if;
  if exists (select 1 from public.appointments where availability_id = v_slot.id
    and client_id = auth.uid() and status in ('requested', 'accepted')) then
    raise exception 'You already have an active request for this slot';
  end if;
  if (select count(*) from public.appointments where availability_id = v_slot.id
    and status in ('accepted', 'completed')) >= v_slot.capacity then
    raise exception 'This slot is fully booked';
  end if;
  if p_inquiry_id is not null then
    select id into v_inquiry_id from public.professional_inquiries
    where id = p_inquiry_id and client_id = auth.uid() and professional_id = v_slot.professional_id;
    if v_inquiry_id is null then raise exception 'Inquiry not found for this professional'; end if;
  end if;

  insert into public.appointments (
    client_id, professional_id, service_id, availability_id, inquiry_id, starts_at, ends_at, note, status,
    price_amount, price_currency
  ) values (
    auth.uid(), v_slot.professional_id, v_slot.service_id, v_slot.id, v_inquiry_id,
    v_slot.starts_at, v_slot.ends_at, p_note, 'requested', v_price, coalesce(v_currency, 'NGN')
  ) returning * into v_appointment;

  insert into public.appointment_audit_logs (
    appointment_id, availability_id, client_id, professional_id, actor_id,
    action, previous_status, next_status, metadata
  ) values (
    v_appointment.id, v_slot.id, auth.uid(), v_slot.professional_id, auth.uid(),
    'requested', null, 'requested', jsonb_build_object('service_id', v_slot.service_id, 'inquiry_id', v_inquiry_id)
  );
  insert into public.notifications (user_id, type, title, body, data, channel)
  values (v_slot.professional_id, 'appointment_requested', 'New appointment request',
    'A client requested one of your available appointment slots.',
    jsonb_build_object('appointment_id', v_appointment.id, 'inquiry_id', v_inquiry_id, 'availability_id', v_slot.id),
    'in_app');
  return v_appointment;
end;
$$;
grant execute on function public.request_appointment(uuid, uuid, uuid, text) to authenticated, service_role;

create or replace function public.update_appointment_status(p_appointment_id uuid, p_status text)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_slot public.professional_availability;
  v_previous_status text;
  v_inquiry_id uuid;
  v_recipient uuid;
  v_confirmed integer;
begin
  if p_status not in ('accepted', 'declined', 'cancelled', 'completed') then raise exception 'Invalid appointment status'; end if;
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if v_appointment.id is null then raise exception 'Appointment not found'; end if;
  if v_appointment.availability_id is not null then
    select * into v_slot from public.professional_availability where id = v_appointment.availability_id for update;
  end if;
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if v_appointment.status in ('declined', 'cancelled', 'completed') then raise exception 'This appointment is already closed'; end if;
  if not (auth.uid() in (v_appointment.client_id, v_appointment.professional_id) or public.is_admin()) then
    raise exception 'Forbidden for this appointment';
  end if;
  if p_status in ('accepted', 'declined', 'completed') and auth.uid() <> v_appointment.professional_id and not public.is_admin() then
    raise exception 'Only the professional can set this appointment status';
  end if;
  if p_status in ('accepted', 'declined') and v_appointment.status <> 'requested' then
    raise exception 'Only requested appointments can move to this status';
  end if;
  if p_status = 'cancelled' then
    if v_appointment.status not in ('requested', 'accepted') then raise exception 'This appointment cannot be cancelled'; end if;
    if exists (
      select 1 from public.payments p where p.appointment_id = v_appointment.id
        and p.payment_type = 'appointment_full' and p.status = 'initialized'
    ) then raise exception 'Payment is in progress; contact support before cancelling'; end if;
    if auth.uid() = v_appointment.professional_id and not public.is_admin() then
      if v_appointment.status <> 'accepted' or v_appointment.payment_made_at is not null
        or now() >= v_appointment.starts_at then
        raise exception 'Professionals can cancel only unpaid accepted appointments before they start';
      end if;
    elsif auth.uid() = v_appointment.client_id and not public.is_admin()
      and now() > v_appointment.starts_at - interval '1 hour' then
      raise exception 'Cancellation deadline has passed';
    end if;
  end if;
  if p_status = 'completed' then
    if v_appointment.status <> 'accepted' then raise exception 'Only accepted appointments can be completed'; end if;
    if v_appointment.payment_made_at is null then raise exception 'Payment must be confirmed before completion'; end if;
  end if;
  if p_status = 'accepted' and v_slot.id is not null then
    if v_appointment.price_amount is null then
      raise exception 'This unpriced request must be declined and rebooked on a priced slot';
    end if;
    select count(*) into v_confirmed from public.appointments
      where availability_id = v_slot.id and status in ('accepted', 'completed');
    if v_confirmed >= v_slot.capacity then raise exception 'This slot is fully booked'; end if;
  end if;

  if p_status = 'accepted' and v_appointment.inquiry_id is null then
    select id into v_inquiry_id from public.professional_inquiries
    where client_id = v_appointment.client_id and professional_id = v_appointment.professional_id
      and (service_id = v_appointment.service_id or (service_id is null and v_appointment.service_id is null))
    limit 1;
    if v_inquiry_id is null then
      insert into public.professional_inquiries (client_id, professional_id, service_id, status)
      values (v_appointment.client_id, v_appointment.professional_id, v_appointment.service_id, 'open')
      returning id into v_inquiry_id;
    else
      update public.professional_inquiries set status = 'open' where id = v_inquiry_id;
    end if;
  end if;

  v_previous_status := v_appointment.status;
  update public.appointments set status = p_status,
    inquiry_id = coalesce(v_appointment.inquiry_id, v_inquiry_id), updated_at = now()
  where id = v_appointment.id returning * into v_appointment;

  if v_slot.id is not null then
    select count(*) into v_confirmed from public.appointments
      where availability_id = v_slot.id and status in ('accepted', 'completed');
    update public.professional_availability set status = case
      when v_confirmed >= capacity then 'booked'
      when is_paused or service_id is null then 'blocked'
      else 'open'
    end where id = v_slot.id;
  end if;

  insert into public.appointment_audit_logs (
    appointment_id, availability_id, client_id, professional_id, actor_id,
    action, previous_status, next_status, metadata
  ) values (
    v_appointment.id, v_appointment.availability_id, v_appointment.client_id, v_appointment.professional_id,
    auth.uid(), p_status, v_previous_status, p_status,
    jsonb_build_object('service_id', v_appointment.service_id, 'inquiry_id', v_appointment.inquiry_id)
  );
  v_recipient := case when auth.uid() = v_appointment.client_id then v_appointment.professional_id else v_appointment.client_id end;
  insert into public.notifications (user_id, type, title, body, data, channel) values (
    v_recipient, 'appointment_' || p_status,
    case p_status when 'accepted' then 'Appointment accepted' when 'declined' then 'Appointment declined'
      when 'cancelled' then 'Appointment cancelled' else 'Appointment completed' end,
    case p_status when 'accepted' then 'Your appointment request was accepted. You can now chat with the professional.'
      when 'declined' then 'Your appointment request was declined. You can choose another available slot.'
      when 'cancelled' then 'Your appointment was cancelled.' else 'Your appointment was marked complete.' end,
    jsonb_build_object('appointment_id', v_appointment.id, 'inquiry_id', v_appointment.inquiry_id,
      'availability_id', v_appointment.availability_id), 'in_app'
  );
  return v_appointment;
end;
$$;
grant execute on function public.update_appointment_status(uuid, text) to authenticated, service_role;

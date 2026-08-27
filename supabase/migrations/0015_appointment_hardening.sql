create table if not exists public.appointment_audit_logs (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete set null,
  availability_id uuid references public.professional_availability(id) on delete set null,
  client_id uuid references public.profiles(id) on delete set null,
  professional_id uuid references public.profiles(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('requested', 'accepted', 'declined', 'cancelled', 'completed')),
  previous_status text,
  next_status text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists appointment_audit_appointment_idx
on public.appointment_audit_logs(appointment_id, created_at desc);

create index if not exists appointment_audit_professional_idx
on public.appointment_audit_logs(professional_id, created_at desc);

create index if not exists appointment_audit_client_idx
on public.appointment_audit_logs(client_id, created_at desc);

alter table public.appointment_audit_logs enable row level security;

drop policy if exists "admins read appointment audit logs" on public.appointment_audit_logs;
create policy "admins read appointment audit logs"
on public.appointment_audit_logs for select
to authenticated
using (public.is_admin());

drop policy if exists "service role manages appointment audit logs" on public.appointment_audit_logs;
create policy "service role manages appointment audit logs"
on public.appointment_audit_logs for all
to service_role
using (true)
with check (true);

grant select on public.appointment_audit_logs to authenticated;
grant select, insert on public.appointment_audit_logs to service_role;

create or replace function public.prevent_overlapping_availability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.professional_id = new.professional_id
    and old.starts_at = new.starts_at
    and old.ends_at = new.ends_at
    and old.status in ('open', 'booked')
    and new.status in ('open', 'booked') then
    return new;
  end if;

  if new.status in ('open', 'booked') and exists (
    select 1
    from public.professional_availability existing
    where existing.professional_id = new.professional_id
      and existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.status in ('open', 'booked')
      and tstzrange(existing.starts_at, existing.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'Availability overlaps an existing open or booked slot';
  end if;

  return new;
end;
$$;

drop trigger if exists professional_availability_prevent_overlap on public.professional_availability;
create trigger professional_availability_prevent_overlap
before insert or update of professional_id, starts_at, ends_at, status
on public.professional_availability
for each row execute function public.prevent_overlapping_availability();

create or replace function public.create_professional_availability(
  p_service_id uuid default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_note text default null
)
returns public.professional_availability
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_service_id uuid;
  v_availability public.professional_availability;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if v_role <> 'professional' then
    raise exception 'Only professionals can create availability';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Availability end time must be after start time';
  end if;

  if p_starts_at <= now() then
    raise exception 'Availability must be in the future';
  end if;

  if p_service_id is not null then
    select id into v_service_id
    from public.professional_services
    where id = p_service_id
      and professional_id = auth.uid()
      and is_active = true;

    if v_service_id is null then
      raise exception 'Service not found for this professional';
    end if;
  end if;

  insert into public.professional_availability (
    professional_id,
    service_id,
    starts_at,
    ends_at,
    note,
    status
  )
  values (
    auth.uid(),
    p_service_id,
    p_starts_at,
    p_ends_at,
    p_note,
    'open'
  )
  returning * into v_availability;

  return v_availability;
end;
$$;

create or replace function public.request_appointment(
  p_availability_id uuid,
  p_service_id uuid default null,
  p_inquiry_id uuid default null,
  p_note text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_requested_service_id uuid;
  v_availability public.professional_availability;
  v_service_id uuid;
  v_inquiry_id uuid;
  v_appointment public.appointments;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if v_role <> 'client' then
    raise exception 'Only clients can request appointments';
  end if;

  select *
  into v_availability
  from public.professional_availability
  where id = p_availability_id
  for update;

  if v_availability.id is null then
    raise exception 'Availability not found';
  end if;

  if v_availability.status <> 'open' or v_availability.starts_at <= now() then
    raise exception 'Availability is no longer open';
  end if;

  if v_availability.professional_id = auth.uid() then
    raise exception 'You cannot book your own availability';
  end if;

  v_requested_service_id := coalesce(p_service_id, v_availability.service_id);
  if v_requested_service_id is not null then
    select id into v_service_id
    from public.professional_services
    where id = v_requested_service_id
      and professional_id = v_availability.professional_id
      and is_active = true;

    if v_service_id is null then
      raise exception 'Service not found for this professional';
    end if;
  end if;

  if p_inquiry_id is not null then
    select id into v_inquiry_id
    from public.professional_inquiries
    where id = p_inquiry_id
      and client_id = auth.uid()
      and professional_id = v_availability.professional_id;

    if v_inquiry_id is null then
      raise exception 'Inquiry not found for this professional';
    end if;
  end if;

  insert into public.appointments (
    client_id,
    professional_id,
    service_id,
    availability_id,
    inquiry_id,
    starts_at,
    ends_at,
    note,
    status
  )
  values (
    auth.uid(),
    v_availability.professional_id,
    v_service_id,
    v_availability.id,
    v_inquiry_id,
    v_availability.starts_at,
    v_availability.ends_at,
    p_note,
    'requested'
  )
  returning * into v_appointment;

  update public.professional_availability
  set status = 'booked'
  where id = v_availability.id;

  insert into public.appointment_audit_logs (
    appointment_id,
    availability_id,
    client_id,
    professional_id,
    actor_id,
    action,
    previous_status,
    next_status,
    metadata
  )
  values (
    v_appointment.id,
    v_availability.id,
    auth.uid(),
    v_availability.professional_id,
    auth.uid(),
    'requested',
    null,
    'requested',
    jsonb_build_object('service_id', v_service_id, 'inquiry_id', v_inquiry_id)
  );

  insert into public.notifications (user_id, type, title, body, data, channel)
  values (
    v_availability.professional_id,
    'appointment_requested',
    'New appointment request',
    'A client requested one of your available appointment slots.',
    jsonb_build_object(
      'appointment_id', v_appointment.id,
      'inquiry_id', v_appointment.inquiry_id,
      'availability_id', v_availability.id
    ),
    'in_app'
  );

  return v_appointment;
end;
$$;

create or replace function public.update_appointment_status(
  p_appointment_id uuid,
  p_status text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_appointment public.appointments;
  v_previous_status text;
  v_receiver_id uuid;
  v_title text;
  v_body text;
begin
  if p_status not in ('accepted', 'declined', 'cancelled', 'completed') then
    raise exception 'Invalid appointment status';
  end if;

  select role into v_actor_role
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id
  for update;

  if v_appointment.id is null then
    raise exception 'Appointment not found';
  end if;

  if not (
    v_appointment.client_id = auth.uid()
    or v_appointment.professional_id = auth.uid()
    or v_actor_role = 'admin'
  ) then
    raise exception 'Forbidden for this appointment';
  end if;

  if v_appointment.status in ('declined', 'cancelled', 'completed') then
    raise exception 'This appointment is already closed';
  end if;

  if p_status in ('accepted', 'declined', 'completed')
    and not (v_appointment.professional_id = auth.uid() or v_actor_role = 'admin') then
    raise exception 'Only the professional can set this appointment status';
  end if;

  if p_status = 'cancelled'
    and not (v_appointment.client_id = auth.uid() or v_actor_role = 'admin') then
    raise exception 'Only the client can cancel this appointment';
  end if;

  if p_status in ('accepted', 'declined') and v_appointment.status <> 'requested' then
    raise exception 'Only requested appointments can move to this status';
  end if;

  if p_status = 'cancelled' and v_appointment.status not in ('requested', 'accepted') then
    raise exception 'Only requested or accepted appointments can be cancelled';
  end if;

  if p_status = 'completed' and v_appointment.status <> 'accepted' then
    raise exception 'Only accepted appointments can be completed';
  end if;

  v_previous_status := v_appointment.status;

  update public.appointments
  set status = p_status
  where id = v_appointment.id
  returning * into v_appointment;

  if p_status in ('declined', 'cancelled') and v_appointment.availability_id is not null then
    update public.professional_availability
    set status = 'open'
    where id = v_appointment.availability_id
      and starts_at > now();
  end if;

  insert into public.appointment_audit_logs (
    appointment_id,
    availability_id,
    client_id,
    professional_id,
    actor_id,
    action,
    previous_status,
    next_status
  )
  values (
    v_appointment.id,
    v_appointment.availability_id,
    v_appointment.client_id,
    v_appointment.professional_id,
    auth.uid(),
    p_status,
    v_previous_status,
    p_status
  );

  v_receiver_id := case
    when auth.uid() = v_appointment.client_id then v_appointment.professional_id
    else v_appointment.client_id
  end;

  v_title := case p_status
    when 'accepted' then 'Appointment accepted'
    when 'declined' then 'Appointment declined'
    when 'cancelled' then 'Appointment cancelled'
    when 'completed' then 'Appointment completed'
  end;

  v_body := case p_status
    when 'accepted' then 'Your appointment request has been accepted.'
    when 'declined' then 'Your appointment request was declined. You can choose another available slot.'
    when 'cancelled' then 'A client cancelled an appointment request.'
    when 'completed' then 'An appointment was marked as completed.'
  end;

  insert into public.notifications (user_id, type, title, body, data, channel)
  values (
    v_receiver_id,
    'appointment_' || p_status,
    v_title,
    v_body,
    jsonb_build_object(
      'appointment_id', v_appointment.id,
      'inquiry_id', v_appointment.inquiry_id,
      'availability_id', v_appointment.availability_id
    ),
    'in_app'
  );

  return v_appointment;
end;
$$;

grant execute on function public.create_professional_availability(uuid, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.request_appointment(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.update_appointment_status(uuid, text) to authenticated, service_role;

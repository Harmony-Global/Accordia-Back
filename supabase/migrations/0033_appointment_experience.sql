alter table public.appointments
add column if not exists hired_at timestamptz,
add column if not exists hired_by uuid references public.profiles(id) on delete set null;

update public.appointments
set
  hired_at = coalesce(hired_at, payment_made_at),
  hired_by = coalesce(hired_by, payment_made_by)
where payment_made_at is not null
  and hired_at is null;

create index if not exists appointments_hired_idx
on public.appointments(hired_at)
where hired_at is not null;

alter table public.messages
add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

create index if not exists messages_appointment_created_idx
on public.messages(appointment_id, created_at)
where appointment_id is not null;

create index if not exists messages_appointment_unread_receiver_idx
on public.messages(appointment_id, receiver_id, is_read)
where appointment_id is not null and is_read = false;

with inquiry_appointments as (
  select inquiry_id, (array_agg(id))[1] as appointment_id
  from public.appointments
  where inquiry_id is not null
  group by inquiry_id
  having count(*) = 1
)
update public.messages as message
set appointment_id = inquiry_appointments.appointment_id
from inquiry_appointments
where message.inquiry_id = inquiry_appointments.inquiry_id
  and message.appointment_id is null;

create or replace function public.mark_appointment_messages_read(p_appointment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_updated_count integer;
begin
  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id;

  if v_appointment.id is null then
    raise exception 'Appointment not found';
  end if;

  if not (
    v_appointment.client_id = auth.uid()
    or v_appointment.professional_id = auth.uid()
    or public.is_admin()
  ) then
    raise exception 'Forbidden for this appointment';
  end if;

  update public.messages
  set is_read = true
  where receiver_id = auth.uid()
    and is_read = false
    and (
      appointment_id = v_appointment.id
      or (
        appointment_id is null
        and v_appointment.inquiry_id is not null
        and inquiry_id = v_appointment.inquiry_id
      )
    );

  get diagnostics v_updated_count = row_count;

  update public.notifications
  set is_read = true
  where user_id = auth.uid()
    and is_read = false
    and type = 'appointment_message'
    and data ->> 'appointment_id' = v_appointment.id::text;

  return v_updated_count;
end;
$$;

grant execute on function public.mark_appointment_messages_read(uuid) to authenticated, service_role;

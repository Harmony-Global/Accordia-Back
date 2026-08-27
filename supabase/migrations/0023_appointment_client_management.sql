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
  v_actor_role text := public.user_role();
  v_appointment public.appointments;
  v_previous_status text;
  v_notification_user_id uuid;
  v_inquiry_id uuid;
begin
  if p_status not in ('accepted', 'declined', 'cancelled', 'completed') then
    raise exception 'Invalid appointment status';
  end if;

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

  if p_status = 'cancelled'
    and v_actor_role <> 'admin'
    and auth.uid() = v_appointment.client_id
    and now() > (v_appointment.starts_at - interval '1 hour') then
    raise exception 'Cancellation deadline has passed';
  end if;

  if p_status = 'completed' and v_appointment.status <> 'accepted' then
    raise exception 'Only accepted appointments can be completed';
  end if;

  if p_status = 'accepted' and v_appointment.inquiry_id is null then
    select id
    into v_inquiry_id
    from public.professional_inquiries
    where client_id = v_appointment.client_id
      and professional_id = v_appointment.professional_id
      and (
        (service_id is null and v_appointment.service_id is null)
        or service_id = v_appointment.service_id
      )
    limit 1;

    if v_inquiry_id is null then
      insert into public.professional_inquiries (
        client_id,
        professional_id,
        service_id,
        status
      )
      values (
        v_appointment.client_id,
        v_appointment.professional_id,
        v_appointment.service_id,
        'open'
      )
      returning id into v_inquiry_id;
    else
      update public.professional_inquiries
      set status = 'open'
      where id = v_inquiry_id;
    end if;
  end if;

  v_previous_status := v_appointment.status;

  update public.appointments
  set status = p_status,
      inquiry_id = coalesce(v_appointment.inquiry_id, v_inquiry_id),
      updated_at = now()
  where id = v_appointment.id
  returning * into v_appointment;

  if p_status in ('declined', 'cancelled') and v_appointment.availability_id is not null then
    update public.professional_availability
    set status = 'open'
    where id = v_appointment.availability_id
      and ends_at > now();
  end if;

  insert into public.appointment_audit_logs (
    appointment_id,
    availability_id,
    client_id,
    professional_id,
    actor_id,
    action,
    previous_status,
    next_status,
    details
  )
  values (
    v_appointment.id,
    v_appointment.availability_id,
    v_appointment.client_id,
    v_appointment.professional_id,
    auth.uid(),
    p_status,
    v_previous_status,
    p_status,
    jsonb_build_object('service_id', v_appointment.service_id, 'inquiry_id', v_appointment.inquiry_id)
  );

  v_notification_user_id := case
    when auth.uid() = v_appointment.client_id then v_appointment.professional_id
    else v_appointment.client_id
  end;

  insert into public.notifications (user_id, type, title, body, data, channel)
  values (
    v_notification_user_id,
    'appointment_' || p_status,
    case p_status
      when 'accepted' then 'Appointment accepted'
      when 'declined' then 'Appointment declined'
      when 'cancelled' then 'Appointment cancelled'
      when 'completed' then 'Appointment completed'
    end,
    case p_status
      when 'accepted' then 'Your appointment request has been accepted. You can now chat with the professional.'
      when 'declined' then 'Your appointment request was declined. You can choose another available slot.'
      when 'cancelled' then 'A client cancelled an appointment request.'
      when 'completed' then 'An appointment was marked as completed.'
    end,
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

grant execute on function public.update_appointment_status(uuid, text) to authenticated, service_role;

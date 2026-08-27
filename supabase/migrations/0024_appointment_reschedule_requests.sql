create table if not exists public.appointment_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  requested_for uuid not null references public.profiles(id) on delete cascade,
  previous_starts_at timestamptz not null,
  previous_ends_at timestamptz not null,
  proposed_starts_at timestamptz not null,
  proposed_ends_at timestamptz not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_ends_at > proposed_starts_at),
  check (requested_by <> requested_for)
);

create unique index if not exists appointment_reschedule_one_pending_idx
on public.appointment_reschedule_requests(appointment_id)
where status = 'pending';

create index if not exists appointment_reschedule_appointment_idx
on public.appointment_reschedule_requests(appointment_id, created_at desc);

create index if not exists appointment_reschedule_requested_for_idx
on public.appointment_reschedule_requests(requested_for, status, created_at desc);

drop trigger if exists appointment_reschedule_touch_updated_at on public.appointment_reschedule_requests;
create trigger appointment_reschedule_touch_updated_at
before update on public.appointment_reschedule_requests
for each row execute function public.touch_updated_at();

alter table public.appointment_reschedule_requests enable row level security;

create or replace function public.can_access_appointment_reschedule(p_reschedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.appointment_reschedule_requests arr
    join public.appointments a on a.id = arr.appointment_id
    where arr.id = p_reschedule_id
      and (
        a.client_id = auth.uid()
        or a.professional_id = auth.uid()
        or public.user_role() = 'admin'
      )
  );
$$;

drop policy if exists "appointment reschedules visible to participants" on public.appointment_reschedule_requests;
create policy "appointment reschedules visible to participants"
on public.appointment_reschedule_requests for select
using (public.can_access_appointment_reschedule(id));

drop policy if exists "service role manages appointment reschedules" on public.appointment_reschedule_requests;
create policy "service role manages appointment reschedules"
on public.appointment_reschedule_requests for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

grant select on public.appointment_reschedule_requests to authenticated;
grant select, insert, update, delete on public.appointment_reschedule_requests to service_role;
grant execute on function public.can_access_appointment_reschedule(uuid) to authenticated, service_role;

create table if not exists public.professional_availability (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid references public.professional_services(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'booked', 'blocked')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_availability_time_valid check (ends_at > starts_at)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid references public.professional_services(id) on delete set null,
  availability_id uuid references public.professional_availability(id) on delete set null,
  inquiry_id uuid references public.professional_inquiries(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'cancelled', 'completed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_time_valid check (ends_at > starts_at)
);

create index if not exists professional_availability_professional_idx
on public.professional_availability(professional_id, starts_at);

create index if not exists professional_availability_open_idx
on public.professional_availability(professional_id, starts_at)
where status = 'open';

create index if not exists appointments_client_idx
on public.appointments(client_id, starts_at desc);

create index if not exists appointments_professional_idx
on public.appointments(professional_id, starts_at desc);

create unique index if not exists appointments_active_availability_unique_idx
on public.appointments(availability_id)
where availability_id is not null
  and status in ('requested', 'accepted');

drop trigger if exists professional_availability_touch_updated_at on public.professional_availability;
create trigger professional_availability_touch_updated_at
before update on public.professional_availability
for each row execute function public.touch_updated_at();

drop trigger if exists appointments_touch_updated_at on public.appointments;
create trigger appointments_touch_updated_at
before update on public.appointments
for each row execute function public.touch_updated_at();

alter table public.professional_availability enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "availability visible to owner or clients when open" on public.professional_availability;
create policy "availability visible to owner or clients when open"
on public.professional_availability for select
to authenticated
using (
  professional_id = auth.uid()
  or public.is_admin()
  or (
    status = 'open'
    and starts_at > now()
    and public.user_role() = 'client'
  )
);

drop policy if exists "service role manages availability" on public.professional_availability;
create policy "service role manages availability"
on public.professional_availability for all
to service_role
using (true)
with check (true);

drop policy if exists "appointments visible to participants" on public.appointments;
create policy "appointments visible to participants"
on public.appointments for select
to authenticated
using (
  client_id = auth.uid()
  or professional_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "service role manages appointments" on public.appointments;
create policy "service role manages appointments"
on public.appointments for all
to service_role
using (true)
with check (true);

grant select on public.professional_availability to authenticated;
grant select on public.appointments to authenticated;
grant select, insert, update, delete on public.professional_availability to service_role;
grant select, insert, update, delete on public.appointments to service_role;

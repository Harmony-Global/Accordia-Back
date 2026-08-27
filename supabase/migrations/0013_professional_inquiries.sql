create table if not exists public.professional_inquiries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid references public.professional_services(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, professional_id, service_id)
);

alter table public.messages
add column if not exists inquiry_id uuid references public.professional_inquiries(id) on delete cascade;

create index if not exists professional_inquiries_client_idx
on public.professional_inquiries(client_id, created_at desc);

create index if not exists professional_inquiries_professional_idx
on public.professional_inquiries(professional_id, created_at desc);

create unique index if not exists professional_inquiries_general_unique_idx
on public.professional_inquiries(client_id, professional_id)
where service_id is null;

create unique index if not exists professional_inquiries_service_unique_idx
on public.professional_inquiries(client_id, professional_id, service_id)
where service_id is not null;

create index if not exists messages_inquiry_idx
on public.messages(inquiry_id, created_at desc);

drop trigger if exists professional_inquiries_touch_updated_at on public.professional_inquiries;
create trigger professional_inquiries_touch_updated_at
before update on public.professional_inquiries
for each row execute function public.touch_updated_at();

alter table public.professional_inquiries enable row level security;

create or replace function public.can_access_professional_inquiry(
  p_inquiry_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.professional_inquiries pi
    where pi.id = p_inquiry_id
      and pi.status = 'open'
      and (
        pi.client_id = p_user_id
        or pi.professional_id = p_user_id
        or public.is_admin()
      )
  );
$$;

create or replace function public.mark_inquiry_messages_read(p_inquiry_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer;
begin
  if not public.can_access_professional_inquiry(p_inquiry_id, auth.uid()) then
    raise exception 'Inquiry not found or not accessible';
  end if;

  update public.messages
  set is_read = true
  where inquiry_id = p_inquiry_id
    and receiver_id = auth.uid()
    and is_read = false;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

drop policy if exists "professional inquiries visible to participants" on public.professional_inquiries;
create policy "professional inquiries visible to participants"
on public.professional_inquiries for select
to authenticated
using (
  client_id = auth.uid()
  or professional_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "service role manages professional inquiries" on public.professional_inquiries;
create policy "service role manages professional inquiries"
on public.professional_inquiries for all
to service_role
using (true)
with check (true);

grant select on public.professional_inquiries to authenticated;
grant select, insert, update, delete on public.professional_inquiries to service_role;
grant execute on function public.can_access_professional_inquiry(uuid, uuid) to authenticated, service_role;
grant execute on function public.mark_inquiry_messages_read(uuid) to authenticated, service_role;

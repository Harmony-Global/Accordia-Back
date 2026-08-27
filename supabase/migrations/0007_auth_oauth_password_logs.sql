create table if not exists public.password_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  event_type text not null check (
    event_type in (
      'password_created',
      'password_reset_requested',
      'password_reset_completed',
      'password_reset_blocked'
    )
  ),
  status text not null default 'completed' check (status in ('completed', 'blocked', 'failed')),
  has_password boolean not null default false,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists password_logs_user_created_idx
on public.password_logs(user_id, created_at desc);

create index if not exists password_logs_email_created_idx
on public.password_logs(lower(email), created_at desc);

create index if not exists password_logs_event_idx
on public.password_logs(event_type, status);

alter table public.password_logs enable row level security;

drop policy if exists "admins read password logs" on public.password_logs;
create policy "admins read password logs"
on public.password_logs for select
to authenticated
using (public.is_admin());

grant select on public.password_logs to authenticated;
grant select, insert on public.password_logs to service_role;

insert into public.password_logs (user_id, email, event_type, status, has_password, metadata)
select
  u.id,
  u.email,
  'password_created',
  'completed',
  true,
  jsonb_build_object('source', 'migration_backfill')
from auth.users u
where u.email is not null
  and u.encrypted_password is not null
  and not exists (
    select 1
    from public.password_logs pl
    where pl.user_id = u.id
      and pl.event_type in ('password_created', 'password_reset_completed')
      and pl.status = 'completed'
      and pl.has_password = true
  );

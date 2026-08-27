create table if not exists public.active_user_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_session_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  event_type text not null check (event_type in ('session_started', 'session_replaced')),
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

alter table public.active_user_sessions enable row level security;
alter table public.user_session_audit_logs enable row level security;

revoke all on table public.active_user_sessions from anon, authenticated;
revoke all on table public.user_session_audit_logs from anon, authenticated;

grant all on table public.active_user_sessions to service_role;
grant all on table public.user_session_audit_logs to service_role;

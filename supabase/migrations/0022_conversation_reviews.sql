create table if not exists public.conversation_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.job_conversations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  rating integer,
  review_text text,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_reviews_rating_check check (
    (skipped = true and rating is null)
    or (skipped = false and rating between 1 and 5)
  )
);

create index if not exists conversation_reviews_professional_idx
  on public.conversation_reviews(professional_id, created_at desc);

create index if not exists conversation_reviews_client_idx
  on public.conversation_reviews(client_id, created_at desc);

drop trigger if exists conversation_reviews_touch_updated_at on public.conversation_reviews;
create trigger conversation_reviews_touch_updated_at
before update on public.conversation_reviews
for each row execute function public.touch_updated_at();

alter table public.conversation_reviews enable row level security;

drop policy if exists "conversation reviews visible to participants" on public.conversation_reviews;
create policy "conversation reviews visible to participants"
on public.conversation_reviews for select
using (
  auth.role() = 'service_role'
  or client_id = auth.uid()
  or professional_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "service role manages conversation reviews" on public.conversation_reviews;
create policy "service role manages conversation reviews"
on public.conversation_reviews for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

grant select on public.conversation_reviews to authenticated;
grant select, insert, update, delete on public.conversation_reviews to service_role;

alter table public.profiles
  add column if not exists location text,
  add column if not exists state text;

create table public.professional_main_categories (
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  primary key (professional_id, category_id)
);

insert into public.professional_main_categories (professional_id, category_id)
select distinct pc.professional_id, c.parent_id
from public.professional_categories pc
join public.categories c on c.id = pc.category_id
where c.level = 'sub' and c.parent_id is not null
on conflict do nothing;

create or replace function public.validate_professional_main_category()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.categories where id = new.category_id and level = 'main' and is_active) then
    raise exception 'Choose an active main category';
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.professional_main_categories where professional_id = new.professional_id) >= 5 then
      raise exception 'Choose no more than five main categories';
    end if;
  elsif new.professional_id is distinct from old.professional_id or new.category_id is distinct from old.category_id then
    if (select count(*) from public.professional_main_categories where professional_id = new.professional_id) > 5
      or (new.professional_id is distinct from old.professional_id and
        (select count(*) from public.professional_main_categories where professional_id = new.professional_id) >= 5) then
      raise exception 'Choose no more than five main categories';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_professional_main_category before insert or update on public.professional_main_categories
for each row execute function public.validate_professional_main_category();

create or replace function public.validate_professional_category_link()
returns trigger language plpgsql set search_path = public as $$
declare selected public.categories%rowtype;
begin
  select * into selected from public.categories where id = new.category_id;
  if selected.id is null or not selected.is_active or selected.level not in ('sub', 'legacy') then
    raise exception 'Choose an active subcategory or legacy category';
  end if;
  if selected.level = 'sub' and not exists (
    select 1 from public.professional_main_categories
    where professional_id = new.professional_id and category_id = selected.parent_id
  ) then
    raise exception 'Select the parent main category first';
  end if;
  return new;
end;
$$;
create trigger validate_professional_category_link before insert or update on public.professional_categories
for each row execute function public.validate_professional_category_link();

create or replace function public.set_professional_category_selection(
  p_user_id uuid, p_main_ids uuid[], p_category_ids uuid[]
) returns void language plpgsql security definer set search_path = public as $$
declare v_professional_id uuid;
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized';
  end if;
  select id into v_professional_id from public.professional_profiles where user_id = p_user_id for update;
  if v_professional_id is null then raise exception 'Professional profile not found'; end if;
  if cardinality(p_main_ids) > 5 or cardinality(p_main_ids) <> (select count(distinct x) from unnest(p_main_ids) x) then
    raise exception 'Choose no more than five distinct main categories';
  end if;
  if cardinality(p_category_ids) <> (select count(distinct x) from unnest(p_category_ids) x) then
    raise exception 'Duplicate category selection';
  end if;
  if exists (select 1 from unnest(p_main_ids) x left join public.categories c on c.id = x
    where c.id is null or c.level <> 'main' or not c.is_active) then
    raise exception 'Invalid main category';
  end if;
  if exists (select 1 from unnest(p_category_ids) x left join public.categories c on c.id = x
    where c.id is null or not c.is_active or c.level not in ('sub', 'legacy')
      or (c.level = 'sub' and not c.parent_id = any(p_main_ids))) then
    raise exception 'Subcategory must belong to a selected main category';
  end if;
  delete from public.professional_categories where professional_id = v_professional_id;
  delete from public.professional_main_categories where professional_id = v_professional_id;
  insert into public.professional_main_categories(professional_id, category_id)
    select v_professional_id, x from unnest(p_main_ids) x;
  insert into public.professional_categories(professional_id, category_id)
    select v_professional_id, x from unnest(p_category_ids) x;
end;
$$;
revoke all on function public.set_professional_category_selection(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.set_professional_category_selection(uuid, uuid[], uuid[]) to authenticated, service_role;
alter table public.professional_main_categories enable row level security;
create policy "read selected main categories" on public.professional_main_categories for select to authenticated
using (true);
grant select on public.professional_main_categories to authenticated;
grant select, insert, delete on public.professional_main_categories to service_role;
revoke insert, update, delete on public.professional_categories from authenticated;

create table public.professional_portfolio (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(user_id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  file_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index professional_portfolio_owner_idx on public.professional_portfolio(professional_id, created_at desc);
create trigger professional_portfolio_touch before update on public.professional_portfolio
for each row execute function public.touch_updated_at();
alter table public.professional_portfolio enable row level security;
create policy "portfolio visible to signed in users" on public.professional_portfolio for select to authenticated
using (true);
grant select on public.professional_portfolio to authenticated;
grant select, insert, update, delete on public.professional_portfolio to service_role;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('professional-portfolio', 'professional-portfolio', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.sync_confirmed_auth_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email and new.email_confirmed_at is not null then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
create trigger sync_confirmed_auth_email after update of email on auth.users
for each row execute function public.sync_confirmed_auth_email();

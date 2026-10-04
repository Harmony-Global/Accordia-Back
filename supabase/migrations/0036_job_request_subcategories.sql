create or replace function public.require_job_subcategory()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.categories
    where id = new.category_id and level = 'sub' and is_active = true
  ) then
    raise exception 'Job requests require an active subcategory';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_require_subcategory on public.jobs;
create trigger jobs_require_subcategory
before insert or update of category_id on public.jobs
for each row execute function public.require_job_subcategory();

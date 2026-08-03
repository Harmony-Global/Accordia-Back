alter table public.jobs
add column if not exists number_of_professionals integer not null default 1;

alter table public.jobs
drop constraint if exists jobs_number_of_professionals_check;

alter table public.jobs
add constraint jobs_number_of_professionals_check
check (number_of_professionals between 1 and 50);


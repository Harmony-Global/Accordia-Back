alter table public.applications
add column if not exists reference_image_urls text[] not null default '{}';

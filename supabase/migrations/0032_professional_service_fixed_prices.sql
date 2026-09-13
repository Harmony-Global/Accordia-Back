update public.professional_services
set price_max = price_min
where price_max <> price_min;

alter table public.professional_services
drop constraint if exists professional_services_fixed_price_check,
add constraint professional_services_fixed_price_check check (price_max = price_min);

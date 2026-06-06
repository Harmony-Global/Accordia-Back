create or replace function public.update_my_profile(
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_avatar_url text default null,
  p_set_avatar_url boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  update public.profiles p
  set
    first_name = coalesce(p_first_name, p.first_name),
    last_name = coalesce(p_last_name, p.last_name),
    phone = coalesce(p_phone, p.phone),
    avatar_url = case when p_set_avatar_url then p_avatar_url else p.avatar_url end,
    phone_verified = case
      when p_phone is not null and p_phone <> p.phone then false
      else p.phone_verified
    end
  where p.id = auth.uid()
    and p.is_active = true
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Profile not found or inactive';
  end if;

  return v_profile;
end;
$$;

create or replace function public.verify_my_phone(p_verification_id uuid)
returns public.verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification public.verifications;
begin
  select * into v_verification
  from public.verifications
  where id = p_verification_id
    and user_id = auth.uid()
    and type = 'phone'
  for update;

  if v_verification.id is null then
    raise exception 'Phone verification not found';
  end if;

  if v_verification.status = 'verified' then
    return v_verification;
  end if;

  if v_verification.otp_hash is null or v_verification.otp_expires_at is null then
    raise exception 'Phone verification has no active OTP';
  end if;

  if v_verification.otp_expires_at < now() then
    raise exception 'OTP has expired';
  end if;

  if v_verification.otp_attempts >= 5 then
    raise exception 'Too many OTP attempts';
  end if;

  update public.verifications
  set status = 'verified',
      reviewed_at = now(),
      otp_hash = null,
      otp_expires_at = null,
      otp_attempts = 0
  where id = v_verification.id
  returning * into v_verification;

  update public.profiles p
  set phone = v_verification.value,
      phone_verified = true
  where p.id = auth.uid()
    and p.is_active = true;

  if not found then
    raise exception 'Profile not found or inactive';
  end if;

  return v_verification;
end;
$$;

drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "clients and admins update jobs" on public.jobs;
drop policy if exists "admins update jobs" on public.jobs;
create policy "admins update jobs"
on public.jobs for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke update on public.profiles from authenticated;
revoke update on public.jobs from authenticated;

grant execute on function public.update_my_profile(text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.verify_my_phone(uuid) to authenticated, service_role;

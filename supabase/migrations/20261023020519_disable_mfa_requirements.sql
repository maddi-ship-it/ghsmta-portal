-- Remove application-level MFA requirements while preserving any factors that
-- users have voluntarily enrolled with Supabase Auth.

begin;

create or replace function public.apply_profile_security_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.phone_e164 is not null and new.phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Phone numbers must use international E.164 format.';
  end if;

  if new.phone_e164 is null then
    new.phone_verified_at := null;
    new.phone_required_at := null;
  else
    if tg_op = 'INSERT' then
      new.phone_verified_at := coalesce(new.phone_verified_at, now());
    elsif old.phone_e164 is distinct from new.phone_e164
      or new.phone_verified_at is null
    then
      new.phone_verified_at := now();
    end if;
    new.phone_required_at := null;
  end if;

  new.mfa_required := false;
  new.mfa_grace_until := null;

  return new;
end;
$$;

revoke all on function public.apply_profile_security_defaults()
from public, anon, authenticated;

update public.profiles
set
  mfa_required = false,
  mfa_grace_until = null,
  updated_at = now()
where mfa_required = true
   or mfa_grace_until is not null;

comment on column public.profiles.mfa_required is
  'Legacy compatibility field. MFA is optional and this value is always false.';

comment on column public.profiles.mfa_grace_until is
  'Legacy compatibility field. MFA is optional and this value is always null.';

commit;

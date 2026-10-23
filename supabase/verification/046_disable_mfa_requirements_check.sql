-- Run after 20261023020519_disable_mfa_requirements.sql.

do $$
begin
  if exists (
    select 1
    from public.profiles
    where mfa_required = true
       or mfa_grace_until is not null
  ) then
    raise exception 'One or more profiles still require MFA.';
  end if;

  if pg_get_functiondef(
    'public.apply_profile_security_defaults()'::regprocedure
  ) not like '%new.mfa_required := false;%'
  then
    raise exception 'Profile security defaults can still require MFA.';
  end if;
end $$;

-- Run after 20260822231739_pause_mfa_for_two_months.sql.

do $$
declare
  security_function_definition text;
begin
  if exists (
    select 1
    from public.profiles
    where mfa_required = true
      and (
        mfa_grace_until is null
        or mfa_grace_until < timestamptz '2026-10-22 23:17:34.167+00'
      )
  ) then
    raise exception 'One or more MFA requirements were not moved past the pause.';
  end if;

  select pg_get_functiondef(
    'public.apply_profile_security_defaults()'::regprocedure
  ) into security_function_definition;

  if security_function_definition not ilike '%2026-10-22%'
     or security_function_definition not ilike '%program_manager%' then
    raise exception 'Profile security defaults do not preserve the MFA pause.';
  end if;
end $$;

select
  'MFA enforcement pause verification passed' as result,
  now() as verified_at;

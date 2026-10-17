do $$
begin
  if exists (
    select 1
    from public.profiles
    where phone_e164 is not null
      and phone_verified_at is null
  ) then
    raise exception 'A saved profile phone remains unverified.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_apply_security_defaults'
      and not tgisinternal
  ) then
    raise exception 'profiles_apply_security_defaults trigger is missing.';
  end if;
end;
$$;

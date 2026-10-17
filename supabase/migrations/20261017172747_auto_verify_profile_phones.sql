begin;

-- A valid number saved to a portal profile is immediately trusted for portal
-- notifications. This intentionally replaces the prior SMS-code verification
-- requirement while preserving E.164 validation.
create or replace function public.apply_profile_security_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  grace_deadline timestamptz := greatest(
    now() + interval '14 days',
    timestamptz '2026-10-22 23:17:34.167+00'
  );
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

  if new.role in ('owner', 'advisory_member', 'program_manager') then
    new.mfa_required := true;
    if tg_op = 'INSERT' then
      new.mfa_grace_until := greatest(
        coalesce(new.mfa_grace_until, grace_deadline),
        grace_deadline
      );
    elsif old.role is distinct from new.role then
      new.mfa_grace_until := grace_deadline;
    else
      new.mfa_grace_until := greatest(
        coalesce(new.mfa_grace_until, grace_deadline),
        grace_deadline
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.apply_profile_security_defaults()
from public, anon, authenticated;

update public.profiles
set
  phone_verified_at = coalesce(phone_verified_at, now()),
  phone_required_at = null,
  updated_at = now()
where phone_e164 is not null
  and (
    phone_verified_at is null
    or phone_required_at is not null
  );

create or replace function public.update_my_account_profile(
  p_full_name text,
  p_preferred_name text,
  p_phone_e164 text,
  p_pronouns text,
  p_organization text,
  p_notification_preferences jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_phone text;
begin
  normalized_phone := nullif(
    regexp_replace(trim(coalesce(p_phone_e164, '')), '[^0-9+]', '', 'g'),
    ''
  );

  if normalized_phone is null
    or normalized_phone !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception 'Enter a valid mobile number in international format, such as +14045551234.';
  end if;

  update public.profiles
  set
    full_name = nullif(trim(p_full_name), ''),
    preferred_name = nullif(trim(p_preferred_name), ''),
    phone_e164 = normalized_phone,
    phone_verified_at = now(),
    phone_required_at = null,
    pronouns = nullif(trim(p_pronouns), ''),
    organization = nullif(trim(p_organization), ''),
    notification_preferences = coalesce(
      p_notification_preferences,
      notification_preferences
    )
  where id = (select auth.uid());

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

revoke all on function public.update_my_account_profile(
  text,
  text,
  text,
  text,
  text,
  jsonb
)
from public, anon;

grant execute on function public.update_my_account_profile(
  text,
  text,
  text,
  text,
  text,
  jsonb
)
to authenticated;

comment on column public.profiles.phone_verified_at is
  'Timestamp when a valid E.164 phone was accepted by the portal. Valid saved numbers are trusted automatically.';

commit;

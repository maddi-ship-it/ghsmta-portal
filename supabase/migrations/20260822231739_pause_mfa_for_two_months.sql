-- Pause application MFA enforcement for two calendar months without removing
-- any enrolled factors. The application also treats this instant as a global
-- floor so no profile can be challenged before the pause ends.

begin;

update public.profiles
set
  mfa_grace_until = timestamptz '2026-10-22 23:17:34.167+00',
  updated_at = now()
where mfa_required = true;

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

commit;

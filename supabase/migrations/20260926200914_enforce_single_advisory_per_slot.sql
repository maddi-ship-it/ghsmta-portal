-- Preserve existing assignments while preventing any new second Advisory
-- Committee member from claiming the same schedule slot. A transaction-level
-- advisory lock makes concurrent sign-ups serialize by slot.
create or replace function public.enforce_single_advisory_per_schedule_slot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.joined_as <> 'advisory_member' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.slot_id::text, 0)
  );

  -- Allow the existing Advisory member's upsert to update participation mode.
  if exists (
    select 1
    from public.schedule_slot_staff staff
    where staff.slot_id = new.slot_id
      and staff.user_id = new.user_id
      and staff.joined_as = 'advisory_member'
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.schedule_slot_staff staff
    where staff.slot_id = new.slot_id
      and staff.joined_as = 'advisory_member'
  ) then
    raise exception
      'This slot already has an Advisory Committee member assigned.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_single_advisory_per_schedule_slot()
from public, anon, authenticated;

drop trigger if exists enforce_single_advisory_per_schedule_slot
on public.schedule_slot_staff;
create trigger enforce_single_advisory_per_schedule_slot
before insert or update of slot_id, user_id, joined_as
on public.schedule_slot_staff
for each row execute function public.enforce_single_advisory_per_schedule_slot();

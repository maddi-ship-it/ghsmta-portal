-- A schedule slot has one primary Advisory Committee seat. Additional
-- Advisory members may participate only as shadows, subject to the existing
-- three-shadow capacity guard.
-- Preserve the earliest Advisory signup as the primary seat and normalize any
-- existing additional Advisory assignments to shadows before enforcing the
-- rule for future writes.
with ranked_advisory_assignments as (
  select
    id,
    row_number() over (
      partition by slot_id
      order by joined_at asc, id asc
    ) as advisory_position
  from public.schedule_slot_staff
  where joined_as = 'advisory_member'
    and coalesce(participation_mode, 'panel') <> 'shadow'
)
update public.schedule_slot_staff staff
set participation_mode = 'shadow'
from ranked_advisory_assignments ranked
where staff.id = ranked.id
  and ranked.advisory_position > 1;

create or replace function public.enforce_single_advisory_per_schedule_slot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.joined_as <> 'advisory_member'
    or new.participation_mode = 'shadow'
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.slot_id::text, 0)
  );

  if exists (
    select 1
    from public.schedule_slot_staff staff
    where staff.slot_id = new.slot_id
      and staff.joined_as = 'advisory_member'
      and coalesce(staff.participation_mode, 'panel') <> 'shadow'
      and staff.id is distinct from new.id
  ) then
    raise exception
      'This slot already has its primary Advisory Committee member. Additional Advisory members must join as shadows.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_single_advisory_per_schedule_slot()
from public, anon, authenticated;

drop trigger if exists enforce_single_advisory_per_schedule_slot
on public.schedule_slot_staff;
create trigger enforce_single_advisory_per_schedule_slot
before insert or update of slot_id, user_id, joined_as, participation_mode
on public.schedule_slot_staff
for each row execute function public.enforce_single_advisory_per_schedule_slot();

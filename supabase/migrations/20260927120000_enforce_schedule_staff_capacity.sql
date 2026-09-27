-- Enforce the configured review-team capacity in the database so direct API
-- calls and concurrent sign-ups cannot overfill a schedule slot. The Advisory
-- Committee seat remains governed by the single-advisory trigger.
create or replace function public.enforce_schedule_staff_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_count integer;
begin
  -- Preserve an existing assignment when an upsert repeats the same seat.
  if tg_op = 'UPDATE'
    and old.slot_id = new.slot_id
    and old.user_id = new.user_id
    and old.joined_as = new.joined_as
    and old.participation_mode = new.participation_mode
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.slot_id::text, 0));

  if new.participation_mode = 'panel' and new.joined_as = 'adjudicator' then
    select count(*) into current_count
    from public.schedule_slot_staff staff
    where staff.slot_id = new.slot_id
      and staff.joined_as = 'adjudicator'
      and staff.participation_mode = 'panel'
      and staff.id is distinct from new.id;

    if current_count >= 3 then
      raise exception 'This panel already has the maximum of 3 adjudicators.';
    end if;
  elsif new.participation_mode = 'understudy' then
    select count(*) into current_count
    from public.schedule_slot_staff staff
    where staff.slot_id = new.slot_id
      and staff.participation_mode = 'understudy'
      and staff.id is distinct from new.id;

    if current_count >= 1 then
      raise exception 'This panel already has its one understudy.';
    end if;
  elsif new.participation_mode = 'shadow' then
    select count(*) into current_count
    from public.schedule_slot_staff staff
    where staff.slot_id = new.slot_id
      and staff.participation_mode = 'shadow'
      and staff.id is distinct from new.id;

    if current_count >= 3 then
      raise exception 'This panel already has the maximum of 3 shadows.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_schedule_staff_capacity()
from public, anon, authenticated;

drop trigger if exists enforce_schedule_staff_capacity
on public.schedule_slot_staff;
create trigger enforce_schedule_staff_capacity
before insert or update of slot_id, user_id, joined_as, participation_mode
on public.schedule_slot_staff
for each row execute function public.enforce_schedule_staff_capacity();

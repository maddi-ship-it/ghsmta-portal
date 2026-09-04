-- Keep the September 4 advisory training slot with the demo schools used by
-- the committee during training. Skip occupied slots so existing bookings are
-- never moved across programs.
do $$
declare
  demo_cycle_id uuid;
begin
  select cycle.id
  into demo_cycle_id
  from public.award_cycles cycle
  where cycle.cycle_key = '2026-2027-directors'
  limit 1;

  if demo_cycle_id is null then
    return;
  end if;

  update public.schedule_slots slot
  set
    cycle_id = demo_cycle_id,
    updated_at = now()
  where slot.title = 'ADVISORY COMMITTEE TRAINING SLOT'
    and (slot.starts_at at time zone 'America/New_York')::date = date '2026-09-04'
    and slot.cycle_id is distinct from demo_cycle_id
    and not exists (
      select 1
      from public.schedule_school_bookings booking
      where booking.slot_id = slot.id
    )
    and not exists (
      select 1
      from public.schedule_slot_waitlist waitlist
      where waitlist.slot_id = slot.id
        and waitlist.status in ('waiting', 'offered', 'accepted')
    );
end;
$$;

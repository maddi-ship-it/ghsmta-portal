-- Lauren remains an Advisory Committee member across the program, but is
-- filling the third adjudicator seat for King's Ridge, matching the
-- production-specific arrangement used for Leah at White County.
begin;

do $$
declare
  target_application_id constant uuid := '43268237-f25c-48ae-87c2-e9398932e387';
  target_slot_id constant uuid := 'c55c44d4-1a10-4da8-88ab-180f8ec3cfe5';
  target_user_id constant uuid := '76e685c0-ef75-43dd-b6f9-5035054aad59';
  target_staff_id constant uuid := 'ec04b007-96f4-4047-9af2-414b2889397d';
  affected_rows integer;
  scoring_adjudicator_count integer;
begin
  update public.schedule_slot_staff
  set
    joined_as = 'adjudicator',
    participation_mode = 'panel'
  where id = target_staff_id
    and slot_id = target_slot_id
    and user_id = target_user_id;

  get diagnostics affected_rows = row_count;

  if affected_rows <> 1 then
    raise exception
      'Expected one King''s Ridge schedule seat for Lauren; updated %.',
      affected_rows;
  end if;

  if not exists (
    select 1
    from public.schedule_school_bookings booking
    where booking.slot_id = target_slot_id
      and booking.application_id = target_application_id
  ) then
    raise exception 'The King''s Ridge application is not booked in the expected slot.';
  end if;

  if not exists (
    select 1
    from public.adjudicator_assignments assignment
    where assignment.application_id = target_application_id
      and assignment.adjudicator_user_id = target_user_id
      and assignment.schedule_slot_id = target_slot_id
      and assignment.participant_role = 'adjudicator'
      and assignment.can_score = true
      and assignment.can_comment = true
      and assignment.removed_at is null
  ) then
    raise exception 'Lauren''s production-specific adjudicator assignment was not synchronized.';
  end if;

  select count(*)
  into scoring_adjudicator_count
  from public.adjudicator_assignments assignment
  where assignment.application_id = target_application_id
    and assignment.participant_role = 'adjudicator'
    and assignment.can_score = true
    and assignment.removed_at is null;

  if scoring_adjudicator_count <> 3 then
    raise exception
      'Expected three active scoring adjudicators for King''s Ridge; found %.',
      scoring_adjudicator_count;
  end if;
end $$;

commit;

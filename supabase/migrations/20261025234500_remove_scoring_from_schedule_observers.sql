-- Schedule shadows and understudies are read-only observers. If an older or
-- manually detached adjudication assignment still grants scoring/commenting,
-- retire it so the current schedule role remains authoritative.

begin;

update public.adjudicator_assignments assignment
set
  can_score = false,
  can_comment = false,
  removed_at = coalesce(assignment.removed_at, now()),
  internal_notes = coalesce(
    assignment.internal_notes,
    'Removed because the current schedule role is read-only.'
  )
from public.schedule_school_bookings booking
join public.schedule_slot_staff staff
  on staff.slot_id = booking.slot_id
where assignment.application_id = booking.application_id
  and assignment.adjudicator_user_id = staff.user_id
  and staff.participation_mode in ('shadow', 'understudy')
  and assignment.removed_at is null;

commit;

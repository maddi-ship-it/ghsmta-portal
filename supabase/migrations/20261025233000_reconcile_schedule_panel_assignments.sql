-- Reconcile booked schedule panelists with adjudication assignments.
-- Existing schedule rows can predate the panel-only assignment trigger or can
-- have been imported without firing it. Shadows and understudies remain
-- read-only schedule observers and are intentionally excluded.

begin;

do $$
declare
  panelist record;
begin
  for panelist in
    select
      booking.slot_id,
      booking.application_id,
      staff.user_id,
      coalesce(staff.joined_by, booking.booked_by) as assigned_by
    from public.schedule_school_bookings booking
    join public.schedule_slot_staff staff
      on staff.slot_id = booking.slot_id
    join public.applications application
      on application.id = booking.application_id
    join public.profiles profile
      on profile.id = staff.user_id
    where staff.participation_mode = 'panel'
      and staff.joined_as in ('adjudicator', 'advisory_member')
      and application.is_archived = false
      and profile.active = true
  loop
    perform public.upsert_schedule_adjudicator_assignment(
      panelist.slot_id,
      panelist.application_id,
      panelist.user_id,
      panelist.assigned_by
    );
  end loop;
end;
$$;

commit;

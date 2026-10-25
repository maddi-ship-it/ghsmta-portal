-- A schedule shadow needs the booked application shell and application answers
-- in order to open the read-only adjudication workspace. This does not grant
-- access to scorecards or any adjudication write operation.

drop policy if exists "scheduled shadows read booked applications"
on public.applications;

create policy "scheduled shadows read booked applications"
on public.applications
for select
to authenticated
using (
  public.current_user_role() in ('adjudicator', 'advisory_member')
  and exists (
    select 1
    from public.schedule_school_bookings booking
    join public.schedule_slot_staff staff
      on staff.slot_id = booking.slot_id
    where booking.application_id = applications.id
      and staff.user_id = (select auth.uid())
      and staff.participation_mode = 'shadow'
  )
);

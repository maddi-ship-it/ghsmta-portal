-- Schedule understudies and shadows need the booked application shell and
-- answers so they can prepare for the show. This is select-only access and
-- does not create an adjudication assignment or grant any scoring, commenting,
-- approval, submission, or application-edit permission.

drop policy if exists "scheduled shadows read booked applications"
on public.applications;

drop policy if exists "scheduled observers read booked applications"
on public.applications;

create policy "scheduled observers read booked applications"
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
      and staff.participation_mode in ('understudy', 'shadow')
  )
);

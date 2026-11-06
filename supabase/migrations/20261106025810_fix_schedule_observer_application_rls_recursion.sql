-- Keep schedule observer application access out of the schedule tables' RLS
-- policies. schedule_school_bookings can consult applications for applicant
-- visibility, so joining it directly from an applications policy creates a
-- circular policy dependency for authenticated requests.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.schedule_observer_can_read_application(
  p_application_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.schedule_school_bookings booking
    join public.schedule_slot_staff staff
      on staff.slot_id = booking.slot_id
    join public.profiles profile
      on profile.id = staff.user_id
    where booking.application_id = p_application_id
      and staff.user_id = (select auth.uid())
      and staff.participation_mode in ('understudy', 'shadow')
      and profile.active
      and profile.role in ('adjudicator', 'advisory_member')
  );
$$;

revoke all on function private.schedule_observer_can_read_application(uuid)
from public, anon, authenticated;
grant execute on function private.schedule_observer_can_read_application(uuid)
to authenticated, service_role;

drop policy if exists "scheduled shadows read booked applications"
on public.applications;

drop policy if exists "scheduled observers read booked applications"
on public.applications;

create policy "scheduled observers read booked applications"
on public.applications
for select
to authenticated
using (
  private.schedule_observer_can_read_application(applications.id)
);

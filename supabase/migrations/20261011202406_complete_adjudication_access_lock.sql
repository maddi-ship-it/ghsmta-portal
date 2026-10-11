-- A completed adjudicator assignment must no longer grant access to school
-- documents, even when the adjudicator remains attached to the historical
-- schedule slot. Owners and school-team members keep their existing access.
create or replace function public.can_access_application_documents(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or public.is_application_member(p_application_id, p_user_id)
    or (
      not exists (
        select 1
        from public.adjudicator_assignments completed_assignment
        where completed_assignment.application_id = p_application_id
          and completed_assignment.adjudicator_user_id = p_user_id
          and completed_assignment.status = 'complete'
          and completed_assignment.removed_at is not null
      )
      and (
        exists (
          select 1
          from public.adjudicator_assignments assignment
          join public.profiles profile
            on profile.id = assignment.adjudicator_user_id
          where assignment.application_id = p_application_id
            and assignment.adjudicator_user_id = p_user_id
            and assignment.removed_at is null
            and profile.active = true
            and profile.role in ('adjudicator', 'advisory_member')
        )
        or exists (
          select 1
          from public.schedule_school_bookings booking
          join public.schedule_slot_staff staff
            on staff.slot_id = booking.slot_id
          join public.profiles profile
            on profile.id = staff.user_id
          where booking.application_id = p_application_id
            and staff.user_id = p_user_id
            and profile.active = true
            and profile.role in ('adjudicator', 'advisory_member')
        )
      )
    );
$$;

revoke all on function public.can_access_application_documents(uuid, uuid)
from public, anon;

grant execute on function public.can_access_application_documents(uuid, uuid)
to authenticated;

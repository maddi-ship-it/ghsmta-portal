-- Schedule shadows may follow the active panel's adjudication observations,
-- but this function remains read-only and does not grant scorecard writes.

create or replace function public.get_shared_adjudication_observations(
  p_application_id uuid
)
returns table (
  panel_order bigint,
  adjudicator_user_id uuid,
  adjudicator_name text,
  criterion_id uuid,
  observation text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role not in ('adjudicator', 'advisory_member', 'owner') then
    raise exception 'You do not have access to adjudication comments.';
  end if;

  if caller_role = 'advisory_member'
    and not public.can_advisory_review_application(
      p_application_id,
      (select auth.uid())
    )
  then
    raise exception 'You are not assigned to this application.';
  end if;

  if caller_role = 'adjudicator'
    and not exists (
      select 1
      from public.adjudicator_assignments assignment
      where assignment.application_id = p_application_id
        and assignment.adjudicator_user_id = (select auth.uid())
        and assignment.removed_at is null
    )
    and not exists (
      select 1
      from public.schedule_school_bookings booking
      join public.schedule_slot_staff staff
        on staff.slot_id = booking.slot_id
      where booking.application_id = p_application_id
        and staff.user_id = (select auth.uid())
        and staff.joined_as = 'adjudicator'
        and staff.participation_mode = 'shadow'
    )
  then
    raise exception 'You are not assigned to this application.';
  end if;

  return query
  with panel as (
    select
      assignment.adjudicator_user_id,
      row_number() over (
        order by assignment.assigned_at, assignment.id
      ) as panel_order,
      coalesce(
        nullif(trim(profile.full_name), ''),
        'Adjudicator ' || row_number() over (
          order by assignment.assigned_at, assignment.id
        )::text
      ) as adjudicator_name
    from public.adjudicator_assignments assignment
    left join public.profiles profile
      on profile.id = assignment.adjudicator_user_id
    where assignment.application_id = p_application_id
      and assignment.removed_at is null
      and (assignment.can_score or assignment.can_comment)
  )
  select
    panel.panel_order,
    panel.adjudicator_user_id,
    panel.adjudicator_name,
    score.criterion_id,
    score.observation,
    score.updated_at
  from panel
  left join public.adjudication_scorecards scorecard
    on scorecard.application_id = p_application_id
   and scorecard.adjudicator_user_id = panel.adjudicator_user_id
  left join public.adjudication_scores score
    on score.scorecard_id = scorecard.id
  order by
    panel.panel_order,
    score.criterion_id nulls first;
end;
$$;

revoke all on function public.get_shared_adjudication_observations(uuid)
from public, anon;

grant execute on function public.get_shared_adjudication_observations(uuid)
to authenticated;

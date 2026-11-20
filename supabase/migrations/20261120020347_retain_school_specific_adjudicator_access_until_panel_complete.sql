-- Keep a deliberately school-specific adjudicator role active until every
-- required adjudicator has completed that production's adjudication. This is
-- used for mixed-role participants whose program-wide role is different.

begin;

alter table public.adjudicator_assignments
  add column if not exists retain_role_until_panel_complete boolean
  not null default false;

comment on column public.adjudicator_assignments.retain_role_until_panel_complete
is 'Keeps this assignment-level role authoritative until every required adjudicator assignment for the application is complete.';

-- Lauren remains an Advisory Committee member program-wide. Only her
-- King''s Ridge / Fiddler on the Roof assignment keeps the adjudicator role.
update public.adjudicator_assignments
set retain_role_until_panel_complete = true
where application_id = '43268237-f25c-48ae-87c2-e9398932e387'::uuid
  and adjudicator_user_id = '76e685c0-ef75-43dd-b6f9-5035054aad59'::uuid
  and participant_role = 'adjudicator'::public.app_role;

do $$
declare
  flagged_rows integer;
begin
  select count(*)
  into flagged_rows
  from public.adjudicator_assignments assignment
  where assignment.application_id = '43268237-f25c-48ae-87c2-e9398932e387'::uuid
    and assignment.adjudicator_user_id = '76e685c0-ef75-43dd-b6f9-5035054aad59'::uuid
    and assignment.retain_role_until_panel_complete = true;

  if flagged_rows <> 1 then
    raise exception
      'Expected one King''s Ridge adjudicator access override for Lauren; found %.',
      flagged_rows;
  end if;
end $$;

create or replace function public.adjudication_panel_complete(
  p_application_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with required_adjudicators as (
    select
      assignment.id,
      assignment.status as assignment_status,
      scorecard.status as scorecard_status
    from public.adjudicator_assignments assignment
    left join public.adjudication_scorecards scorecard
      on scorecard.assignment_id = assignment.id
    where assignment.application_id = p_application_id
      and assignment.participant_role = 'adjudicator'::public.app_role
      and assignment.can_score = true
      and (
        assignment.removed_at is null
        or assignment.status = 'complete'
      )
  )
  select
    exists (select 1 from required_adjudicators)
    and not exists (
      select 1
      from required_adjudicators required
      where required.assignment_status <> 'complete'
        or required.scorecard_status is distinct from 'locked'
    );
$$;

revoke all on function public.adjudication_panel_complete(uuid)
from public, anon;
grant execute on function public.adjudication_panel_complete(uuid)
to authenticated, service_role;

create or replace function public.current_application_participant_role(
  p_application_id uuid
)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when assignment.retain_role_until_panel_complete
          and public.adjudication_panel_complete(p_application_id)
          then null
        else assignment.participant_role
      end
      from public.adjudicator_assignments assignment
      where assignment.application_id = p_application_id
        and assignment.adjudicator_user_id = (select auth.uid())
        and (
          assignment.removed_at is null
          or assignment.retain_role_until_panel_complete
        )
      order by assignment.removed_at nulls first, assignment.assigned_at desc
      limit 1
    ),
    public.current_user_role()
  );
$$;

revoke all on function public.current_application_participant_role(uuid)
from public, anon;
grant execute on function public.current_application_participant_role(uuid)
to authenticated;

create or replace function public.can_advisory_review_application(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.current_user_role() = 'owner'::public.app_role
    or (
      public.current_user_role() = 'advisory_member'::public.app_role
      and (
        exists (
          select 1
          from public.adjudicator_assignments assignment
          where assignment.application_id = p_application_id
            and assignment.adjudicator_user_id = p_user_id
            and assignment.can_score = true
            and assignment.removed_at is null
            and coalesce(
              assignment.participant_role,
              'advisory_member'::public.app_role
            ) = 'advisory_member'::public.app_role
        )
        or exists (
          select 1
          from public.schedule_school_bookings booking
          join public.schedule_slot_staff staff
            on staff.slot_id = booking.slot_id
          where booking.application_id = p_application_id
            and staff.user_id = p_user_id
            and staff.joined_as = 'advisory_member'::public.app_role
            and staff.participation_mode = 'panel'
        )
        or (
          public.adjudication_panel_complete(p_application_id)
          and exists (
            select 1
            from public.adjudicator_assignments assignment
            where assignment.application_id = p_application_id
              and assignment.adjudicator_user_id = p_user_id
              and assignment.retain_role_until_panel_complete = true
          )
        )
      )
    );
$$;

revoke all on function public.can_advisory_review_application(uuid, uuid)
from public, anon;
grant execute on function public.can_advisory_review_application(uuid, uuid)
to authenticated;

-- A production-specific adjudicator must use the adjudicator observation
-- path even when their profile-level role is Advisory Committee member.
do $$
declare
  function_signature regprocedure :=
    'public.get_shared_adjudication_observations(uuid)'::regprocedure;
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(function_signature);
  updated_definition := replace(
    original_definition,
    'caller_role := public.current_user_role();',
    'caller_role := public.current_application_participant_role(p_application_id);'
  );

  if updated_definition = original_definition then
    raise exception
      'Expected caller role assignment in function %',
      function_signature;
  end if;

  execute updated_definition;
end;
$$;

commit;

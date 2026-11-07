-- A staff member can serve as an ACM in the program generally while filling
-- an adjudicator seat for one production. The assignment-level role is the
-- authority for scoring, panel averages, and schedule-created assignments.

begin;

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
      select assignment.participant_role
      from public.adjudicator_assignments assignment
      where assignment.application_id = p_application_id
        and assignment.adjudicator_user_id = (select auth.uid())
        and assignment.removed_at is null
      limit 1
    ),
    public.current_user_role()
  );
$$;

revoke all on function public.current_application_participant_role(uuid)
from public, anon;

grant execute on function public.current_application_participant_role(uuid)
to authenticated;

-- Keep the canonical scoring functions intact while making the existing
-- assignment-role column authoritative wherever the panel role is selected.
do $$
declare
  function_signature regprocedure;
  original_definition text;
  updated_definition text;
begin
  foreach function_signature in array array[
    'public.get_live_panel_category_averages(uuid)'::regprocedure,
    'public.get_live_panel_category_score_spreads(uuid)'::regprocedure,
    'public.release_adjudication(uuid,boolean,boolean,text)'::regprocedure
  ]
  loop
    original_definition := pg_get_functiondef(function_signature);
    updated_definition := replace(
      original_definition,
      'profile.role',
      'coalesce(assignment.participant_role, profile.role) as role'
    );

    if updated_definition = original_definition then
      raise exception
        'Expected profile.role in scoring function %',
        function_signature;
    end if;

    execute updated_definition;
  end loop;
end;
$$;

-- A mixed-role participant should use the adjudicator observation path for
-- the production where their assignment says adjudicator.
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

do $$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_viewdef(
    'public.owner_score_average_audit'::regclass,
    true
  );
  updated_definition := replace(
    original_definition,
    'profile.role',
    'coalesce(assignment.participant_role, profile.role) as role'
  );

  if updated_definition = original_definition then
    raise exception
      'Expected profile.role in owner_score_average_audit';
  end if;

  execute
    'create or replace view public.owner_score_average_audit ' ||
    'with (security_invoker = true) as ' || updated_definition;
end;
$$;

grant select on public.owner_score_average_audit to authenticated;

-- Schedule enrollment is the production-specific source of truth. Falling
-- back to the account role preserves imported/manual assignments that do not
-- have a schedule seat.
create or replace function public.upsert_schedule_adjudicator_assignment(
  p_slot_id uuid,
  p_application_id uuid,
  p_adjudicator_user_id uuid,
  p_assigned_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role public.app_role;
begin
  select staff.joined_as into selected_role
  from public.schedule_slot_staff staff
  where staff.slot_id = p_slot_id
    and staff.user_id = p_adjudicator_user_id
    and staff.joined_as in ('adjudicator', 'advisory_member')
  limit 1;

  if selected_role is null then
    select profile.role into selected_role
    from public.profiles profile
    where profile.id = p_adjudicator_user_id
      and profile.active = true;
  end if;

  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception
      'Scoring assignments require an adjudicator or advisory member.';
  end if;

  insert into public.adjudicator_assignments (
    application_id,
    adjudicator_user_id,
    assigned_by,
    status,
    schedule_slot_id,
    internal_notes,
    participant_role,
    can_score,
    can_comment,
    removed_at
  ) values (
    p_application_id,
    p_adjudicator_user_id,
    p_assigned_by,
    'assigned',
    p_slot_id,
    'Automatically assigned as a schedule panelist.',
    selected_role,
    true,
    true,
    null
  )
  on conflict (application_id, adjudicator_user_id) do update set
    schedule_slot_id = excluded.schedule_slot_id,
    assigned_by = coalesce(
      public.adjudicator_assignments.assigned_by,
      excluded.assigned_by
    ),
    participant_role = excluded.participant_role,
    can_score = true,
    can_comment = true,
    removed_at = null,
    internal_notes = coalesce(
      public.adjudicator_assignments.internal_notes,
      excluded.internal_notes
    );
end;
$$;

revoke all on function public.upsert_schedule_adjudicator_assignment(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

commit;

-- Category decisions follow the same assignment-based access used by the
-- adjudication workspace. This keeps valid training/demo workspaces usable
-- after their award cycle is no longer the globally active cycle.
create or replace function public.save_all_adjudication_category_proposals(
  p_application_id uuid,
  p_decisions jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.app_role;
  decision jsonb;
  selected_category_id uuid;
  selected_eligible boolean;
  selected_range_min numeric(4,2);
  selected_range_max numeric(4,2);
  selected_note text;
  selected_override boolean;
  selected_override_note text;
  existing_proposal public.adjudication_category_proposals%rowtype;
  saved_proposal_id uuid;
  decision_changed boolean;
  next_status text;
  changed_count integer := 0;
begin
  actor_role := public.current_user_role();

  if actor_role not in ('advisory_member', 'owner') then
    raise exception 'Advisory Committee or Owner access required.';
  end if;

  if not exists (
    select 1
    from public.applications application
    where application.id = p_application_id
      and coalesce(application.is_archived, false) = false
  ) then
    raise exception 'The application was not found.';
  end if;

  if not public.can_advisory_review_application(
    p_application_id,
    auth.uid()
  ) then
    raise exception 'You are not assigned to review this application.';
  end if;

  if coalesce(jsonb_typeof(p_decisions), 'null') <> 'array'
     or jsonb_array_length(p_decisions) = 0 then
    raise exception 'No category decisions were submitted.';
  end if;

  for decision in select value from jsonb_array_elements(p_decisions)
  loop
    begin
      selected_category_id := (decision ->> 'category_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'A category decision contains an invalid category ID.';
    end;

    if not exists (
      select 1
      from public.applications application
      join public.application_form_versions form_version
        on form_version.id = application.form_version_id
      join public.scoring_categories category
        on category.rubric_id = form_version.scoring_rubric_id
      where application.id = p_application_id
        and category.id = selected_category_id
        and category.active = true
    ) then
      raise exception 'A submitted category does not belong to this application rubric.';
    end if;

    selected_eligible := coalesce((decision ->> 'is_eligible')::boolean, false);
    selected_note := nullif(trim(decision ->> 'advisory_note'), '');
    selected_override := actor_role = 'owner'
      and coalesce((decision ->> 'owner_override')::boolean, false);
    selected_override_note := case
      when actor_role = 'owner'
        then nullif(trim(decision ->> 'owner_override_note'), '')
      else null
    end;

    if selected_eligible then
      selected_range_min := nullif(decision ->> 'range_min', '')::numeric;
      selected_range_max := nullif(decision ->> 'range_max', '')::numeric;

      if selected_range_min is null
         or selected_range_max is null
         or selected_range_min < 1
         or selected_range_max > 10
         or selected_range_max - selected_range_min <> 2.00 then
        raise exception 'Every eligible category needs a valid two-point range.';
      end if;
    else
      selected_range_min := null;
      selected_range_max := null;
    end if;

    if selected_override and selected_override_note is null then
      raise exception 'Every Owner override needs an override note.';
    end if;

    select * into existing_proposal
    from public.adjudication_category_proposals
    where application_id = p_application_id
      and category_id = selected_category_id
    for update;

    -- Advisory members cannot silently replace an Owner's override.
    if existing_proposal.id is not null
       and existing_proposal.status = 'overridden'
       and actor_role <> 'owner' then
      continue;
    end if;

    decision_changed := existing_proposal.id is null
      or existing_proposal.is_eligible is distinct from selected_eligible
      or existing_proposal.range_min is distinct from selected_range_min
      or existing_proposal.range_max is distinct from selected_range_max
      or existing_proposal.advisory_note is distinct from selected_note
      or (
        actor_role = 'owner'
        and existing_proposal.owner_override_note
          is distinct from selected_override_note
      )
      or (selected_override and existing_proposal.status <> 'overridden')
      or (not selected_override and existing_proposal.status = 'overridden');

    next_status := case
      when selected_override then 'overridden'
      when existing_proposal.id is not null and not decision_changed
        then existing_proposal.status
      else 'proposed'
    end;

    insert into public.adjudication_category_proposals (
      application_id,
      category_id,
      proposed_by,
      is_eligible,
      range_min,
      range_max,
      status,
      advisory_note,
      owner_override_note,
      approved_at
    ) values (
      p_application_id,
      selected_category_id,
      auth.uid(),
      selected_eligible,
      selected_range_min,
      selected_range_max,
      next_status,
      selected_note,
      case when actor_role = 'owner' then selected_override_note else null end,
      case
        when next_status = 'approved' then existing_proposal.approved_at
        else null
      end
    )
    on conflict (application_id, category_id) do update set
      proposed_by = excluded.proposed_by,
      is_eligible = excluded.is_eligible,
      range_min = excluded.range_min,
      range_max = excluded.range_max,
      status = excluded.status,
      advisory_note = excluded.advisory_note,
      owner_override_note = excluded.owner_override_note,
      approved_at = excluded.approved_at,
      updated_at = now()
    returning id into saved_proposal_id;

    if decision_changed then
      delete from public.adjudication_category_approvals
      where proposal_id = saved_proposal_id;
      changed_count := changed_count + 1;
    end if;
  end loop;

  if changed_count > 0 then
    insert into public.user_notifications (
      user_id,
      notification_type,
      title,
      body,
      href,
      related_application_id
    )
    select distinct
      assignment.adjudicator_user_id,
      'category_approval_required',
      'Category decisions ready for review',
      changed_count::text || ' eligibility or two-point range decision' ||
        case when changed_count = 1 then '' else 's' end || ' updated.',
      '/portal/adjudication/' || p_application_id::text,
      p_application_id
    from public.adjudicator_assignments assignment
    where assignment.application_id = p_application_id
      and assignment.can_score = true
      and assignment.removed_at is null;
  end if;

  return changed_count;
end;
$$;

revoke execute on function public.save_all_adjudication_category_proposals(
  uuid,
  jsonb
) from public, anon;

grant execute on function public.save_all_adjudication_category_proposals(
  uuid,
  jsonb
) to authenticated;

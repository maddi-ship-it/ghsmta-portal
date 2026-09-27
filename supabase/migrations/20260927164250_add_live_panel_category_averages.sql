-- Give assigned scoring adjudicators a live, aggregate-only panel view. Raw
-- scores and scorer identities remain protected by the existing row policies.

create or replace function public.get_live_panel_category_averages(
  p_application_id uuid
)
returns table (
  category_id uuid,
  average_score numeric,
  score_count bigint,
  scoring_member_count bigint,
  assigned_scorer_count bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_role public.app_role;
begin
  if caller_id is null then
    raise exception 'You must be signed in to view panel averages.';
  end if;

  caller_role := public.current_user_role();

  if caller_role = 'adjudicator' then
    if not exists (
      select 1
      from public.adjudicator_assignments assignment
      where assignment.application_id = p_application_id
        and assignment.adjudicator_user_id = caller_id
        and assignment.can_score = true
        and assignment.removed_at is null
    ) then
      raise exception 'You are not assigned to score this application.';
    end if;
  elsif caller_role = 'advisory_member' then
    if not public.can_advisory_review_application(p_application_id, caller_id) then
      raise exception 'You do not have access to this application.';
    end if;
  elsif caller_role <> 'owner' then
    raise exception 'You do not have access to panel averages.';
  end if;

  return query
  with target_rubric as (
    select form_version.scoring_rubric_id as rubric_id
    from public.applications application
    join public.application_form_versions form_version
      on form_version.id = application.form_version_id
    where application.id = p_application_id
  ), active_panel as (
    select assignment.adjudicator_user_id
    from public.adjudicator_assignments assignment
    where assignment.application_id = p_application_id
      and assignment.can_score = true
      and assignment.removed_at is null
  ), panel_size as (
    select count(*)::bigint as assigned_scorer_count
    from active_panel
  ), category_scores as (
    select
      category.id as category_id,
      score.score,
      score.updated_at,
      scorecard.adjudicator_user_id
    from target_rubric
    join public.scoring_categories category
      on category.rubric_id = target_rubric.rubric_id
     and category.active = true
     and category.category_key <> 'overall_production'
    left join public.adjudication_category_scoreability scoreability
      on scoreability.application_id = p_application_id
     and scoreability.category_id = category.id
    left join public.scoring_criteria criterion
      on criterion.category_id = category.id
     and criterion.active = true
    left join public.adjudication_scorecards scorecard
      on scorecard.application_id = p_application_id
     and scorecard.rubric_id = target_rubric.rubric_id
     and exists (
       select 1
       from active_panel panel
       where panel.adjudicator_user_id = scorecard.adjudicator_user_id
     )
    left join public.adjudication_scores score
      on score.scorecard_id = scorecard.id
     and score.criterion_id = criterion.id
    where coalesce(scoreability.is_scoreable, true) = true
  )
  select
    category_scores.category_id,
    round(avg(category_scores.score), 5) as average_score,
    count(category_scores.score)::bigint as score_count,
    count(distinct category_scores.adjudicator_user_id)
      filter (where category_scores.score is not null)::bigint
      as scoring_member_count,
    panel_size.assigned_scorer_count,
    max(category_scores.updated_at) as updated_at
  from category_scores
  cross join panel_size
  group by category_scores.category_id, panel_size.assigned_scorer_count;
end;
$$;

revoke all on function public.get_live_panel_category_averages(uuid)
from public, anon;

grant execute on function public.get_live_panel_category_averages(uuid)
to authenticated;

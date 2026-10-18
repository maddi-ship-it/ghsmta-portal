-- Provide live per-category member score bounds so the category-review UI can
-- suggest a valid two-point range without exposing individual score rows.
-- This follows the same panel-average policy as the primary live-average RPC:
-- with three adjudicators, Advisory Committee scores remain reference-only.

create or replace function public.get_live_panel_category_score_spreads(
  p_application_id uuid
)
returns table (
  category_id uuid,
  average_score numeric,
  minimum_member_average numeric,
  maximum_member_average numeric,
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
    raise exception 'You must be signed in to view panel score ranges.';
  end if;

  caller_role := public.current_user_role();

  if caller_role = 'advisory_member' then
    if not public.can_advisory_review_application(p_application_id, caller_id) then
      raise exception 'You do not have access to this application.';
    end if;
  elsif caller_role <> 'owner' then
    raise exception 'Panel score ranges are available only to Owners and Advisory Committee members.';
  end if;

  return query
  with target_rubric as (
    select form_version.scoring_rubric_id as rubric_id
    from public.applications application
    join public.application_form_versions form_version
      on form_version.id = application.form_version_id
    where application.id = p_application_id
  ), eligible_scoring_panel as (
    select distinct
      assignment.adjudicator_user_id,
      profile.role
    from public.adjudicator_assignments assignment
    join public.profiles profile
      on profile.id = assignment.adjudicator_user_id
    where assignment.application_id = p_application_id
      and assignment.can_score = true
      and (
        assignment.removed_at is null
        or assignment.status = 'complete'
      )
  ), panel_policy as (
    select
      count(*) filter (where role = 'adjudicator') >= 3
        as adjudicator_only
    from eligible_scoring_panel
  ), scoring_panel as (
    select panel.adjudicator_user_id
    from eligible_scoring_panel panel
    cross join panel_policy policy
    where not policy.adjudicator_only
      or panel.role = 'adjudicator'
  ), category_member_scores as (
    select
      category.id as category_id,
      panel.adjudicator_user_id,
      avg(score.score) as member_average,
      count(score.score)::bigint as member_score_count,
      coalesce(sum(score.score), 0::numeric) as member_score_sum,
      max(score.updated_at) as member_updated_at
    from target_rubric
    join public.scoring_categories category
      on category.rubric_id = target_rubric.rubric_id
     and category.active = true
     and category.category_key <> 'overall_production'
    cross join scoring_panel panel
    left join public.adjudication_category_scoreability scoreability
      on scoreability.application_id = p_application_id
     and scoreability.category_id = category.id
    left join public.scoring_criteria criterion
      on criterion.category_id = category.id
     and criterion.active = true
    left join public.adjudication_scorecards scorecard
      on scorecard.application_id = p_application_id
     and scorecard.rubric_id = target_rubric.rubric_id
     and scorecard.adjudicator_user_id = panel.adjudicator_user_id
    left join public.adjudication_scores score
      on score.scorecard_id = scorecard.id
     and score.criterion_id = criterion.id
    where coalesce(scoreability.is_scoreable, true) = true
    group by category.id, panel.adjudicator_user_id
  )
  select
    member_scores.category_id,
    round(
      sum(member_scores.member_score_sum) /
        nullif(sum(member_scores.member_score_count), 0),
      5
    ) as average_score,
    round(
      min(member_scores.member_average)
        filter (where member_scores.member_score_count > 0),
      5
    ) as minimum_member_average,
    round(
      max(member_scores.member_average)
        filter (where member_scores.member_score_count > 0),
      5
    ) as maximum_member_average,
    sum(member_scores.member_score_count)::bigint as score_count,
    count(*) filter (where member_scores.member_score_count > 0)::bigint
      as scoring_member_count,
    count(*)::bigint as assigned_scorer_count,
    max(member_scores.member_updated_at) as updated_at
  from category_member_scores member_scores
  group by member_scores.category_id;
end;
$$;

revoke all on function public.get_live_panel_category_score_spreads(uuid)
from public, anon;

grant execute on function public.get_live_panel_category_score_spreads(uuid)
to authenticated;

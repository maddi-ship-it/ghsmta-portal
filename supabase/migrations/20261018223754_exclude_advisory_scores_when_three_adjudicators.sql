-- Advisory Committee scores remain visible as a reference. When an
-- application has the standard three scoring adjudicators, only those three
-- adjudicators contribute to panel averages. With fewer than three
-- adjudicators, scoring Advisory Committee members continue to fill the gap.

begin;

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

  if caller_role = 'advisory_member' then
    if not public.can_advisory_review_application(p_application_id, caller_id) then
      raise exception 'You do not have access to this application.';
    end if;
  elsif caller_role <> 'owner' then
    raise exception 'Panel averages are available only to Owners and Advisory Committee members.';
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
  ), panel_size as (
    select count(*)::bigint as assigned_scorer_count
    from scoring_panel
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
       from scoring_panel panel
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

create or replace function public.release_adjudication(
  p_application_id uuid,
  p_release_scores boolean,
  p_release_feedback boolean,
  p_release_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  score_data jsonb := '[]'::jsonb;
  feedback_data jsonb := '[]'::jsonb;
  now_value timestamptz := now();
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can release adjudication results.';
  end if;

  if p_release_scores then
    with eligible_scoring_panel as (
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
    )
    select coalesce(
      jsonb_agg(to_jsonb(summary_row) order by summary_row.sort_order),
      '[]'::jsonb
    )
    into score_data
    from (
      select
        category.id as category_id,
        category.title,
        category.sort_order,
        round(avg(score.score)::numeric, 5) as average_score,
        count(score.score) as score_count
      from public.applications application
      join public.application_form_versions form_version
        on form_version.id = application.form_version_id
      join public.scoring_categories category
        on category.rubric_id = form_version.scoring_rubric_id
      left join public.scoring_criteria criterion
        on criterion.category_id = category.id
       and criterion.active = true
      left join public.adjudication_scorecards card
        on card.application_id = application.id
       and card.rubric_id = form_version.scoring_rubric_id
       and card.status in ('submitted', 'locked')
       and exists (
         select 1
         from scoring_panel panel
         where panel.adjudicator_user_id = card.adjudicator_user_id
       )
      left join public.adjudication_scores score
        on score.scorecard_id = card.id
       and score.criterion_id = criterion.id
      where application.id = p_application_id
        and category.active = true
      group by category.id, category.title, category.sort_order
    ) summary_row;
  end if;

  if p_release_feedback then
    select coalesce(
      jsonb_agg(to_jsonb(feedback_row) order by feedback_row.sort_order),
      '[]'::jsonb
    )
    into feedback_data
    from (
      select
        category.id as category_id,
        category.title,
        category.sort_order,
        feedback.final_comment
      from public.adjudication_panel_feedback feedback
      join public.scoring_categories category
        on category.id = feedback.category_id
      where feedback.application_id = p_application_id
        and feedback.status = 'approved'
        and nullif(trim(feedback.final_comment), '') is not null
    ) feedback_row;
  end if;

  insert into public.adjudication_releases (
    application_id,
    scores_released_at,
    feedback_released_at,
    score_snapshot,
    feedback_snapshot,
    release_notes,
    released_by
  ) values (
    p_application_id,
    case when p_release_scores then now_value else null end,
    case when p_release_feedback then now_value else null end,
    case when p_release_scores then score_data else '[]'::jsonb end,
    case when p_release_feedback then feedback_data else '[]'::jsonb end,
    p_release_notes,
    auth.uid()
  )
  on conflict (application_id) do update set
    scores_released_at = case
      when p_release_scores then now_value
      else public.adjudication_releases.scores_released_at
    end,
    feedback_released_at = case
      when p_release_feedback then now_value
      else public.adjudication_releases.feedback_released_at
    end,
    score_snapshot = case
      when p_release_scores then score_data
      else public.adjudication_releases.score_snapshot
    end,
    feedback_snapshot = case
      when p_release_feedback then feedback_data
      else public.adjudication_releases.feedback_snapshot
    end,
    release_notes = coalesce(
      p_release_notes,
      public.adjudication_releases.release_notes
    ),
    released_by = auth.uid(),
    updated_at = now_value;
end;
$$;

revoke all on function public.release_adjudication(
  uuid,
  boolean,
  boolean,
  text
) from public, anon;

grant execute on function public.release_adjudication(
  uuid,
  boolean,
  boolean,
  text
) to authenticated;

create or replace view public.owner_score_average_audit
with (security_invoker = true)
as
with eligible_scoring_panel as (
  select distinct
    assignment.application_id,
    assignment.adjudicator_user_id,
    profile.role
  from public.adjudicator_assignments assignment
  join public.profiles profile
    on profile.id = assignment.adjudicator_user_id
  where assignment.can_score = true
    and (
      assignment.removed_at is null
      or assignment.status = 'complete'
    )
), panel_policy as (
  select
    panel.application_id,
    count(*) filter (where panel.role = 'adjudicator') >= 3
      as adjudicator_only
  from eligible_scoring_panel panel
  group by panel.application_id
), scoring_panel as (
  select
    panel.application_id,
    panel.adjudicator_user_id
  from eligible_scoring_panel panel
  join panel_policy policy
    on policy.application_id = panel.application_id
  where not policy.adjudicator_only
    or panel.role = 'adjudicator'
)
select
  cycle.id as cycle_id,
  cycle.season_year,
  cycle.name as program_name,
  application.id as application_id,
  application.school_name,
  application.production_title,
  category.id as category_id,
  category.title as category_title,
  category.sort_order,
  count(score.score) as score_count,
  round(coalesce(sum(score.score), 0)::numeric, 5) as score_sum,
  case
    when count(score.score) = 0 then null
    else round(avg(score.score)::numeric, 10)
  end as unrounded_average,
  case
    when count(score.score) = 0 then null
    else round(avg(score.score)::numeric, 5)
  end as average_score,
  'Adjudicators only when 3+ are assigned; otherwise all scoring members. ROUND(SUM(score) / COUNT(score), 5)'::text
    as calculation_method
from public.applications application
join public.award_cycles cycle
  on cycle.id = application.cycle_id
join public.application_form_versions form_version
  on form_version.id = application.form_version_id
join public.scoring_categories category
  on category.rubric_id = form_version.scoring_rubric_id
 and category.active = true
left join public.scoring_criteria criterion
  on criterion.category_id = category.id
 and criterion.active = true
left join public.adjudication_scorecards card
  on card.application_id = application.id
 and card.rubric_id = form_version.scoring_rubric_id
 and card.status in ('submitted', 'locked')
 and exists (
   select 1
   from scoring_panel panel
   where panel.application_id = application.id
     and panel.adjudicator_user_id = card.adjudicator_user_id
 )
left join public.adjudication_scores score
  on score.scorecard_id = card.id
 and score.criterion_id = criterion.id
where application.is_archived = false
  and cycle.is_active = true
  and cycle.status <> 'archived'
group by
  cycle.id,
  cycle.season_year,
  cycle.name,
  application.id,
  application.school_name,
  application.production_title,
  category.id,
  category.title,
  category.sort_order;

grant select on public.owner_score_average_audit to authenticated;

-- Refresh previously released score snapshots so the school-facing result is
-- governed by the same panel-average policy as the live workspace.
update public.adjudication_releases release
set
  score_snapshot = (
    with eligible_scoring_panel as (
      select distinct
        assignment.adjudicator_user_id,
        profile.role
      from public.adjudicator_assignments assignment
      join public.profiles profile
        on profile.id = assignment.adjudicator_user_id
      where assignment.application_id = release.application_id
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
    )
    select coalesce(
      jsonb_agg(to_jsonb(summary_row) order by summary_row.sort_order),
      '[]'::jsonb
    )
    from (
      select
        category.id as category_id,
        category.title,
        category.sort_order,
        round(avg(score.score)::numeric, 5) as average_score,
        count(score.score) as score_count
      from public.applications application
      join public.application_form_versions form_version
        on form_version.id = application.form_version_id
      join public.scoring_categories category
        on category.rubric_id = form_version.scoring_rubric_id
      left join public.scoring_criteria criterion
        on criterion.category_id = category.id
       and criterion.active = true
      left join public.adjudication_scorecards card
        on card.application_id = application.id
       and card.rubric_id = form_version.scoring_rubric_id
       and card.status in ('submitted', 'locked')
       and exists (
         select 1
         from scoring_panel panel
         where panel.adjudicator_user_id = card.adjudicator_user_id
       )
      left join public.adjudication_scores score
        on score.scorecard_id = card.id
       and score.criterion_id = criterion.id
      where application.id = release.application_id
        and category.active = true
      group by category.id, category.title, category.sort_order
    ) summary_row
  ),
  updated_at = now()
where release.scores_released_at is not null;

commit;

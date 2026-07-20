-- GHSMTA Portal migration 026
-- Five-decimal score-average precision and Owner audit view.
-- Run after migrations 001-025.

begin;

create or replace function public.release_adjudication(
  p_application_id uuid,
  p_release_scores boolean,
  p_release_feedback boolean,
  p_release_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
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
      from public.scoring_categories category
      join public.scoring_rubrics rubric
        on rubric.id = category.rubric_id
      join public.applications application
        on application.cycle_id = rubric.cycle_id
      left join public.scoring_criteria criterion
        on criterion.category_id = category.id
        and criterion.active = true
      left join public.adjudication_scorecards card
        on card.application_id = application.id
        and card.rubric_id = rubric.id
        and card.status in ('submitted', 'locked')
      left join public.adjudication_scores score
        on score.scorecard_id = card.id
        and score.criterion_id = criterion.id
      where application.id = p_application_id
        and rubric.status = 'published'
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

grant execute on function public.release_adjudication(
  uuid,
  boolean,
  boolean,
  text
) to authenticated;

drop view if exists public.owner_score_average_audit;

create view public.owner_score_average_audit
with (security_invoker = true)
as
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
  'ROUND(SUM(score) / COUNT(score), 5)'::text
    as calculation_method
from public.applications application
join public.award_cycles cycle
  on cycle.id = application.cycle_id
join public.scoring_rubrics rubric
  on rubric.cycle_id = application.cycle_id
  and rubric.status = 'published'
join public.scoring_categories category
  on category.rubric_id = rubric.id
  and category.active = true
left join public.scoring_criteria criterion
  on criterion.category_id = category.id
  and criterion.active = true
left join public.adjudication_scorecards card
  on card.application_id = application.id
  and card.rubric_id = rubric.id
  and card.status in ('submitted', 'locked')
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

update public.adjudication_releases release
set
  score_snapshot = recalculated.score_data,
  updated_at = now()
from lateral (
  select coalesce(
    jsonb_agg(to_jsonb(summary_row) order by summary_row.sort_order),
    '[]'::jsonb
  ) as score_data
  from (
    select
      category.id as category_id,
      category.title,
      category.sort_order,
      round(avg(score.score)::numeric, 5) as average_score,
      count(score.score) as score_count
    from public.scoring_categories category
    join public.scoring_rubrics rubric
      on rubric.id = category.rubric_id
    join public.applications application
      on application.cycle_id = rubric.cycle_id
    left join public.scoring_criteria criterion
      on criterion.category_id = category.id
      and criterion.active = true
    left join public.adjudication_scorecards card
      on card.application_id = application.id
      and card.rubric_id = rubric.id
      and card.status in ('submitted', 'locked')
    left join public.adjudication_scores score
      on score.scorecard_id = card.id
      and score.criterion_id = criterion.id
    where application.id = release.application_id
      and rubric.status = 'published'
      and category.active = true
    group by category.id, category.title, category.sort_order
  ) summary_row
) recalculated
where release.scores_released_at is not null;

commit;

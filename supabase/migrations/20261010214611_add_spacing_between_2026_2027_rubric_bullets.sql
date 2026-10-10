-- Keep each quick-reference bullet visually separate in the adjudicator rubric.
-- This normalizes one or more existing line breaks to one blank line between bullets.

do $$
declare
  target_rubric_id uuid;
  target_rubric_count integer;
  updated_criteria_count integer;
begin
  select count(*), min(rubric.id::text)::uuid
  into target_rubric_count, target_rubric_id
  from public.scoring_rubrics rubric
  join public.award_cycles cycle on cycle.id = rubric.cycle_id
  where cycle.season_year = '2026-2027'
    and cycle.name = '2026–2027 Director Application'
    and rubric.status = 'published';

  if target_rubric_count <> 1 then
    raise exception 'Expected exactly one published 2026–2027 Director Application rubric; found %.', target_rubric_count;
  end if;

  update public.scoring_criteria criterion
  set description = regexp_replace(
    criterion.description,
    E'\n+• ',
    E'\n\n• ',
    'g'
  )
  from public.scoring_categories category
  where category.id = criterion.category_id
    and category.rubric_id = target_rubric_id
    and category.category_key <> 'overall_production'
    and category.active = true
    and criterion.active = true
    and criterion.description like '• %';

  get diagnostics updated_criteria_count = row_count;

  if updated_criteria_count <> 58 then
    raise exception 'Expected to format 58 rubric criteria; formatted %.', updated_criteria_count;
  end if;
end;
$$;

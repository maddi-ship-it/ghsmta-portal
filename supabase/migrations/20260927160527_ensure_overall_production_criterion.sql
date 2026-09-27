-- Follow-up for databases where Category 16 was inserted in the prior
-- migration but was not visible to that statement's subsequent base-table
-- scan. This is idempotent and is also safe for clean installs.
insert into public.scoring_criteria (
  category_id,
  criterion_key,
  title,
  description,
  weight,
  sort_order,
  active
)
select
  category.id,
  'overall_production_average',
  'Overall Production',
  'Automatically calculated from the equal-weight average of all scoreable categories.',
  1,
  1,
  true
from public.scoring_categories category
join public.scoring_rubrics rubric on rubric.id = category.rubric_id
join public.award_cycles cycle on cycle.id = rubric.cycle_id
where cycle.season_year = '2026-2027'
  and rubric.status = 'published'
  and category.category_key = 'overall_production'
on conflict (category_id, criterion_key) do update
set title = excluded.title,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    active = excluded.active;

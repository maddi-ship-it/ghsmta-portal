-- Rename the user-facing scoreability language without changing the
-- underlying decision fields or stored values.
update public.scoring_categories
set description =
      'An automatically calculated summary of the adjudicator''s applicable categories.',
    guidance =
      'This score is the equal-weight average of applicable Categories 1–15. It cannot be edited and has no two-point range.',
    updated_at = now()
where category_key = 'overall_production';

update public.scoring_criteria criterion
set description =
      'Automatically calculated from the equal-weight average of all applicable categories.',
    updated_at = now()
from public.scoring_categories category
where criterion.category_id = category.id
  and category.category_key = 'overall_production'
  and criterion.criterion_key = 'overall_production_average';

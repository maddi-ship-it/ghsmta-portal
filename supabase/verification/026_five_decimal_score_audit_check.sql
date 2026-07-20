select
  to_regprocedure(
    'public.release_adjudication(uuid,boolean,boolean,text)'
  ) as release_function,
  to_regclass('public.owner_score_average_audit')
    as score_average_audit_view;

select
  school_name,
  production_title,
  category_title,
  score_count,
  score_sum,
  unrounded_average,
  average_score,
  calculation_method
from public.owner_score_average_audit
order by school_name, sort_order
limit 100;

select
  application_id,
  scores_released_at,
  jsonb_pretty(score_snapshot) as score_snapshot
from public.adjudication_releases
where scores_released_at is not null
order by scores_released_at desc
limit 10;

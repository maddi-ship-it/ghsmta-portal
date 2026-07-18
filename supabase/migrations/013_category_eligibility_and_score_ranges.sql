-- Add category-level eligibility and an agreed two-point scoring range.

alter table public.adjudication_category_comments
  add column if not exists is_eligible boolean not null default true,
  add column if not exists score_range_min numeric(5,2),
  add column if not exists score_range_max numeric(5,2);

update public.adjudication_category_comments
set is_eligible = is_applicable
where is_eligible is distinct from is_applicable;

alter table public.adjudication_category_comments
  drop constraint if exists adjudication_category_comments_score_range_check;

alter table public.adjudication_category_comments
  add constraint adjudication_category_comments_score_range_check
  check (
    (
      score_range_min is null
      and score_range_max is null
    )
    or (
      score_range_min >= 1
      and score_range_max <= 10
      and score_range_max - score_range_min = 2
      and mod(score_range_min * 100, 25) = 0
      and mod(score_range_max * 100, 25) = 0
    )
  );

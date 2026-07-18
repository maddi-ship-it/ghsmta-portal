-- Enforce GHSMTA adjudication scores in 0.25-point increments.

-- Normalize any existing test scores to the nearest quarter point before
-- applying the constraint.
update public.adjudication_scores
set score = round(score * 4) / 4.0
where score is not null
  and mod(score * 100, 25) <> 0;

alter table public.adjudication_scores
  drop constraint if exists adjudication_scores_quarter_increment_check;

alter table public.adjudication_scores
  add constraint adjudication_scores_quarter_increment_check
  check (
    score is null
    or (
      score >= 1
      and score <= 10
      and mod(score * 100, 25) = 0
    )
  );

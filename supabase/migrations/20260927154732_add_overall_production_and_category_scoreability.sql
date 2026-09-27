-- Keep category eligibility and scoreability as separate adjudication decisions.
-- Eligibility continues to describe awards-program eligibility. Scoreability only
-- controls whether the panel can fairly score the category for this application.

create table if not exists public.adjudication_category_scoreability (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  category_id uuid not null references public.scoring_categories(id) on delete cascade,
  is_scoreable boolean not null default true,
  reason text,
  marked_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, category_id)
);

create index if not exists adjudication_category_scoreability_application_idx
  on public.adjudication_category_scoreability(application_id, category_id);

drop trigger if exists adjudication_category_scoreability_set_updated_at
on public.adjudication_category_scoreability;
create trigger adjudication_category_scoreability_set_updated_at
before update on public.adjudication_category_scoreability
for each row execute function public.set_updated_at();

alter table public.adjudication_category_scoreability enable row level security;
grant select, insert, update on public.adjudication_category_scoreability to authenticated;

create policy "adjudication staff read category scoreability"
on public.adjudication_category_scoreability for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "advisory and owners create category scoreability"
on public.adjudication_category_scoreability for insert to authenticated
with check (
  (
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() = 'advisory_member'
      and public.can_advisory_review_application(application_id, auth.uid())
    )
  )
  and marked_by = auth.uid()
);

create policy "advisory and owners update category scoreability"
on public.adjudication_category_scoreability for update to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'))
with check (
  (
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() = 'advisory_member'
      and public.can_advisory_review_application(application_id, auth.uid())
    )
  )
  and marked_by = auth.uid()
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adjudication_category_scoreability'
  ) then
    alter publication supabase_realtime
      add table public.adjudication_category_scoreability;
  end if;
end
$$;

-- Category 16 is part of the current published Director rubric. Its one score
-- is derived from the equal-weight average of scoreable Categories 1–15.
with target_rubrics as (
  select rubric.id
  from public.scoring_rubrics rubric
  join public.award_cycles cycle on cycle.id = rubric.cycle_id
  where cycle.season_year = '2026-2027'
    and rubric.status = 'published'
), inserted_categories as (
  insert into public.scoring_categories (
    rubric_id,
    category_key,
    title,
    description,
    guidance,
    sort_order,
    required,
    allow_not_applicable,
    active
  )
  select
    target_rubrics.id,
    'overall_production',
    'OVERALL PRODUCTION',
    'An automatically calculated summary of the adjudicator''s scoreable categories.',
    'This score is the equal-weight average of scoreable Categories 1–15. It cannot be edited and has no two-point range.',
    16,
    true,
    false,
    true
  from target_rubrics
  on conflict (rubric_id, category_key) do update
  set title = excluded.title,
      description = excluded.description,
      guidance = excluded.guidance,
      sort_order = excluded.sort_order,
      required = excluded.required,
      allow_not_applicable = excluded.allow_not_applicable,
      active = excluded.active
  returning id
)
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
  inserted_categories.id,
  'overall_production_average',
  'Overall Production',
  'Automatically calculated from the equal-weight average of all scoreable categories.',
  1,
  1,
  true
from inserted_categories
on conflict (category_id, criterion_key) do update
set title = excluded.title,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    active = excluded.active;

-- Individual rubric scores remain quarter-point values. Category 16 is a true
-- average and may use the score column's existing two-decimal precision.
alter table public.adjudication_scores
  drop constraint if exists adjudication_scores_quarter_increment_check;

create or replace function public.validate_adjudication_score_increment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  category_key_value text;
begin
  if new.score is null then
    return new;
  end if;

  if new.score < 1 or new.score > 10 then
    raise exception 'Scores must be between 1 and 10.';
  end if;

  select category.category_key
    into category_key_value
  from public.scoring_criteria criterion
  join public.scoring_categories category on category.id = criterion.category_id
  where criterion.id = new.criterion_id;

  if category_key_value <> 'overall_production'
    and mod(new.score * 100, 25) <> 0 then
    raise exception 'Scores must use quarter-point increments.';
  end if;

  return new;
end;
$$;

drop trigger if exists adjudication_scores_validate_increment
on public.adjudication_scores;
create trigger adjudication_scores_validate_increment
before insert or update of score, criterion_id on public.adjudication_scores
for each row execute function public.validate_adjudication_score_increment();

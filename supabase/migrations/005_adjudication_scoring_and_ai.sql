-- GHSMTA Portal: adjudicator scoring, private panel comments, AI-assisted
-- narrative drafting, and owner-controlled school release snapshots.
-- Run after migrations 001-004.

-- ---------------------------------------------------------------------------
-- Assignment workflow metadata
-- ---------------------------------------------------------------------------

alter table public.adjudicator_assignments
  add column if not exists status text not null default 'assigned',
  add column if not exists due_at timestamptz,
  add column if not exists internal_notes text;

alter table public.adjudicator_assignments
  drop constraint if exists adjudicator_assignments_status_check;
alter table public.adjudicator_assignments
  add constraint adjudicator_assignments_status_check check (
    status in ('assigned', 'in_progress', 'submitted', 'reopened', 'complete')
  );

-- ---------------------------------------------------------------------------
-- Versioned scoring rubric
-- ---------------------------------------------------------------------------

create table if not exists public.scoring_rubrics (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.award_cycles(id) on delete cascade,
  name text not null,
  version_number integer not null default 1,
  status text not null default 'draft',
  score_min numeric(5,2) not null default 1,
  score_max numeric(5,2) not null default 10,
  source_system text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, version_number),
  check (status in ('draft', 'published', 'archived')),
  check (score_min < score_max)
);

create table if not exists public.scoring_scale_levels (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.scoring_rubrics(id) on delete cascade,
  score numeric(5,2) not null,
  label text not null,
  description text,
  sort_order integer not null default 0,
  unique (rubric_id, score)
);

create table if not exists public.scoring_categories (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.scoring_rubrics(id) on delete cascade,
  category_key text not null,
  title text not null,
  description text,
  guidance text,
  subject_label text,
  sort_order integer not null default 0,
  required boolean not null default true,
  allow_not_applicable boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rubric_id, category_key)
);

create table if not exists public.scoring_criteria (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.scoring_categories(id) on delete cascade,
  criterion_key text not null,
  title text not null,
  description text,
  weight numeric(8,3) not null default 1,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, criterion_key),
  check (weight > 0)
);

create trigger scoring_rubrics_set_updated_at
before update on public.scoring_rubrics
for each row execute function public.set_updated_at();

create trigger scoring_categories_set_updated_at
before update on public.scoring_categories
for each row execute function public.set_updated_at();

create trigger scoring_criteria_set_updated_at
before update on public.scoring_criteria
for each row execute function public.set_updated_at();

create unique index if not exists one_published_rubric_per_cycle
  on public.scoring_rubrics(cycle_id)
  where status = 'published';

create index if not exists scoring_categories_rubric_idx
  on public.scoring_categories(rubric_id, sort_order);

create index if not exists scoring_criteria_category_idx
  on public.scoring_criteria(category_id, sort_order);

-- ---------------------------------------------------------------------------
-- Private adjudicator scorecards and comments
-- ---------------------------------------------------------------------------

create table if not exists public.adjudication_scorecards (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.adjudicator_assignments(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  adjudicator_user_id uuid not null references public.profiles(id) on delete cascade,
  rubric_id uuid not null references public.scoring_rubrics(id) on delete restrict,
  status text not null default 'draft',
  submitted_at timestamptz,
  reopened_at timestamptz,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id),
  unique (application_id, adjudicator_user_id, rubric_id),
  check (status in ('draft', 'submitted', 'reopened', 'locked'))
);

create table if not exists public.adjudication_scores (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.adjudication_scorecards(id) on delete cascade,
  criterion_id uuid not null references public.scoring_criteria(id) on delete cascade,
  score numeric(5,2),
  observation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scorecard_id, criterion_id),
  check (score is null or (score >= 1 and score <= 10))
);

create table if not exists public.adjudication_category_comments (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.adjudication_scorecards(id) on delete cascade,
  category_id uuid not null references public.scoring_categories(id) on delete cascade,
  subject_name text,
  is_applicable boolean not null default true,
  not_applicable_reason text,
  successes text,
  success_examples text,
  growth_areas text,
  growth_examples text,
  private_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scorecard_id, category_id)
);

create trigger adjudication_scorecards_set_updated_at
before update on public.adjudication_scorecards
for each row execute function public.set_updated_at();

create trigger adjudication_scores_set_updated_at
before update on public.adjudication_scores
for each row execute function public.set_updated_at();

create trigger adjudication_category_comments_set_updated_at
before update on public.adjudication_category_comments
for each row execute function public.set_updated_at();

create index if not exists adjudication_scorecards_application_idx
  on public.adjudication_scorecards(application_id, status);

create index if not exists adjudication_scorecards_adjudicator_idx
  on public.adjudication_scorecards(adjudicator_user_id, status);

-- ---------------------------------------------------------------------------
-- Owner-managed AI prompt and panel-level comments
-- ---------------------------------------------------------------------------

create table if not exists public.ai_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references public.award_cycles(id) on delete cascade,
  template_key text not null default 'panel_category_comment',
  name text not null,
  system_prompt text not null,
  user_prompt_template text not null,
  model text not null default 'gpt-5-mini',
  active boolean not null default true,
  version_number integer not null default 1,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_prompt_templates_scope_key
  on public.ai_prompt_templates(
    coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    template_key,
    version_number
  );

create table if not exists public.adjudication_panel_feedback (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  category_id uuid not null references public.scoring_categories(id) on delete cascade,
  status text not null default 'draft',
  generated_comment text,
  final_comment text,
  prompt_template_id uuid references public.ai_prompt_templates(id) on delete set null,
  prompt_snapshot text,
  model text,
  openai_request_id text,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, category_id),
  check (status in ('draft', 'generated', 'approved'))
);

create trigger ai_prompt_templates_set_updated_at
before update on public.ai_prompt_templates
for each row execute function public.set_updated_at();

create trigger adjudication_panel_feedback_set_updated_at
before update on public.adjudication_panel_feedback
for each row execute function public.set_updated_at();

-- School-facing data is a release snapshot. Raw adjudicator rows remain private.
create table if not exists public.adjudication_releases (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  scores_released_at timestamptz,
  feedback_released_at timestamptz,
  score_snapshot jsonb not null default '[]'::jsonb,
  feedback_snapshot jsonb not null default '[]'::jsonb,
  release_notes text,
  released_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(score_snapshot) = 'array'),
  check (jsonb_typeof(feedback_snapshot) = 'array')
);

create trigger adjudication_releases_set_updated_at
before update on public.adjudication_releases
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Default owner-editable prompt
-- ---------------------------------------------------------------------------

insert into public.ai_prompt_templates (
  cycle_id,
  template_key,
  name,
  system_prompt,
  user_prompt_template,
  model,
  active,
  version_number
)
select
  null,
  'panel_category_comment',
  'GHSMTA panel category narrative',
  'You synthesize the observations of multiple Georgia High School Musical Theatre Awards adjudicators into one polished panel comment. Write in the collective voice of the adjudication panel and speak directly to the school. Preserve specific observed examples. Balance celebration with constructive opportunities for growth. Do not identify individual adjudicators, invent observations, mention numeric scores, or imply that AI made the judgment. Use supportive, clear, theatre-education language. Return only the finished narrative comment.',
  'SCHOOL: {{school_name}}\nPRODUCTION: {{production_title}}\nCATEGORY: {{category_title}}\nCRITERIA:\n{{criteria}}\n\nADJUDICATOR OBSERVATIONS:\n{{raw_comments}}',
  'gpt-5-mini',
  true,
  1
where not exists (
  select 1
  from public.ai_prompt_templates
  where cycle_id is null
    and template_key = 'panel_category_comment'
    and version_number = 1
);

-- ---------------------------------------------------------------------------
-- Helper and release functions
-- ---------------------------------------------------------------------------

create or replace function public.ensure_adjudication_scorecard(
  p_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_assignment public.adjudicator_assignments%rowtype;
  selected_rubric_id uuid;
  scorecard_id uuid;
begin
  if public.current_user_role() <> 'adjudicator' then
    raise exception 'Only adjudicators can create scorecards.';
  end if;

  select *
  into selected_assignment
  from public.adjudicator_assignments
  where application_id = p_application_id
    and adjudicator_user_id = auth.uid();

  if selected_assignment.id is null then
    raise exception 'You are not assigned to this application.';
  end if;

  select sr.id
  into selected_rubric_id
  from public.scoring_rubrics sr
  join public.applications a on a.cycle_id = sr.cycle_id
  where a.id = p_application_id
    and sr.status = 'published'
  order by sr.version_number desc
  limit 1;

  if selected_rubric_id is null then
    raise exception 'No published scoring rubric exists for this program.';
  end if;

  insert into public.adjudication_scorecards (
    assignment_id,
    application_id,
    adjudicator_user_id,
    rubric_id,
    status
  ) values (
    selected_assignment.id,
    p_application_id,
    auth.uid(),
    selected_rubric_id,
    'draft'
  )
  on conflict (assignment_id) do update
    set updated_at = now()
  returning id into scorecard_id;

  update public.adjudicator_assignments
  set status = case when status = 'assigned' then 'in_progress' else status end
  where id = selected_assignment.id;

  return scorecard_id;
end;
$$;

grant execute on function public.ensure_adjudication_scorecard(uuid) to authenticated;

create or replace function public.update_own_assignment_status(
  p_assignment_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'adjudicator' then
    raise exception 'Only adjudicators can update their own assignment workflow.';
  end if;

  if p_status not in ('in_progress', 'submitted') then
    raise exception 'Invalid adjudicator assignment status.';
  end if;

  update public.adjudicator_assignments
  set status = p_status
  where id = p_assignment_id
    and adjudicator_user_id = auth.uid();

  if not found then
    raise exception 'Assignment not found.';
  end if;
end;
$$;

grant execute on function public.update_own_assignment_status(uuid, text) to authenticated;

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
    select coalesce(jsonb_agg(to_jsonb(summary_row) order by summary_row.sort_order), '[]'::jsonb)
    into score_data
    from (
      select
        category.id as category_id,
        category.title,
        category.sort_order,
        round(avg(score.score)::numeric, 3) as average_score,
        count(score.score) as score_count
      from public.scoring_categories category
      join public.scoring_rubrics rubric on rubric.id = category.rubric_id
      join public.applications application on application.cycle_id = rubric.cycle_id
      left join public.scoring_criteria criterion
        on criterion.category_id = category.id and criterion.active = true
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
    select coalesce(jsonb_agg(to_jsonb(feedback_row) order by feedback_row.sort_order), '[]'::jsonb)
    into feedback_data
    from (
      select
        category.id as category_id,
        category.title,
        category.sort_order,
        feedback.final_comment
      from public.adjudication_panel_feedback feedback
      join public.scoring_categories category on category.id = feedback.category_id
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
    release_notes = coalesce(p_release_notes, public.adjudication_releases.release_notes),
    released_by = auth.uid(),
    updated_at = now_value;
end;
$$;

grant execute on function public.release_adjudication(uuid, boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.scoring_rubrics enable row level security;
alter table public.scoring_scale_levels enable row level security;
alter table public.scoring_categories enable row level security;
alter table public.scoring_criteria enable row level security;
alter table public.adjudication_scorecards enable row level security;
alter table public.adjudication_scores enable row level security;
alter table public.adjudication_category_comments enable row level security;
alter table public.ai_prompt_templates enable row level security;
alter table public.adjudication_panel_feedback enable row level security;
alter table public.adjudication_releases enable row level security;

-- Rubric definitions are staff-facing. Applicants only receive released snapshots.
create policy "staff read scoring rubrics"
on public.scoring_rubrics for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "owners manage scoring rubrics"
on public.scoring_rubrics for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "staff read scoring scale"
on public.scoring_scale_levels for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "owners manage scoring scale"
on public.scoring_scale_levels for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "staff read scoring categories"
on public.scoring_categories for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "owners manage scoring categories"
on public.scoring_categories for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "staff read scoring criteria"
on public.scoring_criteria for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "owners manage scoring criteria"
on public.scoring_criteria for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "adjudicators read own scorecards elevated read all"
on public.adjudication_scorecards for select to authenticated
using (
  adjudicator_user_id = auth.uid()
  or public.current_user_role() in ('advisory_member', 'owner')
);

create policy "adjudicators create own scorecards"
on public.adjudication_scorecards for insert to authenticated
with check (
  adjudicator_user_id = auth.uid()
  and public.current_user_role() = 'adjudicator'
  and exists (
    select 1
    from public.adjudicator_assignments assignment
    where assignment.id = assignment_id
      and assignment.application_id = application_id
      and assignment.adjudicator_user_id = auth.uid()
  )
);

create policy "adjudicators update own open scorecards owners update all"
on public.adjudication_scorecards for update to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    adjudicator_user_id = auth.uid()
    and status in ('draft', 'reopened')
  )
)
with check (
  public.current_user_role() = 'owner'
  or adjudicator_user_id = auth.uid()
);

create policy "adjudicators read own scores elevated read all"
on public.adjudication_scores for select to authenticated
using (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        card.adjudicator_user_id = auth.uid()
        or public.current_user_role() in ('advisory_member', 'owner')
      )
  )
);

create policy "adjudicators insert own scores owners insert all"
on public.adjudication_scores for insert to authenticated
with check (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        public.current_user_role() = 'owner'
        or (card.adjudicator_user_id = auth.uid() and card.status in ('draft', 'reopened'))
      )
  )
);

create policy "adjudicators update own scores owners update all"
on public.adjudication_scores for update to authenticated
using (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        public.current_user_role() = 'owner'
        or (card.adjudicator_user_id = auth.uid() and card.status in ('draft', 'reopened'))
      )
  )
)
with check (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        public.current_user_role() = 'owner'
        or card.adjudicator_user_id = auth.uid()
      )
  )
);

create policy "adjudicators read own category comments elevated read all"
on public.adjudication_category_comments for select to authenticated
using (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        card.adjudicator_user_id = auth.uid()
        or public.current_user_role() in ('advisory_member', 'owner')
      )
  )
);

create policy "adjudicators insert own category comments owners insert all"
on public.adjudication_category_comments for insert to authenticated
with check (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        public.current_user_role() = 'owner'
        or (card.adjudicator_user_id = auth.uid() and card.status in ('draft', 'reopened'))
      )
  )
);

create policy "adjudicators update own category comments owners update all"
on public.adjudication_category_comments for update to authenticated
using (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        public.current_user_role() = 'owner'
        or (card.adjudicator_user_id = auth.uid() and card.status in ('draft', 'reopened'))
      )
  )
)
with check (
  exists (
    select 1 from public.adjudication_scorecards card
    where card.id = scorecard_id
      and (
        public.current_user_role() = 'owner'
        or card.adjudicator_user_id = auth.uid()
      )
  )
);

create policy "advisory and owners read ai prompts"
on public.ai_prompt_templates for select to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'));

create policy "owners manage ai prompts"
on public.ai_prompt_templates for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "advisory and owners read panel feedback"
on public.adjudication_panel_feedback for select to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'));

create policy "owners manage panel feedback"
on public.adjudication_panel_feedback for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "elevated read releases applicants read own released snapshot"
on public.adjudication_releases for select to authenticated
using (
  public.current_user_role() in ('advisory_member', 'owner')
  or (
    (scores_released_at is not null or feedback_released_at is not null)
    and exists (
      select 1
      from public.applications application
      where application.id = adjudication_releases.application_id
        and application.applicant_user_id = auth.uid()
    )
  )
);

create policy "owners manage releases"
on public.adjudication_releases for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

-- Explicit grants for Supabase Data API access. RLS still controls every row.
grant select, insert, update, delete on public.scoring_rubrics to authenticated;
grant select, insert, update, delete on public.scoring_scale_levels to authenticated;
grant select, insert, update, delete on public.scoring_categories to authenticated;
grant select, insert, update, delete on public.scoring_criteria to authenticated;
grant select, insert, update, delete on public.adjudication_scorecards to authenticated;
grant select, insert, update, delete on public.adjudication_scores to authenticated;
grant select, insert, update, delete on public.adjudication_category_comments to authenticated;
grant select, insert, update, delete on public.ai_prompt_templates to authenticated;
grant select, insert, update, delete on public.adjudication_panel_feedback to authenticated;
grant select, insert, update, delete on public.adjudication_releases to authenticated;

-- ---------------------------------------------------------------------------
-- Keep scoring rubrics attached when an owner duplicates an application program.
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_scoring_rubric(
  p_source_rubric_id uuid,
  p_target_cycle_id uuid,
  p_name text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_rubric public.scoring_rubrics%rowtype;
  new_rubric_id uuid;
  source_category record;
  new_category_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can duplicate scoring rubrics.';
  end if;

  select * into source_rubric
  from public.scoring_rubrics
  where id = p_source_rubric_id;

  if source_rubric.id is null then
    raise exception 'Source scoring rubric not found.';
  end if;

  insert into public.scoring_rubrics (
    cycle_id,
    name,
    version_number,
    status,
    score_min,
    score_max,
    source_system
  ) values (
    p_target_cycle_id,
    coalesce(nullif(trim(p_name), ''), source_rubric.name),
    1,
    'draft',
    source_rubric.score_min,
    source_rubric.score_max,
    source_rubric.source_system
  ) returning id into new_rubric_id;

  insert into public.scoring_scale_levels (
    rubric_id, score, label, description, sort_order
  )
  select new_rubric_id, score, label, description, sort_order
  from public.scoring_scale_levels
  where rubric_id = source_rubric.id;

  for source_category in
    select *
    from public.scoring_categories
    where rubric_id = source_rubric.id
    order by sort_order, created_at
  loop
    insert into public.scoring_categories (
      rubric_id,
      category_key,
      title,
      description,
      guidance,
      subject_label,
      sort_order,
      required,
      allow_not_applicable,
      active
    ) values (
      new_rubric_id,
      source_category.category_key,
      source_category.title,
      source_category.description,
      source_category.guidance,
      source_category.subject_label,
      source_category.sort_order,
      source_category.required,
      source_category.allow_not_applicable,
      source_category.active
    ) returning id into new_category_id;

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
      new_category_id,
      criterion_key,
      title,
      description,
      weight,
      sort_order,
      active
    from public.scoring_criteria
    where category_id = source_category.id;
  end loop;

  return new_rubric_id;
end;
$$;

grant execute on function public.duplicate_scoring_rubric(uuid, uuid, text) to authenticated;

create or replace function public.duplicate_application_program(
  p_source_cycle_id uuid,
  p_name text,
  p_season_year text,
  p_cycle_key text,
  p_program_type text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_cycle public.award_cycles%rowtype;
  source_form_id uuid;
  source_rubric_id uuid;
  new_cycle_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can duplicate application programs.';
  end if;

  select * into source_cycle
  from public.award_cycles
  where id = p_source_cycle_id;

  if source_cycle.id is null then
    raise exception 'Source application program not found.';
  end if;

  insert into public.award_cycles (
    cycle_key,
    name,
    season_year,
    program_type,
    description,
    status,
    is_active,
    cloned_from_cycle_id
  ) values (
    lower(trim(p_cycle_key)),
    trim(p_name),
    trim(p_season_year),
    coalesce(nullif(trim(p_program_type), ''), source_cycle.program_type),
    source_cycle.description,
    'draft',
    false,
    source_cycle.id
  ) returning id into new_cycle_id;

  select id into source_form_id
  from public.application_form_versions
  where cycle_id = source_cycle.id
  order by (status = 'published') desc, version_number desc
  limit 1;

  if source_form_id is not null then
    perform public.duplicate_form_version(
      source_form_id,
      new_cycle_id,
      trim(p_name) || ' Form'
    );
  end if;

  select id into source_rubric_id
  from public.scoring_rubrics
  where cycle_id = source_cycle.id
  order by (status = 'published') desc, version_number desc
  limit 1;

  if source_rubric_id is not null then
    perform public.duplicate_scoring_rubric(
      source_rubric_id,
      new_cycle_id,
      trim(p_name) || ' Scoring Rubric'
    );
  end if;

  return new_cycle_id;
end;
$$;

grant execute on function public.duplicate_application_program(uuid, text, text, text, text) to authenticated;

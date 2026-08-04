-- Assign the scoring guide to the immutable application form version. Applications
-- inherit the rubric through form_version_id, keeping scoring and application data
-- on the same historical version.

begin;

alter table public.application_form_versions
  add column if not exists scoring_rubric_id uuid
    references public.scoring_rubrics(id) on delete restrict;

create index if not exists application_form_versions_scoring_rubric_idx
  on public.application_form_versions(scoring_rubric_id)
  where scoring_rubric_id is not null;

-- Preserve the previous cycle-level behavior for forms that are already live.
update public.application_form_versions form_version
set scoring_rubric_id = rubric.id
from public.scoring_rubrics rubric
where form_version.scoring_rubric_id is null
  and rubric.cycle_id = form_version.cycle_id
  and rubric.status = 'published'
  and (
    form_version.status in ('published', 'archived')
    or exists (
      select 1
      from public.applications application
      where application.form_version_id = form_version.id
    )
  );

create or replace function public.owner_assign_scoring_rubric_to_form(
  p_form_version_id uuid,
  p_rubric_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_form public.application_form_versions%rowtype;
  selected_rubric public.scoring_rubrics%rowtype;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can assign scoring rubrics to forms.';
  end if;

  select * into selected_form
  from public.application_form_versions
  where id = p_form_version_id;

  if selected_form.id is null then
    raise exception 'Application form not found.';
  end if;

  if selected_form.status <> 'published' then
    raise exception 'A scoring rubric can only be assigned to a published form.';
  end if;

  select * into selected_rubric
  from public.scoring_rubrics
  where id = p_rubric_id;

  if selected_rubric.id is null then
    raise exception 'Scoring rubric not found.';
  end if;

  if selected_rubric.status <> 'published' then
    raise exception 'Only the active published rubric can be assigned.';
  end if;

  if selected_rubric.cycle_id <> selected_form.cycle_id then
    raise exception 'The scoring rubric and application form must belong to the same program.';
  end if;

  if exists (
    select 1
    from public.adjudication_scorecards scorecard
    join public.applications application
      on application.id = scorecard.application_id
    where application.form_version_id = selected_form.id
      and scorecard.rubric_id <> selected_rubric.id
  ) then
    raise exception 'Scoring has already begun with a different rubric for this form.';
  end if;

  update public.application_form_versions
  set scoring_rubric_id = selected_rubric.id,
      updated_at = now()
  where id = selected_form.id;
end;
$$;

revoke execute on function public.owner_assign_scoring_rubric_to_form(uuid, uuid)
from public, anon;
grant execute on function public.owner_assign_scoring_rubric_to_form(uuid, uuid)
to authenticated;

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
  if public.current_user_role() not in ('adjudicator', 'advisory_member') then
    raise exception 'A scoring participant account is required.';
  end if;

  select * into selected_assignment
  from public.adjudicator_assignments
  where application_id = p_application_id
    and adjudicator_user_id = auth.uid()
    and can_score = true
    and removed_at is null;

  if selected_assignment.id is null then
    raise exception 'You are not assigned as a scoring participant for this application.';
  end if;

  select form_version.scoring_rubric_id into selected_rubric_id
  from public.applications application
  join public.application_form_versions form_version
    on form_version.id = application.form_version_id
  where application.id = p_application_id;

  if selected_rubric_id is null then
    raise exception 'No scoring rubric is assigned to this application form.';
  end if;

  if exists (
    select 1
    from public.adjudication_scorecards scorecard
    where scorecard.assignment_id = selected_assignment.id
      and scorecard.rubric_id <> selected_rubric_id
  ) then
    raise exception 'This assignment already has a scorecard for a different rubric.';
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
  on conflict (assignment_id) do update set updated_at = now()
  returning id into scorecard_id;

  update public.adjudicator_assignments
  set status = case when status = 'assigned' then 'in_progress' else status end
  where id = selected_assignment.id;

  return scorecard_id;
end;
$$;

revoke execute on function public.ensure_adjudication_scorecard(uuid)
from public, anon;
grant execute on function public.ensure_adjudication_scorecard(uuid)
to authenticated;

-- Enforce the same form-level rubric for category decisions and appeals, even
-- when data is written outside the portal UI.
create or replace function public.validate_application_category_rubric()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  application_rubric_id uuid;
  category_rubric_id uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select form_version.scoring_rubric_id into application_rubric_id
  from public.applications application
  join public.application_form_versions form_version
    on form_version.id = application.form_version_id
  where application.id = new.application_id;

  select category.rubric_id into category_rubric_id
  from public.scoring_categories category
  where category.id = new.category_id;

  if application_rubric_id is null then
    raise exception 'No scoring rubric is assigned to this application form.';
  end if;

  if category_rubric_id is distinct from application_rubric_id then
    raise exception 'The selected category does not belong to the application form rubric.';
  end if;

  return new;
end;
$$;

drop trigger if exists adjudication_proposals_validate_form_rubric
on public.adjudication_category_proposals;
create trigger adjudication_proposals_validate_form_rubric
before insert or update of application_id, category_id
on public.adjudication_category_proposals
for each row execute function public.validate_application_category_rubric();

drop trigger if exists appeals_validate_form_rubric
on public.appeals;
create trigger appeals_validate_form_rubric
before insert or update of application_id, category_id
on public.appeals
for each row execute function public.validate_application_category_rubric();

create or replace function public.submit_adjudication_for_owner(
  p_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  review_id uuid;
  missing_scorecards integer;
  unresolved_proposals integer;
begin
  if public.current_user_role() not in ('advisory_member', 'owner') then
    raise exception 'Only an advisory committee member or owner can submit a panel review.';
  end if;

  if not exists (
    select 1
    from public.applications application
    join public.application_form_versions form_version
      on form_version.id = application.form_version_id
    where application.id = p_application_id
      and form_version.scoring_rubric_id is not null
  ) then
    raise exception 'No scoring rubric is assigned to this application form.';
  end if;

  select count(*) into missing_scorecards
  from public.adjudicator_assignments assignment
  left join public.adjudication_scorecards scorecard
    on scorecard.assignment_id = assignment.id
  where assignment.application_id = p_application_id
    and assignment.can_score = true
    and assignment.removed_at is null
    and coalesce(scorecard.status, 'missing') not in ('submitted', 'locked');

  if missing_scorecards > 0 then
    raise exception '% scoring participant(s) have not submitted their scorecard.', missing_scorecards;
  end if;

  select count(*) into unresolved_proposals
  from public.applications application
  join public.application_form_versions form_version
    on form_version.id = application.form_version_id
  join public.scoring_categories category
    on category.rubric_id = form_version.scoring_rubric_id
  left join public.adjudication_category_proposals proposal
    on proposal.application_id = application.id
   and proposal.category_id = category.id
  where application.id = p_application_id
    and category.active = true
    and coalesce(proposal.status, 'missing') not in ('approved', 'overridden');

  if unresolved_proposals > 0 then
    raise exception '% category eligibility/range decision(s) remain unresolved.', unresolved_proposals;
  end if;

  insert into public.adjudication_reviews (
    application_id,
    status,
    submitted_by,
    submitted_at
  ) values (
    p_application_id,
    'ready_for_owner',
    auth.uid(),
    now()
  )
  on conflict (application_id) do update set
    status = 'ready_for_owner',
    submitted_by = auth.uid(),
    submitted_at = now(),
    returned_at = null,
    updated_at = now()
  returning id into review_id;

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    application_id
  ) values (
    'adjudication_ready_for_owner',
    'Adjudication ready for Owner review',
    'All scorecards and category decisions are complete.',
    auth.uid(),
    p_application_id
  );

  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href,
    related_application_id
  )
  select
    profile.id,
    'adjudication_ready_for_owner',
    'Adjudication ready for review',
    application.school_name || ' — ' || coalesce(application.production_title, 'Untitled production'),
    '/portal/adjudication/' || p_application_id::text,
    p_application_id
  from public.profiles profile
  cross join public.applications application
  where profile.role = 'owner'
    and profile.active = true
    and application.id = p_application_id;

  return review_id;
end;
$$;

revoke execute on function public.submit_adjudication_for_owner(uuid)
from public, anon;
grant execute on function public.submit_adjudication_for_owner(uuid)
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

revoke execute on function public.release_adjudication(uuid, boolean, boolean, text)
from public, anon;
grant execute on function public.release_adjudication(uuid, boolean, boolean, text)
to authenticated;

drop view if exists public.owner_report_missing_scores;
create view public.owner_report_missing_scores
with (security_invoker = true)
as
select
  cycle.id as cycle_id,
  cycle.season_year,
  cycle.name as program_name,
  application.id as application_id,
  application.school_name,
  application.production_title,
  assignment.id as assignment_id,
  profile.id as adjudicator_user_id,
  coalesce(profile.full_name, profile.email, 'Portal user') as adjudicator_name,
  profile.email as adjudicator_email,
  category.id as category_id,
  category.title as category_title,
  criterion.id as criterion_id,
  criterion.title as criterion_title,
  scorecard.id as scorecard_id,
  coalesce(scorecard.status, assignment.status::text, 'not_started') as scorecard_status
from public.applications application
join public.award_cycles cycle
  on cycle.id = application.cycle_id
join public.application_form_versions form_version
  on form_version.id = application.form_version_id
join public.adjudicator_assignments assignment
  on assignment.application_id = application.id
join public.profiles profile
  on profile.id = assignment.adjudicator_user_id
join public.scoring_categories category
  on category.rubric_id = form_version.scoring_rubric_id
  and category.active = true
join public.scoring_criteria criterion
  on criterion.category_id = category.id
  and criterion.active = true
left join public.adjudication_scorecards scorecard
  on scorecard.assignment_id = assignment.id
left join public.adjudication_scores score
  on score.scorecard_id = scorecard.id
  and score.criterion_id = criterion.id
where application.is_archived = false
  and cycle.is_active = true
  and cycle.status <> 'archived'
  and coalesce(assignment.can_score, true) = true
  and assignment.removed_at is null
  and score.score is null;

drop view if exists public.owner_report_missing_comments;
create view public.owner_report_missing_comments
with (security_invoker = true)
as
select
  cycle.id as cycle_id,
  cycle.season_year,
  cycle.name as program_name,
  application.id as application_id,
  application.school_name,
  application.production_title,
  assignment.id as assignment_id,
  profile.id as adjudicator_user_id,
  coalesce(profile.full_name, profile.email, 'Portal user') as adjudicator_name,
  profile.email as adjudicator_email,
  category.id as category_id,
  category.title as category_title,
  criterion.id as criterion_id,
  criterion.title as criterion_title,
  scorecard.id as scorecard_id,
  coalesce(scorecard.status, assignment.status::text, 'not_started') as scorecard_status,
  'criterion_observation'::text as missing_comment_type
from public.applications application
join public.award_cycles cycle
  on cycle.id = application.cycle_id
join public.application_form_versions form_version
  on form_version.id = application.form_version_id
join public.adjudicator_assignments assignment
  on assignment.application_id = application.id
join public.profiles profile
  on profile.id = assignment.adjudicator_user_id
join public.scoring_categories category
  on category.rubric_id = form_version.scoring_rubric_id
  and category.active = true
join public.scoring_criteria criterion
  on criterion.category_id = category.id
  and criterion.active = true
left join public.adjudication_scorecards scorecard
  on scorecard.assignment_id = assignment.id
left join public.adjudication_scores score
  on score.scorecard_id = scorecard.id
  and score.criterion_id = criterion.id
where application.is_archived = false
  and cycle.is_active = true
  and cycle.status <> 'archived'
  and coalesce(assignment.can_comment, true) = true
  and assignment.removed_at is null
  and nullif(btrim(coalesce(score.observation, '')), '') is null;

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
  'ROUND(SUM(score) / COUNT(score), 5)'::text as calculation_method
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

grant select on
  public.owner_report_missing_scores,
  public.owner_report_missing_comments,
  public.owner_score_average_audit
to authenticated;

commit;

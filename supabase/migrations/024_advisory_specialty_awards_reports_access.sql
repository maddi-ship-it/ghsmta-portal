-- GHSMTA Portal migration 024
-- Advisory specialty awards, Owner reports, assignment-gated Advisory review,
-- and application-specific eligibility appeal categories.
-- Run after migrations 001-023.

begin;

-- ---------------------------------------------------------------------------
-- Advisory application access versus review access
-- ---------------------------------------------------------------------------

create or replace function public.can_advisory_review_application(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() = 'advisory_member'
      and (
        exists (
          select 1
          from public.adjudicator_assignments assignment
          where assignment.application_id = p_application_id
            and assignment.adjudicator_user_id = p_user_id
            and coalesce(assignment.removed_at, 'infinity'::timestamptz) > now()
            and coalesce(assignment.participant_role, 'advisory_member'::public.app_role)
              = 'advisory_member'::public.app_role
        )
        or exists (
          select 1
          from public.schedule_school_bookings booking
          join public.schedule_slot_staff staff
            on staff.slot_id = booking.slot_id
          where booking.application_id = p_application_id
            and staff.user_id = p_user_id
            and staff.joined_as = 'advisory_member'::public.app_role
        )
      )
    );
$$;

grant execute on function public.can_advisory_review_application(uuid, uuid)
to authenticated;

create or replace function public.get_advisory_review_application_ids()
returns table(application_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct application.id
  from public.applications application
  join public.award_cycles cycle
    on cycle.id = application.cycle_id
  where auth.uid() is not null
    and public.current_user_role() in ('advisory_member', 'owner')
    and application.is_archived = false
    and cycle.is_active = true
    and cycle.status <> 'archived'
    and public.can_advisory_review_application(application.id, auth.uid());
$$;

grant execute on function public.get_advisory_review_application_ids()
to authenticated;

drop policy if exists "advisory read all active applications"
on public.applications;

create policy "advisory read all active applications"
on public.applications
for select
to authenticated
using (
  public.current_user_role() = 'advisory_member'
  and is_archived = false
  and exists (
    select 1
    from public.award_cycles cycle
    where cycle.id = applications.cycle_id
      and cycle.is_active = true
      and cycle.status <> 'archived'
  )
);

-- ---------------------------------------------------------------------------
-- Advisory Committee specialty award recommendations
-- ---------------------------------------------------------------------------

create table if not exists public.advisory_specialty_award_recommendations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.applications(id) on delete cascade,
  advisory_user_id uuid not null
    references public.profiles(id) on delete cascade default auth.uid(),
  award_type text not null check (
    award_type in (
      'spotlight_technical',
      'spotlight_performance',
      'standing_ovation',
      'showstopper'
    )
  ),
  recommendation_status text not null default 'recommended' check (
    recommendation_status in ('recommended', 'no_recommendation')
  ),
  song_title text,
  explanation text,
  status text not null default 'draft' check (
    status in ('draft', 'submitted')
  ),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, advisory_user_id, award_type),
  check (
    recommendation_status = 'no_recommendation'
    or nullif(btrim(explanation), '') is not null
  ),
  check (
    recommendation_status = 'no_recommendation'
    or award_type not in ('spotlight_performance', 'showstopper')
    or nullif(btrim(song_title), '') is not null
  )
);

create index if not exists advisory_specialty_awards_application_idx
  on public.advisory_specialty_award_recommendations(
    application_id,
    award_type,
    status
  );

create index if not exists advisory_specialty_awards_user_idx
  on public.advisory_specialty_award_recommendations(
    advisory_user_id,
    updated_at desc
  );

drop trigger if exists advisory_specialty_awards_set_updated_at
on public.advisory_specialty_award_recommendations;

create trigger advisory_specialty_awards_set_updated_at
before update on public.advisory_specialty_award_recommendations
for each row execute function public.set_updated_at();

alter table public.advisory_specialty_award_recommendations
enable row level security;

grant select, insert, update on
public.advisory_specialty_award_recommendations
to authenticated;

drop policy if exists "owners read all specialty award recommendations"
on public.advisory_specialty_award_recommendations;

create policy "owners read all specialty award recommendations"
on public.advisory_specialty_award_recommendations
for select
to authenticated
using (public.current_user_role() = 'owner');

drop policy if exists "assigned advisory read specialty award recommendations"
on public.advisory_specialty_award_recommendations;

create policy "assigned advisory read specialty award recommendations"
on public.advisory_specialty_award_recommendations
for select
to authenticated
using (
  public.current_user_role() = 'advisory_member'
  and (
    advisory_user_id = auth.uid()
    or public.can_advisory_review_application(application_id, auth.uid())
  )
);

drop policy if exists "assigned advisory create specialty award recommendations"
on public.advisory_specialty_award_recommendations;

create policy "assigned advisory create specialty award recommendations"
on public.advisory_specialty_award_recommendations
for insert
to authenticated
with check (
  advisory_user_id = auth.uid()
  and public.current_user_role() = 'advisory_member'
  and public.can_advisory_review_application(application_id, auth.uid())
);

drop policy if exists "assigned advisory update own specialty award recommendations"
on public.advisory_specialty_award_recommendations;

create policy "assigned advisory update own specialty award recommendations"
on public.advisory_specialty_award_recommendations
for update
to authenticated
using (
  advisory_user_id = auth.uid()
  and public.current_user_role() = 'advisory_member'
  and public.can_advisory_review_application(application_id, auth.uid())
)
with check (
  advisory_user_id = auth.uid()
  and public.current_user_role() = 'advisory_member'
  and public.can_advisory_review_application(application_id, auth.uid())
);

create or replace function public.save_specialty_award_recommendations(
  p_application_id uuid,
  p_recommendations jsonb,
  p_submit boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  selected_award text;
  selected_status text;
  selected_song text;
  selected_explanation text;
begin
  if public.current_user_role() <> 'advisory_member' then
    raise exception 'Only Advisory Committee members can save recommendations.';
  end if;

  if not public.can_advisory_review_application(
    p_application_id,
    auth.uid()
  ) then
    raise exception 'Select or be assigned to this school timeslot before reviewing it.';
  end if;

  if jsonb_typeof(p_recommendations) <> 'array' then
    raise exception 'Recommendations must be supplied as an array.';
  end if;

  for item in
    select value from jsonb_array_elements(p_recommendations)
  loop
    selected_award := item ->> 'award_type';
    selected_status := coalesce(
      nullif(item ->> 'recommendation_status', ''),
      'no_recommendation'
    );
    selected_song := nullif(btrim(item ->> 'song_title'), '');
    selected_explanation := nullif(btrim(item ->> 'explanation'), '');

    if selected_award not in (
      'spotlight_technical',
      'spotlight_performance',
      'standing_ovation',
      'showstopper'
    ) then
      raise exception 'Invalid specialty award type.';
    end if;

    if selected_status not in ('recommended', 'no_recommendation') then
      raise exception 'Invalid specialty award recommendation status.';
    end if;

    if selected_status = 'recommended'
      and selected_explanation is null then
      raise exception 'Every recommendation needs an explanation.';
    end if;

    if selected_status = 'recommended'
      and selected_award in ('spotlight_performance', 'showstopper')
      and selected_song is null then
      raise exception 'Performance and Showstopper recommendations need a song.';
    end if;

    insert into public.advisory_specialty_award_recommendations (
      application_id,
      advisory_user_id,
      award_type,
      recommendation_status,
      song_title,
      explanation,
      status,
      submitted_at
    ) values (
      p_application_id,
      auth.uid(),
      selected_award,
      selected_status,
      selected_song,
      selected_explanation,
      case when p_submit then 'submitted' else 'draft' end,
      case when p_submit then now() else null end
    )
    on conflict (application_id, advisory_user_id, award_type)
    do update set
      recommendation_status = excluded.recommendation_status,
      song_title = excluded.song_title,
      explanation = excluded.explanation,
      status = excluded.status,
      submitted_at = excluded.submitted_at;
  end loop;

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    application_id,
    metadata
  ) values (
    case
      when p_submit then 'specialty_awards_submitted'
      else 'specialty_awards_saved'
    end,
    case
      when p_submit then 'Specialty award recommendations submitted'
      else 'Specialty award recommendations saved'
    end,
    case
      when p_submit then
        'An Advisory Committee member submitted specialty award recommendations.'
      else
        'An Advisory Committee member saved specialty award recommendations.'
    end,
    auth.uid(),
    p_application_id,
    jsonb_build_object('submitted', p_submit)
  );
end;
$$;

grant execute on function public.save_specialty_award_recommendations(
  uuid,
  jsonb,
  boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- Owner report views
-- ---------------------------------------------------------------------------

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
join public.adjudicator_assignments assignment
  on assignment.application_id = application.id
join public.profiles profile
  on profile.id = assignment.adjudicator_user_id
join public.scoring_rubrics rubric
  on rubric.cycle_id = application.cycle_id
  and rubric.status = 'published'
join public.scoring_categories category
  on category.rubric_id = rubric.id
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
join public.adjudicator_assignments assignment
  on assignment.application_id = application.id
join public.profiles profile
  on profile.id = assignment.adjudicator_user_id
join public.scoring_rubrics rubric
  on rubric.cycle_id = application.cycle_id
  and rubric.status = 'published'
join public.scoring_categories category
  on category.rubric_id = rubric.id
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

drop view if exists public.owner_report_specialty_awards;
create view public.owner_report_specialty_awards
with (security_invoker = true)
as
select
  cycle.id as cycle_id,
  cycle.season_year,
  cycle.name as program_name,
  application.id as application_id,
  application.school_name,
  application.production_title,
  recommendation.award_type,
  recommendation.recommendation_status,
  recommendation.song_title,
  recommendation.explanation,
  recommendation.status,
  recommendation.submitted_at,
  recommendation.updated_at,
  profile.id as advisory_user_id,
  coalesce(profile.full_name, profile.email, 'Advisory Committee member')
    as advisory_member_name,
  profile.email as advisory_member_email
from public.advisory_specialty_award_recommendations recommendation
join public.applications application
  on application.id = recommendation.application_id
join public.award_cycles cycle
  on cycle.id = application.cycle_id
join public.profiles profile
  on profile.id = recommendation.advisory_user_id
where application.is_archived = false
  and cycle.is_active = true
  and cycle.status <> 'archived';

grant select on
  public.owner_report_missing_scores,
  public.owner_report_missing_comments,
  public.owner_report_specialty_awards
to authenticated;

commit;

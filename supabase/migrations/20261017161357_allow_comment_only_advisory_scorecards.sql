begin;

create or replace function public.ensure_adjudication_scorecard(
  p_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_assignment public.adjudicator_assignments%rowtype;
  selected_rubric_id uuid;
  scorecard_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before opening an adjudication scorecard.';
  end if;

  if public.current_user_role() not in ('adjudicator', 'advisory_member') then
    raise exception 'An adjudication participant account is required.';
  end if;

  select * into selected_assignment
  from public.adjudicator_assignments
  where application_id = p_application_id
    and adjudicator_user_id = auth.uid()
    and (can_score = true or can_comment = true)
    and removed_at is null;

  if selected_assignment.id is null then
    raise exception 'You are not assigned to score or comment on this application.';
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

revoke all on function public.ensure_adjudication_scorecard(uuid)
from public, anon;
grant execute on function public.ensure_adjudication_scorecard(uuid)
to authenticated;

commit;

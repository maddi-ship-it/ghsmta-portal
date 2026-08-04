-- Published scoring rubrics are reusable scoring guides. A form can select any
-- published rubric, even when legacy data places the form and rubric under two
-- equivalent program records.

begin;

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
    raise exception 'Only a published rubric can be assigned.';
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

commit;

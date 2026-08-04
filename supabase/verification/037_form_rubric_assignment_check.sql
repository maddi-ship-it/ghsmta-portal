-- Run after 20260804194218_assign_scoring_rubric_to_form.sql.

do $$
declare
  scorecard_function_definition text;
  release_function_definition text;
  submission_function_definition text;
  missing_scores_view_definition text;
  missing_comments_view_definition text;
  score_audit_view_definition text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'application_form_versions'
      and column_name = 'scoring_rubric_id'
      and data_type = 'uuid'
  ) then
    raise exception 'application_form_versions.scoring_rubric_id is missing.';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_record
    join pg_class table_record
      on table_record.oid = constraint_record.conrelid
    join pg_namespace namespace_record
      on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'application_form_versions'
      and constraint_record.contype = 'f'
      and pg_get_constraintdef(constraint_record.oid)
        ilike '%scoring_rubric_id%scoring_rubrics%'
  ) then
    raise exception 'The form scoring-rubric foreign key is missing.';
  end if;

  if exists (
    select 1
    from public.application_form_versions form_version
    join public.scoring_rubrics rubric
      on rubric.cycle_id = form_version.cycle_id
     and rubric.status = 'published'
    where form_version.status in ('published', 'archived')
      and form_version.scoring_rubric_id is null
  ) then
    raise exception 'An existing published or archived form was not backfilled.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_record
    join pg_class table_record
      on table_record.oid = trigger_record.tgrelid
    join pg_namespace namespace_record
      on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'adjudication_category_proposals'
      and trigger_record.tgname = 'adjudication_proposals_validate_form_rubric'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Category-proposal rubric validation is missing.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_record
    join pg_class table_record
      on table_record.oid = trigger_record.tgrelid
    join pg_namespace namespace_record
      on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'appeals'
      and trigger_record.tgname = 'appeals_validate_form_rubric'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Appeal rubric validation is missing.';
  end if;

  select pg_get_functiondef(
    'public.ensure_adjudication_scorecard(uuid)'::regprocedure
  ) into scorecard_function_definition;

  select pg_get_functiondef(
    'public.release_adjudication(uuid,boolean,boolean,text)'::regprocedure
  ) into release_function_definition;

  select pg_get_functiondef(
    'public.submit_adjudication_for_owner(uuid)'::regprocedure
  ) into submission_function_definition;

  if scorecard_function_definition not ilike '%form_version.scoring_rubric_id%'
     or release_function_definition not ilike '%form_version.scoring_rubric_id%'
     or submission_function_definition not ilike '%form_version.scoring_rubric_id%' then
    raise exception 'A scoring workflow still bypasses the form rubric.';
  end if;

  select pg_get_viewdef('public.owner_report_missing_scores'::regclass, true)
  into missing_scores_view_definition;

  select pg_get_viewdef('public.owner_report_missing_comments'::regclass, true)
  into missing_comments_view_definition;

  select pg_get_viewdef('public.owner_score_average_audit'::regclass, true)
  into score_audit_view_definition;

  if missing_scores_view_definition not ilike '%scoring_rubric_id%'
     or missing_comments_view_definition not ilike '%scoring_rubric_id%'
     or score_audit_view_definition not ilike '%scoring_rubric_id%' then
    raise exception 'An Owner scoring report still bypasses the form rubric.';
  end if;

  if has_function_privilege(
    'anon',
    'public.owner_assign_scoring_rubric_to_form(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous users can execute the form-rubric assignment RPC.';
  end if;
end;
$$;

select 'form rubric assignment verification passed' as result;

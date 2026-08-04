-- Run after 20260804195959_allow_reusable_published_form_rubrics.sql.

do $$
declare
  assignment_function_definition text;
begin
  select pg_get_functiondef(
    'public.owner_assign_scoring_rubric_to_form(uuid,uuid)'::regprocedure
  ) into assignment_function_definition;

  if assignment_function_definition
       ilike '%selected_rubric.cycle_id <> selected_form.cycle_id%'
     or assignment_function_definition
       ilike '%selected_rubric.cycle_id != selected_form.cycle_id%' then
    raise exception 'Form-rubric assignment still requires matching programs.';
  end if;

  if assignment_function_definition not ilike '%selected_rubric.status <> ''published''%'
     or assignment_function_definition not ilike '%selected_form.status <> ''published''%' then
    raise exception 'Published form/rubric validation is incomplete.';
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

select 'reusable form rubric verification passed' as result;

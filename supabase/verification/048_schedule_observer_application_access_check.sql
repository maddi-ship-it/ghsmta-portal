-- Run after 20261106025810_fix_schedule_observer_application_rls_recursion.sql.

do $$
declare
  observer_policy_expression text;
  observer_helper_definition text;
begin
  if exists (
    select 1
    from pg_policy
    where polrelid = 'public.applications'::regclass
      and polname = 'scheduled shadows read booked applications'
  ) then
    raise exception 'The shadow-only application access policy still exists.';
  end if;

  select pg_get_expr(policy.polqual, policy.polrelid)
  into observer_policy_expression
  from pg_policy policy
  where policy.polrelid = 'public.applications'::regclass
    and policy.polname = 'scheduled observers read booked applications';

  if observer_policy_expression is null then
    raise exception 'The schedule observer application access policy is missing.';
  end if;

  if observer_policy_expression not like '%private.schedule_observer_can_read_application%'
  then
    raise exception 'The schedule observer policy is not using the non-recursive helper.';
  end if;

  if observer_policy_expression like '%schedule_school_bookings%'
     or observer_policy_expression like '%schedule_slot_staff%'
  then
    raise exception 'The applications policy still queries RLS-protected schedule tables directly.';
  end if;

  select pg_get_functiondef(procedure.oid)
  into observer_helper_definition
  from pg_proc procedure
  join pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname = 'schedule_observer_can_read_application'
    and pg_get_function_identity_arguments(procedure.oid) = 'p_application_id uuid'
    and procedure.prosecdef;

  if observer_helper_definition is null then
    raise exception 'The private schedule observer helper is missing or is not security definer.';
  end if;

  if observer_helper_definition not like '%auth.uid()%'
     or observer_helper_definition not like '%understudy%'
     or observer_helper_definition not like '%shadow%'
     or observer_helper_definition not like '%schedule_school_bookings%'
     or observer_helper_definition not like '%schedule_slot_staff%'
  then
    raise exception 'The private schedule observer helper is missing required caller and booking checks.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'private.schedule_observer_can_read_application(uuid)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated users cannot execute the schedule observer helper.';
  end if;

  if has_function_privilege(
    'anon',
    'private.schedule_observer_can_read_application(uuid)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous users can execute the schedule observer helper.';
  end if;
end $$;

select
  'schedule observer application access verification passed' as result,
  now() as verified_at;

-- Verification for migration 20260802205003_repair_application_insert_rls.sql.
-- This is read-only and safe to run in the Supabase SQL editor.

do $$
declare
  insert_policy record;
begin
  select
    policyname,
    permissive,
    roles,
    cmd,
    with_check
  into insert_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'applications'
    and policyname = 'applicant or owner application insert';

  if insert_policy.policyname is null then
    raise exception 'Application INSERT policy is missing.';
  end if;

  if insert_policy.permissive <> 'PERMISSIVE'
     or insert_policy.cmd <> 'INSERT'
     or not ('authenticated' = any(insert_policy.roles)) then
    raise exception 'Application INSERT policy has the wrong mode, command, or role.';
  end if;

  if insert_policy.with_check not like '%applicant_user_id%'
     or insert_policy.with_check not like '%auth.uid()%'
     or insert_policy.with_check not like '%is_archived%'
     or insert_policy.with_check not like '%profile.active%'
     or insert_policy.with_check not like '%profile.role%'
  then
    raise exception 'Application INSERT policy does not contain the required ownership checks.';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.applications',
    'INSERT'
  ) then
    raise exception 'authenticated is missing INSERT privilege on public.applications.';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'start_application'
      and procedure.prosecdef = true
  ) then
    raise exception 'start_application must remain SECURITY INVOKER.';
  end if;
end;
$$;

select
  policyname,
  permissive,
  roles,
  cmd,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'applications'
  and policyname = 'applicant or owner application insert';

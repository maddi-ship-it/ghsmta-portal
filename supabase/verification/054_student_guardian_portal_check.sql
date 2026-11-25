select enumlabel as portal_role
from pg_enum
join pg_type on pg_type.oid = pg_enum.enumtypid
where pg_type.typname = 'app_role'
  and enumlabel in ('student', 'guardian', 'alumni')
order by enumlabel;

select
  table_name,
  to_regclass(format('public.%I', table_name)) is not null as table_exists
from unnest(array[
  'student_profiles',
  'student_school_requests',
  'student_invitations',
  'guardian_student_links',
  'student_programs',
  'student_program_fields',
  'student_program_assignments',
  'student_submissions',
  'student_guardian_acknowledgements',
  'student_announcements',
  'student_portal_audit_log'
]) as expected(table_name)
order by table_name;

select
  relname as table_name,
  relrowsecurity as rls_enabled
from pg_class
where oid in (
  'public.student_profiles'::regclass,
  'public.student_school_requests'::regclass,
  'public.guardian_student_links'::regclass,
  'public.student_programs'::regclass,
  'public.student_program_fields'::regclass,
  'public.student_program_assignments'::regclass,
  'public.student_submissions'::regclass,
  'public.student_guardian_acknowledgements'::regclass,
  'public.student_announcements'::regclass,
  'public.student_portal_audit_log'::regclass
)
order by relname;

select to_regclass('public.guardian_student_summaries') is not null as guardian_summary_view_exists;

select
  policyname,
  tablename,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'student_profiles',
    'student_school_requests',
    'guardian_student_links',
    'student_programs',
    'student_program_fields',
    'student_submissions',
    'student_guardian_acknowledgements',
    'student_announcements',
    'student_portal_audit_log',
    'portal_files'
  )
order by tablename, policyname;

select
  has_table_privilege('authenticated', 'public.student_program_assignments', 'select') as authenticated_can_read_private_assignments,
  has_table_privilege('service_role', 'public.student_program_assignments', 'select,insert,update,delete') as service_role_manages_assignments,
  has_function_privilege('authenticated', 'public.can_access_student(uuid)', 'execute') as can_access_student_available,
  has_function_privilege('authenticated', 'public.can_access_assigned_student_program(uuid)', 'execute') as assigned_program_check_available;

select
  to_regclass('public.community_donor_letter_requests') is not null as table_exists,
  relrowsecurity as rls_enabled
from pg_class
where oid = to_regclass('public.community_donor_letter_requests');

select
  has_table_privilege('anon', 'public.community_donor_letter_requests', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.community_donor_letter_requests', 'select') as authenticated_can_select,
  has_table_privilege('authenticated', 'public.community_donor_letter_requests', 'insert') as authenticated_can_insert,
  has_table_privilege('authenticated', 'public.community_donor_letter_requests', 'update') as authenticated_can_update,
  has_table_privilege('authenticated', 'public.community_donor_letter_requests', 'delete') as authenticated_can_delete,
  has_table_privilege('service_role', 'public.community_donor_letter_requests', 'select,insert,update,delete') as service_role_can_manage;

select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'community_donor_letter_requests'
order by policyname;

select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.community_donor_letter_requests'::regclass
order by conname;

select
  to_regclass('public.community_testimonials') is not null as table_exists,
  relrowsecurity as rls_enabled
from pg_class
where oid = to_regclass('public.community_testimonials');

select
  has_table_privilege('anon', 'public.community_testimonials', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.community_testimonials', 'select') as authenticated_can_select,
  has_table_privilege('service_role', 'public.community_testimonials', 'select,insert,update,delete') as service_role_can_manage;

select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.community_testimonials'::regclass
order by conname;

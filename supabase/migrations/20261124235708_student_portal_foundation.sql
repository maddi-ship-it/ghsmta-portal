-- Student portal roles are added separately so PostgreSQL commits the enum
-- values before later migrations use them in tables, policies, and functions.

alter type public.app_role add value if not exists 'student';
alter type public.app_role add value if not exists 'guardian';
alter type public.app_role add value if not exists 'alumni';

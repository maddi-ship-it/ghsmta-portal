-- Production role and Contracts release verification.

select enumlabel
from pg_enum
join pg_type on pg_type.oid = pg_enum.enumtypid
where pg_type.typname = 'app_role'
  and enumlabel = 'production';

select to_regclass('public.ghsmta_operations_contracts') as contracts_table,
       to_regclass('public.ghsmta_operations_contract_payments') as payments_table;

select relname, relrowsecurity
from pg_class
where relname in (
  'ghsmta_operations_contracts',
  'ghsmta_operations_contract_payments'
)
order by relname;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'ghsmta_operations_contracts',
    'ghsmta_operations_contract_payments'
  )
order by tablename, policyname;


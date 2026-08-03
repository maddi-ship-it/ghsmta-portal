-- Run after 20260803173346_add_program_manager_role.sql.

do $$
begin
  if not exists (
    select 1
    from pg_type type_record
    join pg_enum enum_record
      on enum_record.enumtypid = type_record.oid
    join pg_namespace namespace_record
      on namespace_record.oid = type_record.typnamespace
    where namespace_record.nspname = 'public'
      and type_record.typname = 'app_role'
      and enum_record.enumlabel = 'program_manager'
  ) then
    raise exception 'app_role is missing program_manager.';
  end if;
end;
$$;

select 'program_manager role verification passed' as result;

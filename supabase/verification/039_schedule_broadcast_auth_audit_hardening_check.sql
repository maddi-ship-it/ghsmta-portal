-- Run after 20260804205013_schedule_broadcast_auth_audit_hardening.sql.

do $$
declare
  audit_foreign_key_definition text;
  audit_function_definition text;
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'applicants receive schedule availability broadcasts'
      and cmd = 'SELECT'
  ) then
    raise exception 'The private schedule Broadcast read policy is missing.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_record
    join pg_class table_record on table_record.oid = trigger_record.tgrelid
    join pg_namespace namespace_record on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'schedule_school_bookings'
      and trigger_record.tgname = 'schedule_bookings_broadcast_availability'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'The schedule availability Broadcast trigger is missing.';
  end if;

  if to_regprocedure('public.touch_schedule_slot_for_realtime()') is not null then
    raise exception 'The old Postgres Changes slot-touch function still exists.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.broadcast_schedule_booking_availability()',
    'EXECUTE'
  ) then
    raise exception 'Authenticated clients can execute the schedule Broadcast trigger function.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'application_audit_log'
      and column_name = 'subject_application_id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  ) then
    raise exception 'The stable audit subject_application_id column is missing.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'application_audit_log'
      and column_name = 'application_id'
      and is_nullable = 'NO'
  ) then
    raise exception 'application_audit_log.application_id still blocks application deletion.';
  end if;

  select pg_get_constraintdef(constraint_record.oid)
  into audit_foreign_key_definition
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.application_audit_log'::regclass
    and constraint_record.conname = 'application_audit_log_application_id_fkey';

  if audit_foreign_key_definition is null
     or audit_foreign_key_definition not ilike '%ON DELETE SET NULL%'
  then
    raise exception 'The application audit foreign key does not use ON DELETE SET NULL.';
  end if;

  select pg_get_functiondef('public.log_application_change()'::regprocedure)
  into audit_function_definition;

  if audit_function_definition is null
     or audit_function_definition not ilike '%subject_application_id%'
     or audit_function_definition not ilike '%tg_op = ''DELETE''%'
     or audit_function_definition not ilike '%then null%'
  then
    raise exception 'The application audit function is not delete-safe.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.log_application_change()',
    'EXECUTE'
  ) then
    raise exception 'Authenticated clients can execute the application audit trigger function.';
  end if;
end;
$$;

select 'schedule Broadcast, browser auth, and audit hardening verification passed' as result;

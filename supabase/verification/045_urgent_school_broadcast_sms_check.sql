begin;

do $$
begin
  if not exists (
    select 1
    from pg_proc function_info
    join pg_namespace function_schema
      on function_schema.oid = function_info.pronamespace
    where function_schema.nspname = 'public'
      and function_info.proname = 'broadcast_to_active_school_dms_with_receipt'
  ) then
    raise exception 'broadcast_to_active_school_dms_with_receipt is missing.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_urgent_sms_deliveries'
      and column_name = 'channel_id'
      and is_nullable <> 'YES'
  ) then
    raise exception 'Urgent SMS broadcast audit rows cannot omit channel_id.';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.chat_urgent_sms_deliveries'::regclass
      and constraint_info.conname = 'chat_urgent_sms_deliveries_message_kind_check'
      and pg_get_constraintdef(constraint_info.oid) like '%broadcast%'
  ) then
    raise exception 'Urgent SMS delivery audit does not accept broadcast records.';
  end if;

  if has_function_privilege(
    'anon',
    'public.broadcast_to_active_school_dms_with_receipt(text)',
    'execute'
  ) then
    raise exception 'Anonymous users can execute the school broadcast function.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.broadcast_to_active_school_dms_with_receipt(text)',
    'execute'
  ) then
    raise exception 'Authenticated Owners cannot execute the school broadcast function.';
  end if;
end;
$$;

insert into public.chat_urgent_sms_deliveries (
  channel_id,
  message_kind,
  message_id,
  recipient_user_id,
  status
)
select
  null,
  'broadcast',
  gen_random_uuid(),
  profile.id,
  'pending'
from public.profiles profile
where profile.phone_e164 is not null
limit 1;

rollback;

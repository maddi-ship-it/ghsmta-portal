do $$
begin
  if to_regclass('public.chat_urgent_sms_deliveries') is null then
    raise exception 'chat_urgent_sms_deliveries is missing';
  end if;

  if not exists (
    select 1
    from pg_class table_info
    where table_info.oid = 'public.chat_urgent_sms_deliveries'::regclass
      and table_info.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on chat_urgent_sms_deliveries';
  end if;

  if has_table_privilege('authenticated', 'public.chat_urgent_sms_deliveries', 'select')
     or has_table_privilege('authenticated', 'public.chat_urgent_sms_deliveries', 'insert')
     or has_table_privilege('authenticated', 'public.chat_urgent_sms_deliveries', 'update') then
    raise exception 'authenticated users must not access urgent SMS delivery records directly';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.chat_urgent_sms_deliveries'::regclass
      and constraint_info.contype = 'u'
      and pg_get_constraintdef(constraint_info.oid) like '%message_kind, message_id, recipient_user_id%'
  ) then
    raise exception 'urgent SMS recipient idempotency constraint is missing';
  end if;
end
$$;

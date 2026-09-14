-- Run after 20260914175241_chat_direct_messages_and_member_directory.sql.
do $$
begin
  if to_regprocedure('public.get_chat_direct_message_contacts()') is null then
    raise exception 'The direct-message contact directory function is missing.';
  end if;

  if to_regprocedure('public.start_or_get_chat_direct_message(uuid)') is null then
    raise exception 'The direct-message channel function is missing.';
  end if;

  if to_regprocedure('public.get_my_chat_channels_v4()') is null then
    raise exception 'The personalized chat navigation function is missing.';
  end if;
end $$;

select
  'direct messages and member directory verification passed' as result,
  now() as verified_at;

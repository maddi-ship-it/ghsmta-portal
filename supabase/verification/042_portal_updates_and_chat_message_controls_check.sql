-- Run after migrations 20260929024500 through 20260929031500.

do $$
begin
  if not exists (
    select 1
    from public.chat_channels channel
    where channel.channel_type = 'portal_updates'
      and channel.application_id is null
      and channel.active = true
  ) then
    raise exception 'The active Portal Updates channel is missing.';
  end if;

  if pg_get_functiondef('public.can_access_chat_channel(uuid,uuid)'::regprocedure)
    not like '%channel.channel_type = ''portal_updates''%' then
    raise exception 'Portal Updates is not included in channel access.';
  end if;

  if pg_get_functiondef('public.get_chat_channel_members(uuid)'::regprocedure)
    not like '%public.current_user_role() = ''owner''%' then
    raise exception 'Portal Updates member privacy is not installed.';
  end if;

  if pg_get_functiondef('public.get_chat_direct_message_contacts()'::regprocedure)
    not like '%channel.channel_type <> ''portal_updates''%' then
    raise exception 'Portal Updates is leaking into direct-message contacts.';
  end if;

  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'chat_posts'
      and policy.policyname = 'authors edit own or owners moderate chat posts'
  ) then
    raise exception 'Chat post author edit policy is missing.';
  end if;

  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'chat_replies'
      and policy.policyname = 'authors edit own chat replies'
  ) then
    raise exception 'Chat reply author edit policy is missing.';
  end if;

  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname = 'channel members upload chat file objects'
      and policy.with_check like '%foldername(objects.name)%'
  ) then
    raise exception 'Chat file upload policy does not use the uploaded object path.';
  end if;
end;
$$;

select
  channel.id,
  channel.name,
  channel.description,
  channel.active
from public.chat_channels channel
where channel.channel_type = 'portal_updates';

-- Run after 20260803140701_chat_channel_rebrand.sql.
do $$
declare
  channel_function text;
begin
  if not exists (
    select 1
    from public.chat_channels
    where application_id is null
      and channel_type = 'applicant_community'
      and name = 'School Community Chat'
  ) then
    raise exception 'The School Community Chat channel is missing or misnamed.';
  end if;

  if not exists (
    select 1
    from public.chat_channels
    where application_id is null
      and channel_type = 'general'
      and name = 'General Announcements'
  ) then
    raise exception 'The General Announcements channel is missing or misnamed.';
  end if;

  select pg_get_functiondef(
    'public.get_my_chat_channels_v3()'::regprocedure
  ) into channel_function;

  if position('Adjudicator Channels' in channel_function) = 0 then
    raise exception 'The chat RPC does not return Adjudicator Channels.';
  end if;
end $$;

select
  'chat channel rebrand verification passed' as result,
  now() as verified_at;

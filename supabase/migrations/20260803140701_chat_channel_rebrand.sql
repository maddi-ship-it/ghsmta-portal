-- Rebrand the global chat experience without changing canonical channel types.
-- Run after 025_chat_terminology.sql.

begin;

update public.chat_channels
set
  name = 'School Community Chat',
  updated_at = now()
where application_id is null
  and channel_type = 'applicant_community'
  and name is distinct from 'School Community Chat';

update public.chat_channels
set
  name = 'General Announcements',
  updated_at = now()
where application_id is null
  and channel_type = 'general'
  and name is distinct from 'General Announcements';

create or replace function public.get_my_chat_channels_v3()
returns table (
  channel_id uuid,
  channel_type text,
  channel_name text,
  channel_description text,
  application_id uuid,
  school_name text,
  production_title text,
  application_archived boolean,
  last_activity_at timestamptz,
  unread_count bigint,
  latest_message_preview text,
  latest_author_name text,
  channel_group text,
  channel_group_label text,
  channel_group_order integer,
  visibility_label text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    channel.channel_id,
    channel.channel_type,
    case channel.channel_type
      when 'applicant_community' then 'School Community Chat'
      when 'general' then 'General Announcements'
      else channel.channel_name
    end as channel_name,
    channel.channel_description,
    channel.application_id,
    channel.school_name,
    channel.production_title,
    channel.application_archived,
    channel.last_activity_at,
    channel.unread_count,
    channel.latest_message_preview,
    channel.latest_author_name,
    channel.channel_group,
    case
      when channel.channel_group = 'direct_messages'
        then 'School Messaging'
      when channel.channel_group = 'school_staff'
        then 'Panel Channels'
      when channel.channel_group = 'staff'
        then 'Adjudicator Channels'
      else channel.channel_group_label
    end as channel_group_label,
    channel.channel_group_order,
    case
      when channel.channel_type = 'school_dm'
        then 'School + Owners'
      when channel.channel_type = 'school'
        then 'Assigned panel + Owners'
      else channel.visibility_label
    end as visibility_label
  from public.get_my_chat_channels_v2() channel
  where auth.uid() is not null
  order by
    channel.channel_group_order,
    case when channel.unread_count > 0 then 0 else 1 end,
    channel.last_activity_at desc,
    channel.channel_name;
$$;

revoke all on function public.get_my_chat_channels_v3()
from public, anon;
grant execute on function public.get_my_chat_channels_v3()
to authenticated;

commit;

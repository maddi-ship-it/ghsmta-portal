-- Let Owners choose which existing chat sidebar header contains a custom
-- private group channel. Membership and access rules remain unchanged.

begin;

alter table public.chat_channels
  add column if not exists sidebar_section text;

alter table public.chat_channels
  drop constraint if exists chat_channels_sidebar_section_check;

alter table public.chat_channels
  add constraint chat_channels_sidebar_section_check check (
    sidebar_section is null
    or (
      channel_type = 'group_direct_message'
      and sidebar_section in (
        'portal_updates',
        'community',
        'direct_messages',
        'adjudicator_channels',
        'advisory_committee'
      )
    )
  );

update public.chat_channels
set sidebar_section = 'direct_messages'
where channel_type = 'group_direct_message'
  and sidebar_section is null;

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
set search_path = ''
as $$
  select
    channel.channel_id,
    channel.channel_type,
    case channel.channel_type
      when 'applicant_community' then 'School Community Chat'
      when 'general' then 'General Announcements'
      when 'scheduling' then 'Scheduling Chat'
      when 'portal_updates' then 'Portal Updates'
      else channel.channel_name
    end,
    channel.channel_description,
    channel.application_id,
    channel.school_name,
    channel.production_title,
    channel.application_archived,
    channel.last_activity_at,
    channel.unread_count,
    channel.latest_message_preview,
    channel.latest_author_name,
    case
      when channel.application_archived then 'archived'
      when channel.channel_type = 'portal_updates' then 'portal_updates'
      when channel.channel_type = 'scholarship_dm' then 'scholarship_applicants'
      when channel.channel_type = 'direct_message' then 'owner_direct_messages'
      when channel.channel_type = 'group_direct_message' then
        case source.sidebar_section
          when 'portal_updates' then 'portal_updates'
          when 'community' then 'community'
          when 'adjudicator_channels' then 'staff'
          when 'advisory_committee' then 'committee'
          else 'owner_direct_messages'
        end
      when channel.channel_type = 'scheduling' then 'staff'
      else channel.channel_group
    end,
    case
      when channel.application_archived then 'Archived conversations'
      when channel.channel_type = 'portal_updates' then 'Portal Updates'
      when channel.channel_type = 'scholarship_dm' then 'Scholarship Applicants'
      when channel.channel_type = 'direct_message' then 'Direct Messages'
      when channel.channel_type = 'group_direct_message' then
        case source.sidebar_section
          when 'portal_updates' then 'Portal Updates'
          when 'community' then 'Community'
          when 'adjudicator_channels' then 'Adjudicator Channels'
          when 'advisory_committee' then 'Advisory Committee'
          else 'Direct Messages'
        end
      when channel.channel_type = 'scheduling' then 'Adjudicator Channels'
      when channel.channel_group = 'direct_messages' then 'School Messaging'
      when channel.channel_group = 'school_staff' then 'Panel Channels'
      when channel.channel_group = 'staff' then 'Adjudicator Channels'
      else channel.channel_group_label
    end,
    case
      when channel.application_archived then 60
      when channel.channel_type = 'portal_updates' then 5
      when channel.channel_type = 'direct_message' then 12
      when channel.channel_type = 'group_direct_message' then
        case source.sidebar_section
          when 'portal_updates' then 5
          when 'community' then 10
          when 'adjudicator_channels' then 20
          when 'advisory_committee' then 30
          else 12
        end
      when channel.channel_type = 'scholarship_dm' then 15
      when channel.channel_type = 'scheduling' then 20
      else channel.channel_group_order
    end,
    case
      when channel.channel_type = 'portal_updates' then 'All portal users · Owner posts only'
      when channel.channel_type = 'scholarship_dm' then 'Applicant + Program Managers + Owners'
      when channel.channel_type = 'direct_message' then 'Private direct message'
      when channel.channel_type = 'group_direct_message' then 'Private group message'
      when channel.channel_type = 'general' then 'Adjudicators + Advisory + Program Managers + Owners'
      when channel.channel_type = 'scheduling' then 'ACMs + Adjudicators + Owners'
      when channel.channel_type = 'school_dm' then 'School + Owners'
      when channel.channel_type = 'school' then 'Assigned panel + Owners'
      else channel.visibility_label
    end
  from public.get_my_chat_channels_v2() channel
  left join public.chat_channels source
    on source.id = channel.channel_id
  where auth.uid() is not null
  order by
    channel_group_order,
    case when channel.unread_count > 0 then 0 else 1 end,
    channel.last_activity_at desc,
    channel.channel_name;
$$;

revoke all on function public.get_my_chat_channels_v3()
from public, anon;
grant execute on function public.get_my_chat_channels_v3()
to authenticated;

commit;

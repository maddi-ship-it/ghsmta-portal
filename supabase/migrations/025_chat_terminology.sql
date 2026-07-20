-- GHSMTA Portal migration 025
-- Platform terminology: School Messaging and Panel Channel.
-- Underlying channel_type values remain unchanged for compatibility.
-- Run after migrations 001-024.

begin;

update public.chat_channels channel
set
  name = application.school_name || ' — School Messaging',
  description = coalesce(
    nullif(channel.description, ''),
    'Private messaging between the school and GHSMTA Owners.'
  ),
  updated_at = now()
from public.applications application
where channel.application_id = application.id
  and channel.channel_type = 'school_dm'
  and channel.name is distinct from
    application.school_name || ' — School Messaging';

update public.chat_channels channel
set
  name = application.school_name || ' — Panel Channel',
  description = coalesce(
    nullif(channel.description, ''),
    'Private panel coordination for assigned reviewers and GHSMTA Owners.'
  ),
  updated_at = now()
from public.applications application
where channel.application_id = application.id
  and channel.channel_type = 'school'
  and channel.name is distinct from
    application.school_name || ' — Panel Channel';

create or replace function public.normalize_application_chat_display_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_channels
  set
    name = new.school_name || ' — School Messaging',
    updated_at = now()
  where application_id = new.id
    and channel_type = 'school_dm'
    and name is distinct from new.school_name || ' — School Messaging';

  update public.chat_channels
  set
    name = new.school_name || ' — Panel Channel',
    updated_at = now()
  where application_id = new.id
    and channel_type = 'school'
    and name is distinct from new.school_name || ' — Panel Channel';

  return new;
end;
$$;

drop trigger if exists applications_normalize_chat_display_names
on public.applications;

create trigger applications_normalize_chat_display_names
after insert or update of school_name, applicant_user_id, is_archived
on public.applications
for each row
execute function public.normalize_application_chat_display_names();

drop function if exists public.get_my_chat_channels_v3();

create function public.get_my_chat_channels_v3()
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
    channel.channel_name,
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
  order by
    channel.channel_group_order,
    case when channel.unread_count > 0 then 0 else 1 end,
    channel.last_activity_at desc,
    channel.channel_name;
$$;

grant execute on function public.get_my_chat_channels_v3()
to authenticated;

update public.portal_message_templates
set
  name = replace(
    replace(name, 'School Owner DM', 'School Messaging'),
    'School DM',
    'School Messaging'
  ),
  subject_template = replace(
    replace(subject_template, 'School Owner DM', 'School Messaging'),
    'School DM',
    'School Messaging'
  ),
  body_template = replace(
    replace(body_template, 'School Owner DM', 'School Messaging'),
    'School DM',
    'School Messaging'
  )
where
  name ilike '%school%dm%'
  or subject_template ilike '%school%dm%'
  or body_template ilike '%school%dm%';

commit;

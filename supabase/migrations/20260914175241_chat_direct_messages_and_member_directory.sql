-- Let portal users start one-to-one chats with people they already share a
-- channel with. Owners may start a direct message with any active portal user.

begin;

create or replace function public.get_chat_direct_message_contacts()
returns table (
  user_id uuid,
  display_name text,
  user_role public.app_role
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_profile as (
    select profile.id, profile.role
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active = true
  )
  select
    contact.id,
    coalesce(
      nullif(trim(contact.full_name), ''),
      contact.email,
      'Portal user'
    ),
    contact.role
  from current_profile viewer
  join public.profiles contact
    on contact.active = true
   and contact.id <> viewer.id
  where
    viewer.role = 'owner'
    or exists (
      select 1
      from public.chat_channels channel
      where channel.active = true
        and public.can_access_chat_channel(channel.id, viewer.id)
        and public.can_access_chat_channel(channel.id, contact.id)
    )
  order by
    case contact.role
      when 'owner' then 1
      when 'program_manager' then 2
      when 'advisory_member' then 3
      when 'adjudicator' then 4
      when 'applicant' then 5
      else 6
    end,
    coalesce(contact.full_name, contact.email);
$$;

revoke all on function public.get_chat_direct_message_contacts()
from public, anon;
grant execute on function public.get_chat_direct_message_contacts()
to authenticated;

create or replace function public.start_or_get_chat_direct_message(
  p_other_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_role public.app_role;
  direct_channel_id uuid;
  pair_key text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_other_user_id is null or p_other_user_id = current_user_id then
    raise exception 'Choose another active portal user.';
  end if;

  select profile.role
  into current_user_role
  from public.profiles profile
  where profile.id = current_user_id
    and profile.active = true;

  if current_user_role is null then
    raise exception 'Your portal account is not active.';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_other_user_id
      and profile.active = true
  ) then
    raise exception 'The selected portal user is not active.';
  end if;

  if current_user_role <> 'owner'
    and not exists (
      select 1
      from public.chat_channels channel
      where channel.active = true
        and public.can_access_chat_channel(channel.id, current_user_id)
        and public.can_access_chat_channel(channel.id, p_other_user_id)
    ) then
    raise exception 'You can only message people who share a chat with you.';
  end if;

  pair_key := least(current_user_id::text, p_other_user_id::text)
    || ':' || greatest(current_user_id::text, p_other_user_id::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pair_key, 0)
  );

  select channel.id
  into direct_channel_id
  from public.chat_channels channel
  where channel.channel_type = 'direct_message'
    and channel.active = true
    and exists (
      select 1
      from public.chat_direct_participants participant
      where participant.channel_id = channel.id
        and participant.user_id = current_user_id
    )
    and exists (
      select 1
      from public.chat_direct_participants participant
      where participant.channel_id = channel.id
        and participant.user_id = p_other_user_id
    )
    and (
      select count(*)
      from public.chat_direct_participants participant
      where participant.channel_id = channel.id
    ) = 2
  order by channel.created_at
  limit 1;

  if direct_channel_id is not null then
    return direct_channel_id;
  end if;

  insert into public.chat_channels (
    channel_type,
    name,
    description,
    application_id,
    active,
    created_by
  )
  values (
    'direct_message',
    'Direct message',
    'Private one-to-one portal conversation.',
    null,
    true,
    current_user_id
  )
  returning id into direct_channel_id;

  insert into public.chat_direct_participants (
    channel_id,
    user_id,
    added_by
  )
  values
    (direct_channel_id, current_user_id, current_user_id),
    (direct_channel_id, p_other_user_id, current_user_id);

  return direct_channel_id;
end;
$$;

revoke all on function public.start_or_get_chat_direct_message(uuid)
from public, anon;
grant execute on function public.start_or_get_chat_direct_message(uuid)
to authenticated;

create or replace function public.get_my_chat_channels_v4()
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
    case
      when channel.channel_type = 'direct_message' then coalesce(
        (
          select coalesce(
            nullif(trim(profile.full_name), ''),
            profile.email,
            'Portal user'
          )
          from public.chat_direct_participants participant
          join public.profiles profile
            on profile.id = participant.user_id
          where participant.channel_id = channel.channel_id
            and participant.user_id <> auth.uid()
          order by coalesce(profile.full_name, profile.email)
          limit 1
        ),
        'Direct message'
      )
      else channel.channel_name
    end,
    case
      when channel.channel_type = 'direct_message'
        then 'Private one-to-one portal conversation.'
      else channel.channel_description
    end,
    channel.application_id,
    channel.school_name,
    channel.production_title,
    channel.application_archived,
    channel.last_activity_at,
    channel.unread_count,
    channel.latest_message_preview,
    channel.latest_author_name,
    channel.channel_group,
    channel.channel_group_label,
    channel.channel_group_order,
    channel.visibility_label
  from public.get_my_chat_channels_v3() channel
  where auth.uid() is not null
  order by
    channel.channel_group_order,
    case when channel.unread_count > 0 then 0 else 1 end,
    channel.last_activity_at desc,
    channel.channel_name;
$$;

revoke all on function public.get_my_chat_channels_v4()
from public, anon;
grant execute on function public.get_my_chat_channels_v4()
to authenticated;

commit;

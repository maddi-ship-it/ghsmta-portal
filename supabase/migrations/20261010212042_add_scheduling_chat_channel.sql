-- Add a dedicated scheduling conversation for Advisory Committee Members,
-- adjudicators, and Owners.

begin;

alter table public.chat_channels
  drop constraint if exists chat_channels_channel_type_check;
alter table public.chat_channels
  add constraint chat_channels_channel_type_check check (
    channel_type in (
      'school',
      'school_dm',
      'scholarship_dm',
      'applicant_community',
      'general',
      'networking',
      'scheduling',
      'advisory_committee',
      'direct_message',
      'group_direct_message',
      'portal_updates'
    )
  );

create unique index if not exists chat_channels_scheduling_unique
  on public.chat_channels(channel_type)
  where application_id is null
    and channel_type = 'scheduling';

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'scheduling',
  'Scheduling Chat',
  'Schedule coordination for Advisory Committee Members and adjudicators.',
  null,
  true
where not exists (
  select 1
  from public.chat_channels channel
  where channel.channel_type = 'scheduling'
    and channel.application_id is null
);

create or replace function public.can_access_chat_channel(
  p_channel_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_channels channel
    join public.profiles profile
      on profile.id = p_user_id
     and profile.active = true
    left join public.applications application
      on application.id = channel.application_id
    left join public.award_cycles cycle
      on cycle.id = application.cycle_id
    where channel.id = p_channel_id
      and channel.active = true
      and (
        channel.channel_type = 'portal_updates'
        or (
          profile.role = 'owner'
          and channel.channel_type not in ('direct_message', 'group_direct_message')
        )
        or (
          channel.channel_type in ('direct_message', 'group_direct_message')
          and exists (
            select 1
            from public.chat_direct_participants participant
            where participant.channel_id = channel.id
              and participant.user_id = p_user_id
          )
        )
        or (
          channel.channel_type = 'applicant_community'
          and profile.role = 'applicant'
        )
        or (
          channel.channel_type = 'general'
          and profile.role in ('adjudicator', 'advisory_member', 'program_manager')
        )
        or (
          channel.channel_type in ('networking', 'scheduling')
          and profile.role in ('adjudicator', 'advisory_member')
        )
        or (
          channel.channel_type = 'advisory_committee'
          and profile.role = 'advisory_member'
        )
        or (
          coalesce(application.is_archived, false) = false
          and channel.channel_type = 'scholarship_dm'
          and cycle.program_type = 'scholarship'
          and (
            profile.role = 'program_manager'
            or public.is_application_member(application.id, p_user_id)
          )
        )
        or (
          coalesce(application.is_archived, false) = false
          and channel.channel_type = 'school_dm'
          and public.is_application_member(application.id, p_user_id)
        )
        or (
          coalesce(application.is_archived, false) = false
          and channel.channel_type = 'school'
          and profile.role in ('adjudicator', 'advisory_member')
          and (
            exists (
              select 1
              from public.adjudicator_assignments assignment
              where assignment.application_id = channel.application_id
                and assignment.adjudicator_user_id = p_user_id
                and assignment.removed_at is null
            )
            or exists (
              select 1
              from public.schedule_school_bookings booking
              join public.schedule_slot_staff enrollment
                on enrollment.slot_id = booking.slot_id
              where booking.application_id = channel.application_id
                and enrollment.user_id = p_user_id
                and enrollment.joined_as in ('adjudicator', 'advisory_member')
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_access_chat_channel(uuid, uuid)
from public, anon;
grant execute on function public.can_access_chat_channel(uuid, uuid)
to authenticated;

create or replace function public.get_chat_channel_members(p_channel_id uuid)
returns table (
  user_id uuid,
  display_name text,
  user_role public.app_role
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_type text;
begin
  if not public.can_access_chat_channel(p_channel_id, auth.uid()) then
    raise exception 'You do not have access to this channel.';
  end if;

  select channel.channel_type
  into selected_type
  from public.chat_channels channel
  where channel.id = p_channel_id
    and channel.active = true;

  if selected_type = 'portal_updates' then
    return query
    select
      profile.id,
      coalesce(nullif(trim(profile.full_name), ''), profile.email, 'Portal user'),
      profile.role
    from public.profiles profile
    where profile.active = true
      and (
        public.current_user_role() = 'owner'
        or profile.id = auth.uid()
      )
    order by
      case profile.role
        when 'owner' then 1
        when 'program_manager' then 2
        when 'advisory_member' then 3
        when 'adjudicator' then 4
        when 'applicant' then 5
        else 6
      end,
      coalesce(profile.full_name, profile.email);
    return;
  end if;

  return query
  with selected_channel as (
    select channel.channel_type, channel.application_id
    from public.chat_channels channel
    where channel.id = p_channel_id
      and channel.active = true
  ),
  eligible_users as (
    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where profile.active = true
      and profile.role = 'owner'
      and channel.channel_type not in ('direct_message', 'group_direct_message')

    union

    select participant.user_id
    from selected_channel channel
    join public.chat_direct_participants participant
      on participant.channel_id = p_channel_id
    where channel.channel_type in ('direct_message', 'group_direct_message')

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'applicant_community'
      and profile.active = true
      and profile.role = 'applicant'

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'general'
      and profile.active = true
      and profile.role in ('adjudicator', 'advisory_member', 'program_manager')

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type in ('networking', 'scheduling')
      and profile.active = true
      and profile.role in ('adjudicator', 'advisory_member')

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'advisory_committee'
      and profile.active = true
      and profile.role = 'advisory_member'

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'scholarship_dm'
      and profile.active = true
      and profile.role = 'program_manager'

    union

    select member.user_id
    from selected_channel channel
    join public.application_members member
      on member.application_id = channel.application_id
    join public.profiles profile
      on profile.id = member.user_id
    where channel.channel_type in ('school_dm', 'scholarship_dm')
      and member.active = true
      and profile.active = true
      and profile.role = 'applicant'

    union

    select assignment.adjudicator_user_id
    from selected_channel channel
    join public.adjudicator_assignments assignment
      on assignment.application_id = channel.application_id
    where channel.channel_type = 'school'
      and assignment.removed_at is null

    union

    select enrollment.user_id
    from selected_channel channel
    join public.schedule_school_bookings booking
      on booking.application_id = channel.application_id
    join public.schedule_slot_staff enrollment
      on enrollment.slot_id = booking.slot_id
    where channel.channel_type = 'school'
      and enrollment.joined_as in ('adjudicator', 'advisory_member')
  )
  select
    profile.id,
    coalesce(nullif(trim(profile.full_name), ''), profile.email, 'Portal user'),
    profile.role
  from eligible_users eligible
  join public.profiles profile on profile.id = eligible.id
  where profile.active = true
  order by
    case profile.role
      when 'owner' then 1
      when 'program_manager' then 2
      when 'advisory_member' then 3
      when 'adjudicator' then 4
      when 'applicant' then 5
      else 6
    end,
    coalesce(profile.full_name, profile.email);
end;
$$;

revoke all on function public.get_chat_channel_members(uuid)
from public, anon;
grant execute on function public.get_chat_channel_members(uuid)
to authenticated;

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
      when channel.channel_type in ('direct_message', 'group_direct_message') then 'owner_direct_messages'
      when channel.channel_type = 'scheduling' then 'staff'
      else channel.channel_group
    end,
    case
      when channel.application_archived then 'Archived conversations'
      when channel.channel_type = 'portal_updates' then 'Portal Updates'
      when channel.channel_type = 'scholarship_dm' then 'Scholarship Applicants'
      when channel.channel_type in ('direct_message', 'group_direct_message') then 'Direct Messages'
      when channel.channel_type = 'scheduling' then 'Adjudicator Channels'
      when channel.channel_group = 'direct_messages' then 'School Messaging'
      when channel.channel_group = 'school_staff' then 'Panel Channels'
      when channel.channel_group = 'staff' then 'Adjudicator Channels'
      else channel.channel_group_label
    end,
    case
      when channel.application_archived then 60
      when channel.channel_type = 'portal_updates' then 5
      when channel.channel_type in ('direct_message', 'group_direct_message') then 12
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

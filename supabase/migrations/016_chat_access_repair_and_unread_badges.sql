-- GHSMTA Portal: repair channel backfill/access and expose unread chat counts.
-- Run after migration 015.

-- ---------------------------------------------------------------------------
-- Guarantee the four global channels exist and are active.
-- ---------------------------------------------------------------------------

update public.chat_channels
set
  name = 'Community Chat',
  description = 'A shared threaded space for applicants and GHSMTA owners.',
  active = true,
  updated_at = now()
where application_id is null
  and channel_type = 'applicant_community';

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'applicant_community',
  'Community Chat',
  'A shared threaded space for applicants and GHSMTA owners.',
  null,
  true
where not exists (
  select 1
  from public.chat_channels
  where application_id is null
    and channel_type = 'applicant_community'
);

update public.chat_channels
set
  name = 'General',
  description = 'Program-wide updates and conversations for adjudicators, advisory committee members, and owners.',
  active = true,
  updated_at = now()
where application_id is null
  and channel_type = 'general';

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'general',
  'General',
  'Program-wide updates and conversations for adjudicators, advisory committee members, and owners.',
  null,
  true
where not exists (
  select 1
  from public.chat_channels
  where application_id is null
    and channel_type = 'general'
);

update public.chat_channels
set
  name = 'Networking',
  description = 'A staff community space for introductions, resources, and professional connections.',
  active = true,
  updated_at = now()
where application_id is null
  and channel_type = 'networking';

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'networking',
  'Networking',
  'A staff community space for introductions, resources, and professional connections.',
  null,
  true
where not exists (
  select 1
  from public.chat_channels
  where application_id is null
    and channel_type = 'networking'
);

update public.chat_channels
set
  name = 'Advisory Committee',
  description = 'A private channel for advisory committee members and owners.',
  active = true,
  updated_at = now()
where application_id is null
  and channel_type = 'advisory_committee';

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'advisory_committee',
  'Advisory Committee',
  'A private channel for advisory committee members and owners.',
  null,
  true
where not exists (
  select 1
  from public.chat_channels
  where application_id is null
    and channel_type = 'advisory_committee'
);

-- ---------------------------------------------------------------------------
-- Backfill and reactivate every live school's internal channel and Owner DM.
-- ---------------------------------------------------------------------------

update public.chat_channels channel
set
  name = application.school_name || ' — School Staff',
  description = 'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
  active = true,
  updated_at = now()
from public.applications application
where channel.application_id = application.id
  and channel.channel_type = 'school'
  and application.applicant_user_id is not null
  and coalesce(application.is_archived, false) = false;

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'school',
  application.school_name || ' — School Staff',
  'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
  application.id,
  true
from public.applications application
where application.applicant_user_id is not null
  and coalesce(application.is_archived, false) = false
  and not exists (
    select 1
    from public.chat_channels channel
    where channel.application_id = application.id
      and channel.channel_type = 'school'
  );

update public.chat_channels channel
set
  name = application.school_name || ' — Owner DM',
  description = 'Private messages between the school applicant and GHSMTA owners.',
  active = true,
  updated_at = now()
from public.applications application
where channel.application_id = application.id
  and channel.channel_type = 'school_dm'
  and application.applicant_user_id is not null
  and coalesce(application.is_archived, false) = false;

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'school_dm',
  application.school_name || ' — Owner DM',
  'Private messages between the school applicant and GHSMTA owners.',
  application.id,
  true
from public.applications application
where application.applicant_user_id is not null
  and coalesce(application.is_archived, false) = false
  and not exists (
    select 1
    from public.chat_channels channel
    where channel.application_id = application.id
      and channel.channel_type = 'school_dm'
  );

-- Keep future applications synchronized without relying on partial-index
-- ON CONFLICT inference.
create or replace function public.sync_application_chat_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.applicant_user_id is not null
     and coalesce(new.is_archived, false) = false then
    update public.chat_channels
    set
      name = new.school_name || ' — School Staff',
      description = 'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
      active = true,
      updated_at = now()
    where application_id = new.id
      and channel_type = 'school';

    if not found then
      insert into public.chat_channels (
        channel_type,
        name,
        description,
        application_id,
        active
      ) values (
        'school',
        new.school_name || ' — School Staff',
        'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
        new.id,
        true
      );
    end if;

    update public.chat_channels
    set
      name = new.school_name || ' — Owner DM',
      description = 'Private messages between the school applicant and GHSMTA owners.',
      active = true,
      updated_at = now()
    where application_id = new.id
      and channel_type = 'school_dm';

    if not found then
      insert into public.chat_channels (
        channel_type,
        name,
        description,
        application_id,
        active
      ) values (
        'school_dm',
        new.school_name || ' — Owner DM',
        'Private messages between the school applicant and GHSMTA owners.',
        new.id,
        true
      );
    end if;
  else
    update public.chat_channels
    set
      active = false,
      updated_at = now()
    where application_id = new.id
      and channel_type in ('school', 'school_dm');
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Central channel access. School Staff access is granted through either an
-- active application participant assignment or the booked schedule slot.
-- ---------------------------------------------------------------------------

create or replace function public.can_access_chat_channel(
  p_channel_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_channels channel
    join public.profiles profile
      on profile.id = p_user_id
     and profile.active = true
    left join public.applications application
      on application.id = channel.application_id
    where channel.id = p_channel_id
      and channel.active = true
      and (
        profile.role = 'owner'
        or (
          channel.channel_type = 'applicant_community'
          and profile.role = 'applicant'
        )
        or (
          channel.channel_type in ('general', 'networking')
          and profile.role in ('adjudicator', 'advisory_member')
        )
        or (
          channel.channel_type = 'advisory_committee'
          and profile.role = 'advisory_member'
        )
        or (
          channel.channel_type = 'school_dm'
          and application.applicant_user_id = p_user_id
        )
        or (
          channel.channel_type = 'school'
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

grant execute on function public.can_access_chat_channel(uuid, uuid)
to authenticated;

create or replace function public.get_chat_channel_members(
  p_channel_id uuid
)
returns table (
  user_id uuid,
  display_name text,
  user_role public.app_role
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_access_chat_channel(p_channel_id, auth.uid()) then
    raise exception 'You do not have access to this channel.';
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
    where channel.channel_type in ('general', 'networking')
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

    select application.applicant_user_id
    from selected_channel channel
    join public.applications application
      on application.id = channel.application_id
    where channel.channel_type = 'school_dm'
      and application.applicant_user_id is not null

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
  join public.profiles profile
    on profile.id = eligible.id
  where profile.active = true
  order by
    case profile.role
      when 'owner' then 1
      when 'advisory_member' then 2
      when 'adjudicator' then 3
      when 'applicant' then 4
      else 5
    end,
    coalesce(profile.full_name, profile.email);
end;
$$;

grant execute on function public.get_chat_channel_members(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Header/notification-center unread totals.
-- ---------------------------------------------------------------------------

create or replace function public.get_unread_portal_counts()
returns table (
  notification_count bigint,
  chat_message_count bigint,
  chat_channel_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with channels as (
    select *
    from public.get_my_chat_channels()
  )
  select
    (
      select count(*)::bigint
      from public.user_notifications notification
      where notification.user_id = auth.uid()
        and notification.read_at is null
    ),
    coalesce((select sum(channel.unread_count) from channels channel), 0)::bigint,
    coalesce((select count(*) from channels channel where channel.unread_count > 0), 0)::bigint;
$$;

grant execute on function public.get_unread_portal_counts()
to authenticated;

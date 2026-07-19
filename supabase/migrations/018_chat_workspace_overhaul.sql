-- GHSMTA Portal: chat workspace overhaul, channel repair, and resilient DMs.
-- Run after migration 017.

-- ---------------------------------------------------------------------------
-- Channel model repair
-- ---------------------------------------------------------------------------

alter table public.chat_channels
  drop constraint if exists chat_channels_application_id_key;

alter table public.chat_channels
  drop constraint if exists chat_channels_channel_type_check;

alter table public.chat_channels
  add constraint chat_channels_channel_type_check check (
    channel_type in (
      'school',
      'school_dm',
      'applicant_community',
      'general',
      'networking',
      'advisory_committee'
    )
  );

alter table public.chat_channels
  drop constraint if exists chat_channels_application_type_check;

alter table public.chat_channels
  add constraint chat_channels_application_type_check check (
    (
      channel_type in ('school', 'school_dm')
      and application_id is not null
    )
    or
    (
      channel_type not in ('school', 'school_dm')
      and application_id is null
    )
  );

-- Collapse any duplicate channel rows before enforcing one channel of each
-- type per application. Messages and read receipts are preserved.
drop table if exists chat_channel_merge_map;
create temporary table chat_channel_merge_map on commit drop as
with ranked as (
  select
    channel.id,
    first_value(channel.id) over (
      partition by channel.channel_type, channel.application_id
      order by channel.created_at, channel.id
    ) as keeper_id,
    row_number() over (
      partition by channel.channel_type, channel.application_id
      order by channel.created_at, channel.id
    ) as row_number
  from public.chat_channels channel
)
select
  ranked.id as duplicate_id,
  ranked.keeper_id
from ranked
where ranked.row_number > 1;

insert into public.chat_channel_reads (
  channel_id,
  user_id,
  last_read_at
)
select
  merge_map.keeper_id,
  read_state.user_id,
  max(read_state.last_read_at)
from public.chat_channel_reads read_state
join chat_channel_merge_map merge_map
  on merge_map.duplicate_id = read_state.channel_id
group by merge_map.keeper_id, read_state.user_id
on conflict (channel_id, user_id) do update set
  last_read_at = greatest(
    public.chat_channel_reads.last_read_at,
    excluded.last_read_at
  );

update public.chat_replies reply
set channel_id = merge_map.keeper_id
from chat_channel_merge_map merge_map
where reply.channel_id = merge_map.duplicate_id;

update public.chat_posts post
set channel_id = merge_map.keeper_id
from chat_channel_merge_map merge_map
where post.channel_id = merge_map.duplicate_id;

delete from public.chat_channels channel
using chat_channel_merge_map merge_map
where channel.id = merge_map.duplicate_id;

create unique index if not exists chat_channels_application_type_unique
  on public.chat_channels(application_id, channel_type)
  where application_id is not null;

create unique index if not exists chat_channels_global_type_unique
  on public.chat_channels(channel_type)
  where application_id is null;

create index if not exists chat_channels_active_type_idx
  on public.chat_channels(active, channel_type, application_id);

-- ---------------------------------------------------------------------------
-- Global channels
-- ---------------------------------------------------------------------------

update public.chat_channels
set
  name = 'Community Chat',
  description = 'A shared threaded space for school applicants and GHSMTA owners.',
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
  'A shared threaded space for school applicants and GHSMTA owners.',
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
  description = 'Program-wide updates for adjudicators, advisory committee members, and owners.',
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
  'Program-wide updates for adjudicators, advisory committee members, and owners.',
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
  description = 'A staff space for introductions, resources, and professional connections.',
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
  'A staff space for introductions, resources, and professional connections.',
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
-- School Staff channels and School/Owner DMs
-- ---------------------------------------------------------------------------

-- Owners need a staff channel for every application, including imported
-- applications that do not yet have a linked applicant account.
update public.chat_channels channel
set
  name = application.school_name || ' — School Staff',
  description = 'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
  active = true,
  updated_at = now()
from public.applications application
where channel.application_id = application.id
  and channel.channel_type = 'school';

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
where not exists (
  select 1
  from public.chat_channels channel
  where channel.application_id = application.id
    and channel.channel_type = 'school'
);

update public.chat_channels channel
set
  name = application.school_name || ' — Owner DM',
  description = 'Private messages between this school and GHSMTA owners.',
  active = application.applicant_user_id is not null,
  updated_at = now()
from public.applications application
where channel.application_id = application.id
  and channel.channel_type = 'school_dm';

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
  'Private messages between this school and GHSMTA owners.',
  application.id,
  true
from public.applications application
where application.applicant_user_id is not null
  and not exists (
    select 1
    from public.chat_channels channel
    where channel.application_id = application.id
      and channel.channel_type = 'school_dm'
  );

create or replace function public.sync_application_chat_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

  if new.applicant_user_id is not null then
    update public.chat_channels
    set
      name = new.school_name || ' — Owner DM',
      description = 'Private messages between this school and GHSMTA owners.',
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
        'Private messages between this school and GHSMTA owners.',
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
      and channel_type = 'school_dm';
  end if;

  return new;
end;
$$;

drop trigger if exists applications_sync_chat_channel
on public.applications;
create trigger applications_sync_chat_channel
after insert or update of
  school_name,
  production_title,
  applicant_user_id,
  is_archived
on public.applications
for each row execute function public.sync_application_chat_channel();

-- ---------------------------------------------------------------------------
-- Access and member resolution
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
        -- Owners can review every active conversation, including archived
        -- application history.
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
          coalesce(application.is_archived, false) = false
          and channel.channel_type = 'school_dm'
          and application.applicant_user_id = p_user_id
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
    select
      channel.channel_type,
      channel.application_id
    from public.chat_channels channel
    where channel.id = p_channel_id
      and channel.active = true
  ),
  eligible_users as (
    -- Owners are members of every channel.
    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where profile.active = true
      and profile.role = 'owner'

    union

    -- Community Chat contains applicants and owners only.
    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'applicant_community'
      and profile.active = true
      and profile.role = 'applicant'

    union

    -- General and Networking are staff-wide.
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

    -- School Owner DM contains the linked school account and all owners.
    select application.applicant_user_id
    from selected_channel channel
    join public.applications application
      on application.id = channel.application_id
    where channel.channel_type = 'school_dm'
      and application.applicant_user_id is not null

    union

    -- Explicit scoring/commenting assignments.
    select assignment.adjudicator_user_id
    from selected_channel channel
    join public.adjudicator_assignments assignment
      on assignment.application_id = channel.application_id
    where channel.channel_type = 'school'
      and assignment.removed_at is null

    union

    -- Staff attached through the booked schedule slot.
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
-- Rich channel navigation payload for the redesigned workspace.
-- The original get_my_chat_channels() function remains available for header
-- badge totals and older clients.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_chat_channels_v2()
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
    channel.id,
    channel.channel_type,
    channel.name,
    channel.description,
    channel.application_id,
    application.school_name,
    application.production_title,
    coalesce(application.is_archived, false),
    greatest(
      channel.updated_at,
      coalesce(latest_activity.created_at, channel.created_at)
    ) as last_activity_at,
    (
      select count(*)::bigint
      from (
        select post.created_at, post.author_id
        from public.chat_posts post
        where post.channel_id = channel.id

        union all

        select reply.created_at, reply.author_id
        from public.chat_replies reply
        where reply.channel_id = channel.id
      ) activity
      where activity.author_id <> auth.uid()
        and activity.created_at > coalesce(
          (
            select read_state.last_read_at
            from public.chat_channel_reads read_state
            where read_state.channel_id = channel.id
              and read_state.user_id = auth.uid()
          ),
          '-infinity'::timestamptz
        )
    ) as unread_count,
    case
      when latest_activity.body is null then null
      else substring(
        regexp_replace(latest_activity.body, E'\\s+', ' ', 'g')
        from 1 for 120
      )
    end as latest_message_preview,
    coalesce(
      nullif(trim(latest_author.full_name), ''),
      latest_author.email
    ) as latest_author_name,
    case
      when coalesce(application.is_archived, false) then 'archived'
      when channel.channel_type = 'applicant_community' then 'community'
      when channel.channel_type in ('general', 'networking') then 'staff'
      when channel.channel_type = 'advisory_committee' then 'committee'
      when channel.channel_type = 'school_dm' then 'direct_messages'
      when channel.channel_type = 'school' then 'school_staff'
      else 'other'
    end as channel_group,
    case
      when coalesce(application.is_archived, false) then 'Archived conversations'
      when channel.channel_type = 'applicant_community' then 'Community'
      when channel.channel_type in ('general', 'networking') then 'Staff channels'
      when channel.channel_type = 'advisory_committee' then 'Advisory Committee'
      when channel.channel_type = 'school_dm' then 'School DMs'
      when channel.channel_type = 'school' then 'School staff channels'
      else 'Other'
    end as channel_group_label,
    case
      when coalesce(application.is_archived, false) then 60
      when channel.channel_type = 'applicant_community' then 10
      when channel.channel_type in ('general', 'networking') then 20
      when channel.channel_type = 'advisory_committee' then 30
      when channel.channel_type = 'school_dm' then 40
      when channel.channel_type = 'school' then 50
      else 70
    end as channel_group_order,
    case channel.channel_type
      when 'applicant_community' then 'Applicants + Owners'
      when 'general' then 'Adjudicators + Advisory + Owners'
      when 'networking' then 'Adjudicators + Advisory + Owners'
      when 'advisory_committee' then 'Advisory + Owners'
      when 'school_dm' then 'School + Owners'
      when 'school' then 'Assigned panel + Owners'
      else 'Private channel'
    end as visibility_label
  from public.chat_channels channel
  left join public.applications application
    on application.id = channel.application_id
  left join lateral (
    select activity.body, activity.author_id, activity.created_at
    from (
      select post.body, post.author_id, post.created_at
      from public.chat_posts post
      where post.channel_id = channel.id

      union all

      select reply.body, reply.author_id, reply.created_at
      from public.chat_replies reply
      where reply.channel_id = channel.id
    ) activity
    order by activity.created_at desc
    limit 1
  ) latest_activity on true
  left join public.profiles latest_author
    on latest_author.id = latest_activity.author_id
  where public.can_access_chat_channel(channel.id, auth.uid())
  order by
    channel_group_order,
    case when (
      select count(*)
      from (
        select post.created_at, post.author_id
        from public.chat_posts post
        where post.channel_id = channel.id

        union all

        select reply.created_at, reply.author_id
        from public.chat_replies reply
        where reply.channel_id = channel.id
      ) unread_activity
      where unread_activity.author_id <> auth.uid()
        and unread_activity.created_at > coalesce(
          (
            select read_state.last_read_at
            from public.chat_channel_reads read_state
            where read_state.channel_id = channel.id
              and read_state.user_id = auth.uid()
          ),
          '-infinity'::timestamptz
        )
    ) > 0 then 0 else 1 end,
    greatest(channel.updated_at, coalesce(latest_activity.created_at, channel.created_at)) desc,
    channel.name;
$$;

grant execute on function public.get_my_chat_channels_v2()
to authenticated;

-- Keep realtime publication resilient when this migration is applied to a
-- project where chat was created in a different order.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_posts'
  ) then
    alter publication supabase_realtime add table public.chat_posts;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_replies'
  ) then
    alter publication supabase_realtime add table public.chat_replies;
  end if;
end;
$$;

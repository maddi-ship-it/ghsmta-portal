-- Add an all-portal announcements channel with Owner-only publishing, keep its
-- audience private from non-Owners, and allow authors to edit their messages.

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
      'advisory_committee',
      'direct_message',
      'group_direct_message',
      'portal_updates'
    )
  );

alter table public.chat_channels
  drop constraint if exists chat_channels_application_type_check;
alter table public.chat_channels
  add constraint chat_channels_application_type_check check (
    (
      channel_type in ('school', 'school_dm', 'scholarship_dm')
      and application_id is not null
    )
    or (
      channel_type not in ('school', 'school_dm', 'scholarship_dm')
      and application_id is null
    )
  );

update public.chat_channels
set
  name = 'Portal Updates',
  description = 'Official GHSMTA portal announcements. Only Owners can post.',
  active = true,
  updated_at = now()
where channel_type = 'portal_updates'
  and application_id is null;

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'portal_updates',
  'Portal Updates',
  'Official GHSMTA portal announcements. Only Owners can post.',
  null,
  true
where not exists (
  select 1
  from public.chat_channels channel
  where channel.channel_type = 'portal_updates'
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
          channel.channel_type = 'networking'
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
    where channel.channel_type = 'networking'
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
      else channel.channel_group
    end,
    case
      when channel.application_archived then 'Archived conversations'
      when channel.channel_type = 'portal_updates' then 'Portal Updates'
      when channel.channel_type = 'scholarship_dm' then 'Scholarship Applicants'
      when channel.channel_type in ('direct_message', 'group_direct_message') then 'Direct Messages'
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
      else channel.channel_group_order
    end,
    case
      when channel.channel_type = 'portal_updates' then 'All portal users · Owner posts only'
      when channel.channel_type = 'scholarship_dm' then 'Applicant + Program Managers + Owners'
      when channel.channel_type = 'direct_message' then 'Private direct message'
      when channel.channel_type = 'group_direct_message' then 'Private group message'
      when channel.channel_type = 'general' then 'Adjudicators + Advisory + Program Managers + Owners'
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

-- Portal Updates is deliberately excluded from shared-channel contact discovery;
-- otherwise the global channel would expose every portal user to everyone.
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
    coalesce(nullif(trim(contact.full_name), ''), contact.email, 'Portal user'),
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
        and channel.channel_type <> 'portal_updates'
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
    select 1 from public.profiles profile
    where profile.id = p_other_user_id and profile.active = true
  ) then
    raise exception 'The selected portal user is not active.';
  end if;

  if current_user_role <> 'owner'
    and not exists (
      select 1
      from public.chat_channels channel
      where channel.active = true
        and channel.channel_type <> 'portal_updates'
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
      select 1 from public.chat_direct_participants participant
      where participant.channel_id = channel.id
        and participant.user_id = current_user_id
    )
    and exists (
      select 1 from public.chat_direct_participants participant
      where participant.channel_id = channel.id
        and participant.user_id = p_other_user_id
    )
    and (
      select count(*) from public.chat_direct_participants participant
      where participant.channel_id = channel.id
    ) = 2
  order by channel.created_at
  limit 1;

  if direct_channel_id is not null then
    return direct_channel_id;
  end if;

  insert into public.chat_channels (
    channel_type, name, description, application_id, active, created_by
  )
  values (
    'direct_message', 'Direct message',
    'Private one-to-one portal conversation.', null, true, current_user_id
  )
  returning id into direct_channel_id;

  insert into public.chat_direct_participants (channel_id, user_id, added_by)
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

-- Enforce the Owner-only publishing rule at the row-policy layer.
drop policy if exists "channel members create chat posts" on public.chat_posts;
create policy "channel members create chat posts"
on public.chat_posts for insert to authenticated
with check (
  author_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = channel_id
        and channel.channel_type = 'portal_updates'
    )
    or public.current_user_role() = 'owner'
  )
);

drop policy if exists "channel members create chat replies" on public.chat_replies;
create policy "channel members create chat replies"
on public.chat_replies for insert to authenticated
with check (
  author_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = channel_id
        and channel.channel_type = 'portal_updates'
    )
    or public.current_user_role() = 'owner'
  )
  and exists (
    select 1
    from public.chat_posts post
    where post.id = post_id
      and post.channel_id = chat_replies.channel_id
      and post.locked = false
  )
);

drop policy if exists "channel members add attachments" on public.chat_attachments;
create policy "channel members add attachments"
on public.chat_attachments for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = channel_id
        and channel.channel_type = 'portal_updates'
    )
    or public.current_user_role() = 'owner'
  )
);

drop policy if exists "channel members upload chat file objects" on storage.objects;
create policy "channel members upload chat file objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.can_access_chat_channel(
    ((storage.foldername(name))[2])::uuid,
    auth.uid()
  )
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = ((storage.foldername(name))[2])::uuid
        and channel.channel_type = 'portal_updates'
    )
    or public.current_user_role() = 'owner'
  )
);

drop policy if exists "authors edit own chat posts" on public.chat_posts;
create policy "authors edit own chat posts"
on public.chat_posts for update to authenticated
using (
  author_id = auth.uid()
  and deleted_at is null
  and public.can_access_chat_channel(channel_id, auth.uid())
)
with check (
  author_id = auth.uid()
  and deleted_at is null
  and public.can_access_chat_channel(channel_id, auth.uid())
);

drop policy if exists "authors edit own chat replies" on public.chat_replies;
create policy "authors edit own chat replies"
on public.chat_replies for update to authenticated
using (
  author_id = auth.uid()
  and deleted_at is null
  and public.can_access_chat_channel(channel_id, auth.uid())
)
with check (
  author_id = auth.uid()
  and deleted_at is null
  and public.can_access_chat_channel(channel_id, auth.uid())
);

create or replace function public.protect_chat_message_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel_id is distinct from old.channel_id
    or new.author_id is distinct from old.author_id then
    raise exception 'Chat message identity cannot be changed.';
  end if;

  if tg_table_name = 'chat_replies'
    and (to_jsonb(new) ->> 'post_id') is distinct from (to_jsonb(old) ->> 'post_id') then
    raise exception 'A reply cannot be moved to another thread.';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_chat_message_identity()
from public, anon, authenticated;

drop trigger if exists chat_posts_protect_identity on public.chat_posts;
create trigger chat_posts_protect_identity
before update on public.chat_posts
for each row execute function public.protect_chat_message_identity();

drop trigger if exists chat_replies_protect_identity on public.chat_replies;
create trigger chat_replies_protect_identity
before update on public.chat_replies
for each row execute function public.protect_chat_message_identity();

commit;

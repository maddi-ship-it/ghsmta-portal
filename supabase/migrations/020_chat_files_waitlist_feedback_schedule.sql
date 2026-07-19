-- GHSMTA Portal: chat moderation, school files, schedule date waitlists,
-- reliable portal feedback, and scheduling workspace support.
-- Run after migration 019.

-- ---------------------------------------------------------------------------
-- Owner soft-deletion of chat messages
-- ---------------------------------------------------------------------------

alter table public.chat_posts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_reason text;

alter table public.chat_replies
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_reason text;

create index if not exists chat_posts_deleted_idx
  on public.chat_posts(channel_id, deleted_at, created_at);
create index if not exists chat_replies_deleted_idx
  on public.chat_replies(channel_id, deleted_at, created_at);

create table if not exists public.chat_message_moderation_audit (
  id uuid primary key default gen_random_uuid(),
  message_kind text not null check (message_kind in ('post', 'reply')),
  message_id uuid not null,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  original_subject text,
  original_body text not null,
  deleted_by uuid references public.profiles(id) on delete set null,
  deletion_reason text,
  deleted_at timestamptz not null default now(),
  unique (message_kind, message_id)
);

alter table public.chat_message_moderation_audit enable row level security;
grant select on public.chat_message_moderation_audit to authenticated;

drop policy if exists "owners read chat moderation audit"
on public.chat_message_moderation_audit;
create policy "owners read chat moderation audit"
on public.chat_message_moderation_audit for select to authenticated
using (public.current_user_role() = 'owner');

create or replace function public.owner_soft_delete_chat_message(
  p_message_kind text,
  p_message_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Owner access required.';
  end if;

  if p_message_kind = 'post' then
    insert into public.chat_message_moderation_audit (
      message_kind, message_id, channel_id, author_id, original_subject,
      original_body, deleted_by, deletion_reason
    )
    select
      'post', post.id, post.channel_id, post.author_id, post.subject, post.body,
      auth.uid(), nullif(trim(p_reason), '')
    from public.chat_posts post
    where post.id = p_message_id and post.deleted_at is null
    on conflict (message_kind, message_id) do nothing;

    update public.chat_posts
    set
      subject = 'Message removed by an Owner',
      body = 'Message removed by an Owner.',
      deleted_at = coalesce(deleted_at, now()),
      deleted_by = coalesce(deleted_by, auth.uid()),
      deletion_reason = coalesce(nullif(trim(p_reason), ''), deletion_reason),
      updated_at = now()
    where id = p_message_id;
  elsif p_message_kind = 'reply' then
    insert into public.chat_message_moderation_audit (
      message_kind, message_id, channel_id, author_id, original_body,
      deleted_by, deletion_reason
    )
    select
      'reply', reply.id, reply.channel_id, reply.author_id, reply.body,
      auth.uid(), nullif(trim(p_reason), '')
    from public.chat_replies reply
    where reply.id = p_message_id and reply.deleted_at is null
    on conflict (message_kind, message_id) do nothing;

    update public.chat_replies
    set
      body = 'Message removed by an Owner.',
      deleted_at = coalesce(deleted_at, now()),
      deleted_by = coalesce(deleted_by, auth.uid()),
      deletion_reason = coalesce(nullif(trim(p_reason), ''), deletion_reason),
      updated_at = now()
    where id = p_message_id;
  else
    raise exception 'Unsupported chat message type.';
  end if;

  if not found then
    raise exception 'Chat message not found.';
  end if;
end;
$$;

grant execute on function public.owner_soft_delete_chat_message(text, uuid, text)
to authenticated;

-- Add deletion metadata to the chat RPC while preserving every message for the
-- audit record. Deleted bodies are never returned to normal portal clients.
drop function if exists public.get_chat_channel_threads(uuid);
create function public.get_chat_channel_threads(
  p_channel_id uuid
)
returns table (
  post_id uuid,
  subject text,
  body text,
  pinned boolean,
  locked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_activity_at timestamptz,
  author_id uuid,
  author_name text,
  author_role public.app_role,
  post_deleted_at timestamptz,
  post_deleted_by uuid,
  post_deletion_reason text,
  reply_count bigint,
  replies jsonb
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
  select
    post.id,
    case
      when post.deleted_at is not null then 'Message removed by an Owner'
      else post.subject
    end,
    case
      when post.deleted_at is not null then 'Message removed by an Owner.'
      else post.body
    end,
    post.pinned,
    post.locked,
    post.created_at,
    post.updated_at,
    post.last_activity_at,
    post.author_id,
    coalesce(post_author.full_name, post_author.email, 'Portal user'),
    post_author.role,
    post.deleted_at,
    post.deleted_by,
    post.deletion_reason,
    count(reply.id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', reply.id,
          'body', case
            when reply.deleted_at is not null then 'Message removed by an Owner.'
            else reply.body
          end,
          'created_at', reply.created_at,
          'updated_at', reply.updated_at,
          'author_id', reply.author_id,
          'author_name', coalesce(reply_author.full_name, reply_author.email, 'Portal user'),
          'author_role', reply_author.role,
          'deleted_at', reply.deleted_at,
          'deleted_by', reply.deleted_by,
          'deletion_reason', reply.deletion_reason
        )
        order by reply.created_at
      ) filter (where reply.id is not null),
      '[]'::jsonb
    )
  from public.chat_posts post
  join public.profiles post_author
    on post_author.id = post.author_id
  left join public.chat_replies reply
    on reply.post_id = post.id
  left join public.profiles reply_author
    on reply_author.id = reply.author_id
  where post.channel_id = p_channel_id
  group by
    post.id,
    post.subject,
    post.body,
    post.pinned,
    post.locked,
    post.created_at,
    post.updated_at,
    post.last_activity_at,
    post.author_id,
    post.deleted_at,
    post.deleted_by,
    post.deletion_reason,
    post_author.full_name,
    post_author.email,
    post_author.role
  order by post.pinned desc, post.last_activity_at desc;
end;
$$;

grant execute on function public.get_chat_channel_threads(uuid)
to authenticated;

-- Keep deleted messages visible as audit placeholders in channel previews while
-- avoiding any exposure of the original text.
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
    channel.id as channel_id,
    channel.channel_type as channel_type,
    channel.name as channel_name,
    channel.description as channel_description,
    channel.application_id as application_id,
    application.school_name as school_name,
    application.production_title as production_title,
    coalesce(application.is_archived, false) as application_archived,
    greatest(channel.updated_at, coalesce(latest_activity.created_at, channel.created_at)) as last_activity_at,
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
      else substring(regexp_replace(latest_activity.body, E'\\s+', ' ', 'g') from 1 for 120)
    end as latest_message_preview,
    coalesce(nullif(trim(latest_author.full_name), ''), latest_author.email) as latest_author_name,
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
  left join public.applications application on application.id = channel.application_id
  left join lateral (
    select activity.body, activity.author_id, activity.created_at
    from (
      select
        case when post.deleted_at is not null then 'Message removed by an Owner.' else post.body end as body,
        post.author_id,
        post.created_at
      from public.chat_posts post
      where post.channel_id = channel.id
      union all
      select
        case when reply.deleted_at is not null then 'Message removed by an Owner.' else reply.body end,
        reply.author_id,
        reply.created_at
      from public.chat_replies reply
      where reply.channel_id = channel.id
    ) activity
    order by activity.created_at desc
    limit 1
  ) latest_activity on true
  left join public.profiles latest_author on latest_author.id = latest_activity.author_id
  where public.can_access_chat_channel(channel.id, auth.uid())
  order by
    channel_group_order,
    case when (
      select count(*)
      from (
        select post.created_at, post.author_id from public.chat_posts post where post.channel_id = channel.id
        union all
        select reply.created_at, reply.author_id from public.chat_replies reply where reply.channel_id = channel.id
      ) unread_activity
      where unread_activity.author_id <> auth.uid()
        and unread_activity.created_at > coalesce(
          (
            select read_state.last_read_at
            from public.chat_channel_reads read_state
            where read_state.channel_id = channel.id and read_state.user_id = auth.uid()
          ),
          '-infinity'::timestamptz
        )
    ) > 0 then 0 else 1 end,
    greatest(channel.updated_at, coalesce(latest_activity.created_at, channel.created_at)) desc,
    channel.name;
$$;

grant execute on function public.get_my_chat_channels_v2() to authenticated;

-- ---------------------------------------------------------------------------
-- School file library and assigned-reviewer access
-- ---------------------------------------------------------------------------

alter table public.portal_files
  add column if not exists document_category text not null default 'other',
  add column if not exists reviewer_visible boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create index if not exists portal_files_application_library_idx
  on public.portal_files(application_id, archived_at, created_at desc)
  where context_type = 'application';

create or replace function public.can_access_application_documents(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or public.is_application_member(p_application_id, p_user_id)
    or exists (
      select 1
      from public.adjudicator_assignments assignment
      join public.profiles profile on profile.id = assignment.adjudicator_user_id
      where assignment.application_id = p_application_id
        and assignment.adjudicator_user_id = p_user_id
        and profile.active = true
        and profile.role in ('adjudicator', 'advisory_member')
    )
    or exists (
      select 1
      from public.schedule_school_bookings booking
      join public.schedule_slot_staff staff on staff.slot_id = booking.slot_id
      join public.profiles profile on profile.id = staff.user_id
      where booking.application_id = p_application_id
        and staff.user_id = p_user_id
        and profile.active = true
        and profile.role in ('adjudicator', 'advisory_member')
    );
$$;

grant execute on function public.can_access_application_documents(uuid, uuid)
to authenticated;

create or replace function public.can_manage_application_documents(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'owner'
    or public.is_application_member(p_application_id, p_user_id);
$$;

grant execute on function public.can_manage_application_documents(uuid, uuid)
to authenticated;

create or replace function public.get_my_school_file_applications()
returns table (
  application_id uuid,
  cycle_id uuid,
  school_name text,
  production_title text,
  season_year text,
  program_name text,
  can_upload boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    application.id,
    application.cycle_id,
    application.school_name,
    application.production_title,
    cycle.season_year,
    cycle.name,
    public.can_manage_application_documents(application.id, auth.uid())
  from public.applications application
  join public.award_cycles cycle on cycle.id = application.cycle_id
  where coalesce(application.is_archived, false) = false
    and public.can_access_application_documents(application.id, auth.uid())
  order by application.school_name, application.production_title nulls last;
$$;

grant execute on function public.get_my_school_file_applications()
to authenticated;

drop policy if exists "context participants read portal files" on public.portal_files;
create policy "context participants read portal files"
on public.portal_files for select to authenticated
using (
  public.current_user_role() = 'owner'
  or uploaded_by = auth.uid()
  or (
    context_type = 'appeal'
    and public.current_user_role() = 'advisory_member'
  )
  or (
    application_id is not null
    and public.is_application_member(application_id, auth.uid())
  )
  or (
    context_type = 'application'
    and application_id is not null
    and reviewer_visible = true
    and public.can_access_application_documents(application_id, auth.uid())
  )
);

drop policy if exists "users register own portal files" on public.portal_files;
create policy "users register own portal files"
on public.portal_files for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    context_type <> 'application'
    or (
      application_id is not null
      and public.can_manage_application_documents(application_id, auth.uid())
    )
  )
);

drop policy if exists "portal file participants read storage" on storage.objects;
create policy "portal file participants read storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'portal-files'
  and exists (
    select 1
    from public.portal_files file
    where file.storage_path = name
      and (
        public.current_user_role() = 'owner'
        or file.uploaded_by = auth.uid()
        or (
          file.context_type = 'appeal'
          and public.current_user_role() = 'advisory_member'
        )
        or (
          file.application_id is not null
          and public.is_application_member(file.application_id, auth.uid())
        )
        or (
          file.context_type = 'application'
          and file.application_id is not null
          and file.reviewer_visible = true
          and public.can_access_application_documents(file.application_id, auth.uid())
        )
      )
  )
);

create or replace function public.archive_school_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_file public.portal_files%rowtype;
begin
  select * into selected_file from public.portal_files where id = p_file_id;

  if selected_file.id is null or selected_file.context_type <> 'application' then
    raise exception 'School file not found.';
  end if;

  if not (
    public.current_user_role() = 'owner'
    or selected_file.uploaded_by = auth.uid()
    or public.can_manage_application_documents(selected_file.application_id, auth.uid())
  ) then
    raise exception 'You cannot remove this file.';
  end if;

  update public.portal_files
  set archived_at = now(), archived_by = auth.uid()
  where id = p_file_id;
end;
$$;

grant execute on function public.archive_school_file(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Date-based schedule waitlists and slot offers
-- ---------------------------------------------------------------------------

create table if not exists public.schedule_date_waitlist (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.award_cycles(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  requested_date date not null,
  time_preference text not null default 'any' check (
    time_preference in ('morning', 'afternoon', 'evening', 'any')
  ),
  status text not null default 'waiting' check (
    status in ('waiting', 'offered', 'accepted', 'declined', 'removed', 'expired')
  ),
  offered_slot_id uuid references public.schedule_slots(id) on delete set null,
  offer_expires_at timestamptz,
  offered_by uuid references public.profiles(id) on delete set null,
  applicant_notes text,
  owner_notes text,
  joined_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists schedule_date_waitlist_active_unique
  on public.schedule_date_waitlist(application_id, requested_date)
  where status in ('waiting', 'offered');
create index if not exists schedule_date_waitlist_owner_idx
  on public.schedule_date_waitlist(cycle_id, requested_date, status, created_at);

drop trigger if exists schedule_date_waitlist_set_updated_at
on public.schedule_date_waitlist;
create trigger schedule_date_waitlist_set_updated_at
before update on public.schedule_date_waitlist
for each row execute function public.set_updated_at();

alter table public.schedule_date_waitlist enable row level security;
grant select on public.schedule_date_waitlist to authenticated;

drop policy if exists "waitlist owners and school teams read" on public.schedule_date_waitlist;
create policy "waitlist owners and school teams read"
on public.schedule_date_waitlist for select to authenticated
using (
  public.current_user_role() = 'owner'
  or public.is_application_member(application_id, auth.uid())
);

create or replace function public.join_schedule_date_waitlist(
  p_application_id uuid,
  p_requested_date date,
  p_time_preference text default 'any',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_application public.applications%rowtype;
  result_id uuid;
begin
  if not public.is_application_member(p_application_id, auth.uid()) then
    raise exception 'You do not have access to this application.';
  end if;

  if p_requested_date < (now() at time zone 'America/New_York')::date then
    raise exception 'Choose a current or future date.';
  end if;

  if p_time_preference not in ('morning', 'afternoon', 'evening', 'any') then
    raise exception 'Choose a valid time preference.';
  end if;

  select * into selected_application
  from public.applications
  where id = p_application_id
    and coalesce(is_archived, false) = false;

  if selected_application.id is null then
    raise exception 'Application not found.';
  end if;

  if exists (
    select 1 from public.schedule_school_bookings booking
    where booking.application_id = p_application_id
  ) then
    raise exception 'This school already has a schedule reservation.';
  end if;

  insert into public.schedule_date_waitlist (
    cycle_id,
    application_id,
    requested_date,
    time_preference,
    applicant_notes,
    joined_by
  ) values (
    selected_application.cycle_id,
    p_application_id,
    p_requested_date,
    p_time_preference,
    nullif(trim(p_notes), ''),
    auth.uid()
  )
  on conflict (application_id, requested_date)
  where status in ('waiting', 'offered')
  do update set
    time_preference = excluded.time_preference,
    applicant_notes = excluded.applicant_notes,
    status = 'waiting',
    offered_slot_id = null,
    offer_expires_at = null,
    offered_by = null,
    updated_at = now()
  returning id into result_id;

  return result_id;
end;
$$;

grant execute on function public.join_schedule_date_waitlist(uuid, date, text, text)
to authenticated;

create or replace function public.leave_schedule_date_waitlist(p_waitlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.schedule_date_waitlist entry
  set status = 'removed', updated_at = now()
  where entry.id = p_waitlist_id
    and public.is_application_member(entry.application_id, auth.uid())
    and entry.status in ('waiting', 'offered');

  if not found then
    raise exception 'Waitlist entry not found or cannot be removed.';
  end if;
end;
$$;

grant execute on function public.leave_schedule_date_waitlist(uuid)
to authenticated;

create or replace function public.owner_offer_waitlist_slot(
  p_waitlist_id uuid,
  p_slot_id uuid,
  p_expires_hours integer default 24
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_entry public.schedule_date_waitlist%rowtype;
  selected_slot public.schedule_slots%rowtype;
  school_name text;
  school_dm_id uuid;
  owner_name text;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Owner access required.';
  end if;

  select * into selected_entry from public.schedule_date_waitlist where id = p_waitlist_id;
  select * into selected_slot from public.schedule_slots where id = p_slot_id;

  if selected_entry.id is null or selected_entry.status not in ('waiting', 'offered') then
    raise exception 'Active waitlist entry not found.';
  end if;
  if selected_slot.id is null or selected_slot.status <> 'open' then
    raise exception 'Choose an open schedule slot.';
  end if;
  if selected_slot.cycle_id <> selected_entry.cycle_id then
    raise exception 'The slot must belong to the same program.';
  end if;
  if (selected_slot.starts_at at time zone 'America/New_York')::date <> selected_entry.requested_date then
    raise exception 'The slot must be on the requested waitlist date.';
  end if;
  if exists (select 1 from public.schedule_school_bookings where slot_id = p_slot_id) then
    raise exception 'That slot is already booked.';
  end if;

  update public.schedule_date_waitlist
  set
    status = 'offered',
    offered_slot_id = p_slot_id,
    offer_expires_at = now() + make_interval(hours => greatest(1, least(p_expires_hours, 168))),
    offered_by = auth.uid(),
    updated_at = now()
  where id = p_waitlist_id;

  select application.school_name into school_name
  from public.applications application
  where application.id = selected_entry.application_id;

  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href,
    related_application_id
  )
  select
    member.user_id,
    'schedule_waitlist_offer',
    'A schedule slot is available',
    'GHSMTA has offered your school a schedule slot on ' || selected_entry.requested_date::text || '.',
    '/portal/schedule',
    selected_entry.application_id
  from public.application_members member
  where member.application_id = selected_entry.application_id
    and member.active = true;

  select channel.id into school_dm_id
  from public.chat_channels channel
  where channel.application_id = selected_entry.application_id
    and channel.channel_type = 'school_dm'
    and channel.active = true
  limit 1;

  if school_dm_id is not null then
    select coalesce(profile.full_name, profile.email, 'GHSMTA Owner') into owner_name
    from public.profiles profile where profile.id = auth.uid();

    insert into public.chat_posts(channel_id, author_id, subject, body)
    values (
      school_dm_id,
      auth.uid(),
      'Schedule waitlist offer',
      'A schedule slot is available for ' || coalesce(school_name, 'your school') ||
      ' on ' || selected_entry.requested_date::text || '. Open Scheduling to accept or decline the offer.'
    );
  end if;
end;
$$;

grant execute on function public.owner_offer_waitlist_slot(uuid, uuid, integer)
to authenticated;

create or replace function public.accept_schedule_waitlist_offer(p_waitlist_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_entry public.schedule_date_waitlist%rowtype;
  booking_id uuid;
begin
  select * into selected_entry
  from public.schedule_date_waitlist
  where id = p_waitlist_id
  for update;

  if selected_entry.id is null
     or not public.is_application_member(selected_entry.application_id, auth.uid()) then
    raise exception 'Waitlist offer not found.';
  end if;
  if selected_entry.status <> 'offered' or selected_entry.offered_slot_id is null then
    raise exception 'This waitlist entry does not have an active offer.';
  end if;
  if selected_entry.offer_expires_at is not null and selected_entry.offer_expires_at <= now() then
    update public.schedule_date_waitlist set status = 'expired' where id = p_waitlist_id;
    raise exception 'This waitlist offer has expired.';
  end if;

  insert into public.schedule_school_bookings(slot_id, application_id, booked_by)
  values (selected_entry.offered_slot_id, selected_entry.application_id, auth.uid())
  returning id into booking_id;

  update public.schedule_date_waitlist
  set status = 'accepted', updated_at = now()
  where id = p_waitlist_id;

  update public.schedule_date_waitlist
  set status = 'removed', updated_at = now()
  where application_id = selected_entry.application_id
    and id <> p_waitlist_id
    and status in ('waiting', 'offered');

  return booking_id;
exception
  when unique_violation then
    raise exception 'The school or slot already has a reservation.';
end;
$$;

grant execute on function public.accept_schedule_waitlist_offer(uuid)
to authenticated;

create or replace function public.decline_schedule_waitlist_offer(p_waitlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.schedule_date_waitlist entry
  set status = 'declined', updated_at = now()
  where entry.id = p_waitlist_id
    and public.is_application_member(entry.application_id, auth.uid())
    and entry.status = 'offered';

  if not found then
    raise exception 'Waitlist offer not found.';
  end if;
end;
$$;

grant execute on function public.decline_schedule_waitlist_offer(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Feedback reliability and Owner notification
-- ---------------------------------------------------------------------------

alter table public.portal_feedback_requests
  add column if not exists reference_code text,
  add column if not exists screen_width integer,
  add column if not exists screen_height integer,
  add column if not exists client_context jsonb not null default '{}'::jsonb;

create unique index if not exists portal_feedback_reference_code_idx
  on public.portal_feedback_requests(reference_code)
  where reference_code is not null;

create or replace function public.set_feedback_reference_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reference_code is null then
    new.reference_code := 'GH-' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;

drop trigger if exists portal_feedback_reference_code
on public.portal_feedback_requests;
create trigger portal_feedback_reference_code
before insert on public.portal_feedback_requests
for each row execute function public.set_feedback_reference_code();

create or replace function public.notify_feedback_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href
  )
  select
    profile.id,
    'portal_feedback',
    case when new.request_type = 'bug_report' then 'New bug report' else 'New feature request' end,
    new.reference_code || ': ' || new.title,
    '/portal/admin/workflows'
  from public.profiles profile
  where profile.role = 'owner' and profile.active = true;

  return new;
end;
$$;

drop trigger if exists portal_feedback_notify_owners
on public.portal_feedback_requests;
create trigger portal_feedback_notify_owners
after insert on public.portal_feedback_requests
for each row execute function public.notify_feedback_submitted();

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'schedule_date_waitlist'
  ) then
    alter publication supabase_realtime add table public.schedule_date_waitlist;
  end if;
exception when duplicate_object then null;
end $$;

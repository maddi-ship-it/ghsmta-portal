-- GHSMTA Portal: Teams-style threaded channel chat.
-- Run after migrations 001-010.

create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (
    channel_type in (
      'school',
      'applicant_community',
      'general',
      'networking',
      'advisory_committee'
    )
  ),
  name text not null,
  description text,
  application_id uuid unique references public.applications(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_channels_application_type_check check (
    (channel_type = 'school' and application_id is not null)
    or
    (channel_type <> 'school' and application_id is null)
  )
);

create unique index if not exists chat_channels_global_type_unique
  on public.chat_channels(channel_type)
  where application_id is null;

create index if not exists chat_channels_application_idx
  on public.chat_channels(application_id)
  where application_id is not null;

create table if not exists public.chat_posts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  subject text not null check (char_length(subject) between 1 and 180),
  body text not null check (char_length(body) between 1 and 5000),
  pinned boolean not null default false,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index if not exists chat_posts_channel_activity_idx
  on public.chat_posts(channel_id, pinned desc, last_activity_at desc);

create table if not exists public.chat_replies (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  post_id uuid not null references public.chat_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_replies_post_created_idx
  on public.chat_replies(post_id, created_at);

create index if not exists chat_replies_channel_created_idx
  on public.chat_replies(channel_id, created_at);

create table if not exists public.chat_channel_reads (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists chat_channel_reads_user_idx
  on public.chat_channel_reads(user_id, last_read_at desc);

-- Reuse the portal's standard updated_at trigger.
drop trigger if exists chat_channels_set_updated_at on public.chat_channels;
create trigger chat_channels_set_updated_at
before update on public.chat_channels
for each row execute function public.set_updated_at();

drop trigger if exists chat_posts_set_updated_at on public.chat_posts;
create trigger chat_posts_set_updated_at
before update on public.chat_posts
for each row execute function public.set_updated_at();

drop trigger if exists chat_replies_set_updated_at on public.chat_replies;
create trigger chat_replies_set_updated_at
before update on public.chat_replies
for each row execute function public.set_updated_at();

-- Keep a root post's activity timestamp current when replies are added.
create or replace function public.touch_chat_post_from_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_posts
  set last_activity_at = greatest(now(), new.created_at)
  where id = new.post_id;

  return new;
end;
$$;

drop trigger if exists chat_reply_touch_post on public.chat_replies;
create trigger chat_reply_touch_post
after insert on public.chat_replies
for each row execute function public.touch_chat_post_from_reply();

-- Create or update the private school channel that belongs to an application.
create or replace function public.sync_application_chat_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.applicant_user_id is not null
     and coalesce(new.is_archived, false) = false then
    insert into public.chat_channels (
      channel_type,
      name,
      description,
      application_id,
      active
    ) values (
      'school',
      new.school_name,
      coalesce(new.production_title, 'School application channel'),
      new.id,
      true
    )
    on conflict (application_id) do update set
      name = excluded.name,
      description = excluded.description,
      active = true,
      updated_at = now();
  else
    update public.chat_channels
    set active = false,
        updated_at = now()
    where application_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists applications_sync_chat_channel on public.applications;
create trigger applications_sync_chat_channel
after insert or update of
  school_name,
  production_title,
  applicant_user_id,
  is_archived
on public.applications
for each row execute function public.sync_application_chat_channel();

-- Global channels.
insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'applicant_community',
  'Applicant Community',
  'A shared space for applicants, adjudicators, and GHSMTA owners.',
  null,
  true
where not exists (
  select 1 from public.chat_channels
  where channel_type = 'applicant_community'
    and application_id is null
);

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
  select 1 from public.chat_channels
  where channel_type = 'general'
    and application_id is null
);

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
  select 1 from public.chat_channels
  where channel_type = 'networking'
    and application_id is null
);

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
  select 1 from public.chat_channels
  where channel_type = 'advisory_committee'
    and application_id is null
);

-- Backfill school channels for existing live portal applications.
insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'school',
  application.school_name,
  coalesce(application.production_title, 'School application channel'),
  application.id,
  true
from public.applications application
where application.applicant_user_id is not null
  and coalesce(application.is_archived, false) = false
on conflict (application_id) do update set
  name = excluded.name,
  description = excluded.description,
  active = true,
  updated_at = now();

-- Central channel-access function used by every chat RLS policy.
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
          and profile.role in ('applicant', 'adjudicator')
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
          channel.channel_type = 'school'
          and (
            application.applicant_user_id = p_user_id
            or (
              profile.role = 'adjudicator'
              and exists (
                select 1
                from public.adjudicator_assignments assignment
                where assignment.application_id = channel.application_id
                  and assignment.adjudicator_user_id = p_user_id
              )
            )
          )
        )
      )
  );
$$;

grant execute on function public.can_access_chat_channel(uuid, uuid)
to authenticated;

-- Safe channel list with unread totals. This avoids exposing applications or
-- profile rows outside the caller's channel permissions.
create or replace function public.get_my_chat_channels()
returns table (
  channel_id uuid,
  channel_type text,
  channel_name text,
  channel_description text,
  application_id uuid,
  school_name text,
  production_title text,
  last_activity_at timestamptz,
  unread_count bigint
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
    greatest(
      channel.updated_at,
      coalesce(
        (
          select max(post.last_activity_at)
          from public.chat_posts post
          where post.channel_id = channel.id
        ),
        channel.created_at
      )
    ) as last_activity_at,
    (
      select count(*)
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
    )::bigint as unread_count
  from public.chat_channels channel
  left join public.applications application
    on application.id = channel.application_id
  where public.can_access_chat_channel(channel.id, auth.uid())
  order by
    case channel.channel_type
      when 'applicant_community' then 1
      when 'general' then 2
      when 'networking' then 3
      when 'advisory_committee' then 4
      when 'school' then 5
      else 6
    end,
    channel.name;
$$;

grant execute on function public.get_my_chat_channels()
to authenticated;

-- Return threaded posts with safe author information.
create or replace function public.get_chat_channel_threads(
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
    post.subject,
    post.body,
    post.pinned,
    post.locked,
    post.created_at,
    post.updated_at,
    post.last_activity_at,
    post.author_id,
    coalesce(post_author.full_name, post_author.email, 'Portal user'),
    post_author.role,
    count(reply.id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', reply.id,
          'body', reply.body,
          'created_at', reply.created_at,
          'updated_at', reply.updated_at,
          'author_id', reply.author_id,
          'author_name', coalesce(reply_author.full_name, reply_author.email, 'Portal user'),
          'author_role', reply_author.role
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
    post_author.full_name,
    post_author.email,
    post_author.role
  order by post.pinned desc, post.last_activity_at desc;
end;
$$;

grant execute on function public.get_chat_channel_threads(uuid)
to authenticated;

create or replace function public.mark_chat_channel_read(
  p_channel_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_chat_channel(p_channel_id, auth.uid()) then
    raise exception 'You do not have access to this channel.';
  end if;

  insert into public.chat_channel_reads (
    channel_id,
    user_id,
    last_read_at
  ) values (
    p_channel_id,
    auth.uid(),
    now()
  )
  on conflict (channel_id, user_id) do update set
    last_read_at = excluded.last_read_at;
end;
$$;

grant execute on function public.mark_chat_channel_read(uuid)
to authenticated;

alter table public.chat_channels enable row level security;
alter table public.chat_posts enable row level security;
alter table public.chat_replies enable row level security;
alter table public.chat_channel_reads enable row level security;

-- Channels are managed automatically by the system. Owners may update names,
-- descriptions, and active status later through an admin UI.
drop policy if exists "channel members read channels" on public.chat_channels;
create policy "channel members read channels"
on public.chat_channels for select to authenticated
using (public.can_access_chat_channel(id, auth.uid()));

drop policy if exists "owners update chat channels" on public.chat_channels;
create policy "owners update chat channels"
on public.chat_channels for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

-- Root posts.
drop policy if exists "channel members read chat posts" on public.chat_posts;
create policy "channel members read chat posts"
on public.chat_posts for select to authenticated
using (public.can_access_chat_channel(channel_id, auth.uid()));

drop policy if exists "channel members create chat posts" on public.chat_posts;
create policy "channel members create chat posts"
on public.chat_posts for insert to authenticated
with check (
  author_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
);

drop policy if exists "owners moderate chat posts" on public.chat_posts;
create policy "owners moderate chat posts"
on public.chat_posts for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "owners delete chat posts" on public.chat_posts;
create policy "owners delete chat posts"
on public.chat_posts for delete to authenticated
using (public.current_user_role() = 'owner');

-- Replies.
drop policy if exists "channel members read chat replies" on public.chat_replies;
create policy "channel members read chat replies"
on public.chat_replies for select to authenticated
using (public.can_access_chat_channel(channel_id, auth.uid()));

drop policy if exists "channel members create chat replies" on public.chat_replies;
create policy "channel members create chat replies"
on public.chat_replies for insert to authenticated
with check (
  author_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
  and exists (
    select 1
    from public.chat_posts post
    where post.id = post_id
      and post.channel_id = channel_id
      and post.locked = false
  )
);

drop policy if exists "owners delete chat replies" on public.chat_replies;
create policy "owners delete chat replies"
on public.chat_replies for delete to authenticated
using (public.current_user_role() = 'owner');

-- Read receipts are private to each user.
drop policy if exists "users read own channel receipts" on public.chat_channel_reads;
create policy "users read own channel receipts"
on public.chat_channel_reads for select to authenticated
using (user_id = auth.uid());

drop policy if exists "users create own channel receipts" on public.chat_channel_reads;
create policy "users create own channel receipts"
on public.chat_channel_reads for insert to authenticated
with check (
  user_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
);

drop policy if exists "users update own channel receipts" on public.chat_channel_reads;
create policy "users update own channel receipts"
on public.chat_channel_reads for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
);

-- Live message updates for Teams-style channel refresh.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_posts'
  ) then
    alter publication supabase_realtime
      add table public.chat_posts;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_replies'
  ) then
    alter publication supabase_realtime
      add table public.chat_replies;
  end if;
end
$$;

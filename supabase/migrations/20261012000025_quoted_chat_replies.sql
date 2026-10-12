begin;

-- Preserve which exact message a reply references so the chat interface can
-- render an iMessage-style quote and navigate back to the original message.
alter table public.chat_replies
  add column if not exists reply_to_post_id uuid
    references public.chat_posts(id) on delete set null,
  add column if not exists reply_to_reply_id uuid
    references public.chat_replies(id) on delete set null;

alter table public.chat_replies
  drop constraint if exists chat_replies_single_reference_check;

alter table public.chat_replies
  add constraint chat_replies_single_reference_check check (
    num_nonnulls(reply_to_post_id, reply_to_reply_id) <= 1
  );

create index if not exists chat_replies_reply_to_post_idx
  on public.chat_replies(reply_to_post_id)
  where reply_to_post_id is not null;

create index if not exists chat_replies_reply_to_reply_idx
  on public.chat_replies(reply_to_reply_id)
  where reply_to_reply_id is not null;

create or replace function public.validate_chat_reply_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reply_to_post_id is not null
    and not exists (
      select 1
      from public.chat_posts post
      where post.id = new.reply_to_post_id
        and post.id = new.post_id
        and post.channel_id = new.channel_id
    ) then
    raise exception 'The referenced message is not part of this conversation.';
  end if;

  if new.reply_to_reply_id is not null
    and not exists (
      select 1
      from public.chat_replies reply
      where reply.id = new.reply_to_reply_id
        and reply.post_id = new.post_id
        and reply.channel_id = new.channel_id
    ) then
    raise exception 'The referenced reply is not part of this conversation.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_chat_reply_reference()
from public, anon, authenticated;

drop trigger if exists chat_reply_validate_reference on public.chat_replies;
create trigger chat_reply_validate_reference
before insert or update of channel_id, post_id, reply_to_post_id, reply_to_reply_id
on public.chat_replies
for each row execute function public.validate_chat_reply_reference();

-- Move existing Applicant direct-message histories into the private School
-- Messaging channel for that Applicant's active application. Conversations
-- without an application remain preserved for audit but are deactivated.
create temporary table applicant_dm_targets on commit drop as
with applicant_channels as (
  select distinct
    channel.id as source_channel_id,
    participant.user_id as applicant_id
  from public.chat_channels channel
  join public.chat_direct_participants participant
    on participant.channel_id = channel.id
  join public.profiles profile
    on profile.id = participant.user_id
   and profile.role = 'applicant'
  where channel.channel_type in ('direct_message', 'group_direct_message')
    and channel.active = true
)
select
  applicant_channel.source_channel_id,
  max(school_channel.id::text)::uuid as target_channel_id
from applicant_channels applicant_channel
left join public.applications application
  on application.applicant_user_id = applicant_channel.applicant_id
 and coalesce(application.is_archived, false) = false
left join public.chat_channels school_channel
  on school_channel.application_id = application.id
 and school_channel.channel_type = 'school_dm'
 and school_channel.active = true
group by applicant_channel.source_channel_id
having count(distinct applicant_channel.applicant_id) =
       count(distinct applicant_channel.applicant_id)
         filter (where school_channel.id is not null)
   and count(distinct school_channel.id) = 1;

-- Message identity is immutable during normal portal use. Suspend that guard
-- only inside this transaction for the one-time, owner-requested relocation.
drop trigger if exists chat_posts_protect_identity on public.chat_posts;
drop trigger if exists chat_replies_protect_identity on public.chat_replies;

update public.chat_posts post
set channel_id = target.target_channel_id
from applicant_dm_targets target
where post.channel_id = target.source_channel_id;

update public.chat_replies reply
set channel_id = target.target_channel_id
from applicant_dm_targets target
where reply.channel_id = target.source_channel_id;

update public.chat_attachments attachment
set channel_id = target.target_channel_id
from applicant_dm_targets target
where attachment.channel_id = target.source_channel_id;

update public.chat_reactions reaction
set channel_id = target.target_channel_id
from applicant_dm_targets target
where reaction.channel_id = target.source_channel_id;

create trigger chat_posts_protect_identity
before update on public.chat_posts
for each row execute function public.protect_chat_message_identity();

create trigger chat_replies_protect_identity
before update on public.chat_replies
for each row execute function public.protect_chat_message_identity();

update public.chat_channels school_channel
set updated_at = now()
from applicant_dm_targets target
where school_channel.id = target.target_channel_id;

update public.chat_channels direct_channel
set
  active = false,
  updated_at = now()
where direct_channel.channel_type in ('direct_message', 'group_direct_message')
  and exists (
    select 1
    from public.chat_direct_participants participant
    join public.profiles profile
      on profile.id = participant.user_id
     and profile.role = 'applicant'
    where participant.channel_id = direct_channel.id
  );

-- Applicants use School Messaging exclusively. They are omitted from the DM
-- directory, and no portal role can open a direct conversation with them.
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
   and contact.role <> 'applicant'
  where viewer.role <> 'applicant'
    and (
      viewer.role = 'owner'
      or exists (
        select 1
        from public.chat_channels channel
        where channel.active = true
          and channel.channel_type <> 'portal_updates'
          and public.can_access_chat_channel(channel.id, viewer.id)
          and public.can_access_chat_channel(channel.id, contact.id)
      )
    )
  order by
    case contact.role
      when 'owner' then 1
      when 'program_manager' then 2
      when 'advisory_member' then 3
      when 'adjudicator' then 4
      else 5
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
  other_user_role public.app_role;
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

  select profile.role
  into other_user_role
  from public.profiles profile
  where profile.id = p_other_user_id
    and profile.active = true;

  if current_user_role is null then
    raise exception 'Your portal account is not active.';
  end if;
  if other_user_role is null then
    raise exception 'The selected portal user is not active.';
  end if;
  if current_user_role = 'applicant' or other_user_role = 'applicant' then
    raise exception 'Applicant conversations must use the school channel.';
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
  ) values (
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

-- Return quoted-message metadata alongside each reply while continuing to
-- enforce membership before any channel content is exposed.
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
  post_deleted_at timestamptz,
  post_deleted_by uuid,
  post_deletion_reason text,
  reply_count bigint,
  replies jsonb
)
language plpgsql
stable
security definer
set search_path = ''
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
          'deletion_reason', reply.deletion_reason,
          'reply_to_message_id', coalesce(reply.reply_to_reply_id, reply.reply_to_post_id),
          'reply_to_message_kind', case
            when reply.reply_to_reply_id is not null then 'reply'
            when reply.reply_to_post_id is not null then 'post'
            else null
          end,
          'reply_to_author_name', case
            when reply.reply_to_reply_id is not null then
              coalesce(quoted_reply_author.full_name, quoted_reply_author.email, 'Portal user')
            when reply.reply_to_post_id is not null then
              coalesce(quoted_post_author.full_name, quoted_post_author.email, 'Portal user')
            else null
          end,
          'reply_to_body', case
            when reply.reply_to_reply_id is not null then
              case
                when quoted_reply.deleted_at is not null then 'Message removed by an Owner.'
                else quoted_reply.body
              end
            when reply.reply_to_post_id is not null then
              case
                when quoted_post.deleted_at is not null then 'Message removed by an Owner.'
                else quoted_post.body
              end
            else null
          end
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
  left join public.chat_posts quoted_post
    on quoted_post.id = reply.reply_to_post_id
  left join public.profiles quoted_post_author
    on quoted_post_author.id = quoted_post.author_id
  left join public.chat_replies quoted_reply
    on quoted_reply.id = reply.reply_to_reply_id
  left join public.profiles quoted_reply_author
    on quoted_reply_author.id = quoted_reply.author_id
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

revoke all on function public.get_chat_channel_threads(uuid)
from public, anon;
grant execute on function public.get_chat_channel_threads(uuid)
to authenticated;

commit;

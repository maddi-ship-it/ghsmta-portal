-- Consolidate the new message policies, cache auth lookups once per statement,
-- and keep Portal Updates Owner-only even if a former Owner authored a post.

begin;

drop policy if exists "community members create chat replies" on public.chat_replies;

drop policy if exists "channel members create chat posts" on public.chat_posts;
create policy "channel members create chat posts"
on public.chat_posts for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.can_access_chat_channel(channel_id, (select auth.uid()))
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = chat_posts.channel_id
        and channel.channel_type = 'portal_updates'
    )
    or (select public.current_user_role()) = 'owner'
  )
);

drop policy if exists "channel members create chat replies" on public.chat_replies;
create policy "channel members create chat replies"
on public.chat_replies for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.can_access_chat_channel(channel_id, (select auth.uid()))
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = chat_replies.channel_id
        and channel.channel_type = 'portal_updates'
    )
    or (select public.current_user_role()) = 'owner'
  )
  and exists (
    select 1
    from public.chat_posts post
    where post.id = chat_replies.post_id
      and post.channel_id = chat_replies.channel_id
      and post.locked = false
  )
);

drop policy if exists "channel members add attachments" on public.chat_attachments;
create policy "channel members add attachments"
on public.chat_attachments for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and public.can_access_chat_channel(channel_id, (select auth.uid()))
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = chat_attachments.channel_id
        and channel.channel_type = 'portal_updates'
    )
    or (select public.current_user_role()) = 'owner'
  )
);

drop policy if exists "channel members upload chat file objects" on storage.objects;
create policy "channel members upload chat file objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and public.can_access_chat_channel(
    ((storage.foldername(storage.objects.name))[2])::uuid,
    (select auth.uid())
  )
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = ((storage.foldername(storage.objects.name))[2])::uuid
        and channel.channel_type = 'portal_updates'
    )
    or (select public.current_user_role()) = 'owner'
  )
);

drop policy if exists "authors edit own chat posts" on public.chat_posts;
drop policy if exists "owners moderate chat posts" on public.chat_posts;
create policy "authors edit own or owners moderate chat posts"
on public.chat_posts for update to authenticated
using (
  (
    author_id = (select auth.uid())
    and deleted_at is null
    and public.can_access_chat_channel(channel_id, (select auth.uid()))
    and (
      not exists (
        select 1
        from public.chat_channels channel
        where channel.id = chat_posts.channel_id
          and channel.channel_type = 'portal_updates'
      )
      or (select public.current_user_role()) = 'owner'
    )
  )
  or (
    (select public.current_user_role()) = 'owner'
    and public.can_access_chat_channel(channel_id, (select auth.uid()))
  )
)
with check (
  (
    author_id = (select auth.uid())
    and deleted_at is null
    and public.can_access_chat_channel(channel_id, (select auth.uid()))
    and (
      not exists (
        select 1
        from public.chat_channels channel
        where channel.id = chat_posts.channel_id
          and channel.channel_type = 'portal_updates'
      )
      or (select public.current_user_role()) = 'owner'
    )
  )
  or (
    (select public.current_user_role()) = 'owner'
    and public.can_access_chat_channel(channel_id, (select auth.uid()))
  )
);

drop policy if exists "authors edit own chat replies" on public.chat_replies;
create policy "authors edit own chat replies"
on public.chat_replies for update to authenticated
using (
  author_id = (select auth.uid())
  and deleted_at is null
  and public.can_access_chat_channel(channel_id, (select auth.uid()))
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = chat_replies.channel_id
        and channel.channel_type = 'portal_updates'
    )
    or (select public.current_user_role()) = 'owner'
  )
)
with check (
  author_id = (select auth.uid())
  and deleted_at is null
  and public.can_access_chat_channel(channel_id, (select auth.uid()))
  and (
    not exists (
      select 1
      from public.chat_channels channel
      where channel.id = chat_replies.channel_id
        and channel.channel_type = 'portal_updates'
    )
    or (select public.current_user_role()) = 'owner'
  )
);

commit;

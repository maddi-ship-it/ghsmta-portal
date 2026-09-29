-- Qualify the reply row in the parent-post check so PostgreSQL cannot resolve
-- both sides of the comparison to the inner chat_posts row.

begin;

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
      where channel.id = chat_replies.channel_id
        and channel.channel_type = 'portal_updates'
    )
    or public.current_user_role() = 'owner'
  )
  and exists (
    select 1
    from public.chat_posts post
    where post.id = chat_replies.post_id
      and post.channel_id = chat_replies.channel_id
      and post.locked = false
  )
);

commit;

-- Qualify the outer storage object name so the Portal Updates guard cannot
-- resolve the inner chat channel's name instead of the uploaded object's path.

begin;

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

commit;

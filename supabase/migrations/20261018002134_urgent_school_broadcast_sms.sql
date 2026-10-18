begin;

alter table public.chat_urgent_sms_deliveries
  alter column channel_id drop not null;

alter table public.chat_urgent_sms_deliveries
  drop constraint if exists chat_urgent_sms_deliveries_message_kind_check;

alter table public.chat_urgent_sms_deliveries
  add constraint chat_urgent_sms_deliveries_message_kind_check
  check (message_kind in ('post', 'reply', 'broadcast'));

create or replace function public.broadcast_to_active_school_dms_with_receipt(
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_body text;
  broadcast_id uuid;
  inserted_count integer;
begin
  if (select public.current_user_role()) <> 'owner' then
    raise exception 'Only Owners can send a school-wide DM broadcast.';
  end if;

  normalized_body := trim(p_body);
  if normalized_body = '' then
    raise exception 'Enter a message before sending.';
  end if;

  if char_length(normalized_body) > 5000 then
    raise exception 'The broadcast message is longer than the allowed limit.';
  end if;

  insert into public.chat_broadcasts (body, sent_by)
  values (normalized_body, (select auth.uid()))
  returning id into broadcast_id;

  insert into public.chat_posts (
    channel_id,
    author_id,
    subject,
    body
  )
  select
    channel.id,
    (select auth.uid()),
    'Message',
    normalized_body
  from public.chat_channels channel
  join public.applications application
    on application.id = channel.application_id
  where channel.channel_type = 'school_dm'
    and channel.active = true
    and coalesce(application.is_archived, false) = false
    and exists (
      select 1
      from public.application_members member
      join public.profiles profile on profile.id = member.user_id
      where member.application_id = application.id
        and member.active = true
        and profile.active = true
        and profile.role = 'applicant'
    );

  get diagnostics inserted_count = row_count;

  update public.chat_broadcasts
  set channel_count = inserted_count
  where id = broadcast_id;

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    metadata
  ) values (
    'chat_broadcast',
    'School DM broadcast sent',
    normalized_body,
    (select auth.uid()),
    jsonb_build_object(
      'broadcast_id', broadcast_id,
      'channel_count', inserted_count
    )
  );

  return jsonb_build_object(
    'broadcast_id', broadcast_id,
    'channel_count', inserted_count
  );
end;
$$;

revoke all on function public.broadcast_to_active_school_dms_with_receipt(text)
from public, anon, authenticated;

grant execute on function public.broadcast_to_active_school_dms_with_receipt(text)
to authenticated;

comment on function public.broadcast_to_active_school_dms_with_receipt(text) is
  'Owner-only active-school chat broadcast returning an idempotency receipt for server-side notifications.';

commit;

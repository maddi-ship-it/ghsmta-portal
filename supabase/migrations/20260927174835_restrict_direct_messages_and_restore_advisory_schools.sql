-- Keep direct conversations private to their participants, including for Owners.
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
        (
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

drop policy if exists "direct chat participants read own channels"
on public.chat_direct_participants;
create policy "direct chat participants read own channels"
on public.chat_direct_participants for select to authenticated
using (
  user_id = auth.uid()
  or public.can_access_chat_channel(channel_id, auth.uid())
);

-- Direct participant changes go through the audited SECURITY DEFINER workflow.
drop policy if exists "owners create direct chat participants"
on public.chat_direct_participants;
drop policy if exists "owners delete direct chat participants"
on public.chat_direct_participants;
revoke insert, delete on public.chat_direct_participants from authenticated;

drop policy if exists "owners moderate chat posts" on public.chat_posts;
create policy "owners moderate chat posts"
on public.chat_posts for update to authenticated
using (
  public.current_user_role() = 'owner'
  and public.can_access_chat_channel(channel_id, auth.uid())
)
with check (
  public.current_user_role() = 'owner'
  and public.can_access_chat_channel(channel_id, auth.uid())
);

drop policy if exists "owners delete chat posts" on public.chat_posts;
create policy "owners delete chat posts"
on public.chat_posts for delete to authenticated
using (
  public.current_user_role() = 'owner'
  and public.can_access_chat_channel(channel_id, auth.uid())
);

drop policy if exists "owners delete chat replies" on public.chat_replies;
create policy "owners delete chat replies"
on public.chat_replies for delete to authenticated
using (
  public.current_user_role() = 'owner'
  and public.can_access_chat_channel(channel_id, auth.uid())
);

drop policy if exists "owners read chat moderation audit"
on public.chat_message_moderation_audit;
create policy "owners read chat moderation audit"
on public.chat_message_moderation_audit for select to authenticated
using (
  public.current_user_role() = 'owner'
  and public.can_access_chat_channel(channel_id, auth.uid())
);

create or replace function public.owner_soft_delete_chat_message(
  p_message_kind text,
  p_message_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_channel_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Owner access required.';
  end if;

  if p_message_kind = 'post' then
    select post.channel_id
    into target_channel_id
    from public.chat_posts post
    where post.id = p_message_id
      and post.deleted_at is null;
  elsif p_message_kind = 'reply' then
    select reply.channel_id
    into target_channel_id
    from public.chat_replies reply
    where reply.id = p_message_id
      and reply.deleted_at is null;
  else
    raise exception 'Unsupported chat message type.';
  end if;

  if target_channel_id is null then
    raise exception 'Chat message not found.';
  end if;
  if not public.can_access_chat_channel(target_channel_id, auth.uid()) then
    raise exception 'You do not have access to this conversation.';
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
  else
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
  end if;
end;
$$;

revoke all on function public.owner_soft_delete_chat_message(text, uuid, text)
from public, anon;
grant execute on function public.owner_soft_delete_chat_message(text, uuid, text)
to authenticated;

-- Advisory visibility follows the actual school assignment, including closed
-- but non-archived cycles such as the demo/application review cycle.
create or replace function public.get_advisory_review_application_ids()
returns table(application_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct application.id
  from public.applications application
  join public.award_cycles cycle
    on cycle.id = application.cycle_id
  where auth.uid() is not null
    and public.current_user_role() in ('advisory_member', 'owner')
    and application.is_archived = false
    and cycle.status <> 'archived'
    and public.can_advisory_review_application(application.id, auth.uid());
$$;

revoke all on function public.get_advisory_review_application_ids()
from public, anon;
grant execute on function public.get_advisory_review_application_ids()
to authenticated;

-- Assigned adjudicators retain read access to their approved final comments,
-- including after the adjudication package has been released.
drop policy if exists "assigned adjudicators read final comments"
on public.adjudication_panel_feedback;
create policy "assigned adjudicators read final comments"
on public.adjudication_panel_feedback for select to authenticated
using (
  status = 'approved'
  and assigned_to = (select auth.uid())
  and public.current_user_role() = 'adjudicator'
  and exists (
    select 1
    from public.adjudicator_assignments assignment
    where assignment.application_id = adjudication_panel_feedback.application_id
      and assignment.adjudicator_user_id = (select auth.uid())
      and assignment.can_comment = true
      and assignment.removed_at is null
  )
);

-- GHSMTA Portal: threaded Applicant Community, message-style staff/school
-- channels, and channel-aware @mention member lookup.
-- Run after migration 011.

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
      channel.id,
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

    -- Applicant Community includes applicants and adjudicators.
    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'applicant_community'
      and profile.active = true
      and profile.role in ('applicant', 'adjudicator')

    union

    -- General and Networking include adjudicators and advisory members.
    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type in ('general', 'networking')
      and profile.active = true
      and profile.role in ('adjudicator', 'advisory_member')

    union

    -- Advisory Committee includes advisory members.
    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'advisory_committee'
      and profile.active = true
      and profile.role = 'advisory_member'

    union

    -- School channel applicant.
    select application.applicant_user_id
    from selected_channel channel
    join public.applications application
      on application.id = channel.application_id
    where channel.channel_type = 'school'
      and application.applicant_user_id is not null

    union

    -- School channel assigned adjudicators.
    select assignment.adjudicator_user_id
    from selected_channel channel
    join public.adjudicator_assignments assignment
      on assignment.application_id = channel.application_id
    where channel.channel_type = 'school'
  )
  select
    profile.id,
    coalesce(
      nullif(trim(profile.full_name), ''),
      profile.email,
      'Portal user'
    ),
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

-- Replies are only valid in Applicant Community. All other channels use root
-- posts as standalone chronological messages.
drop policy if exists "channel members create chat replies"
on public.chat_replies;

create policy "community members create chat replies"
on public.chat_replies for insert to authenticated
with check (
  author_id = auth.uid()
  and public.can_access_chat_channel(channel_id, auth.uid())
  and exists (
    select 1
    from public.chat_channels channel
    join public.chat_posts post
      on post.channel_id = channel.id
     and post.id = post_id
    where channel.id = channel_id
      and channel.channel_type = 'applicant_community'
      and post.locked = false
  )
);

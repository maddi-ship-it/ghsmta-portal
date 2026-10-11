-- A completed adjudicator can no longer read the school's private scorecard
-- records directly. Owners and Advisory members keep historical review access.
drop policy if exists "adjudicators read own scorecards elevated read all"
on public.adjudication_scorecards;

create policy "adjudicators read own scorecards elevated read all"
on public.adjudication_scorecards for select to authenticated
using (
  public.current_user_role() in ('advisory_member', 'owner')
  or (
    adjudicator_user_id = auth.uid()
    and exists (
      select 1
      from public.adjudicator_assignments assignment
      where assignment.id = adjudication_scorecards.assignment_id
        and assignment.application_id = adjudication_scorecards.application_id
        and assignment.adjudicator_user_id = auth.uid()
        and assignment.removed_at is null
    )
  )
);

drop policy if exists "adjudicators read own scores elevated read all"
on public.adjudication_scores;

create policy "adjudicators read own scores elevated read all"
on public.adjudication_scores for select to authenticated
using (
  exists (
    select 1
    from public.adjudication_scorecards card
    where card.id = adjudication_scores.scorecard_id
      and (
        public.current_user_role() in ('advisory_member', 'owner')
        or (
          card.adjudicator_user_id = auth.uid()
          and exists (
            select 1
            from public.adjudicator_assignments assignment
            where assignment.id = card.assignment_id
              and assignment.application_id = card.application_id
              and assignment.adjudicator_user_id = auth.uid()
              and assignment.removed_at is null
          )
        )
      )
  )
);

drop policy if exists "adjudicators read own category comments elevated read all"
on public.adjudication_category_comments;

create policy "adjudicators read own category comments elevated read all"
on public.adjudication_category_comments for select to authenticated
using (
  exists (
    select 1
    from public.adjudication_scorecards card
    where card.id = adjudication_category_comments.scorecard_id
      and (
        public.current_user_role() in ('advisory_member', 'owner')
        or (
          card.adjudicator_user_id = auth.uid()
          and exists (
            select 1
            from public.adjudicator_assignments assignment
            where assignment.id = card.assignment_id
              and assignment.application_id = card.application_id
              and assignment.adjudicator_user_id = auth.uid()
              and assignment.removed_at is null
          )
        )
      )
  )
);

-- Historical schedule membership must not restore a completed adjudicator's
-- access to the private school channel.
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
          channel.channel_type in ('networking', 'scheduling')
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
          and not exists (
            select 1
            from public.adjudicator_assignments completed_assignment
            where completed_assignment.application_id = channel.application_id
              and completed_assignment.adjudicator_user_id = p_user_id
              and completed_assignment.status = 'complete'
              and completed_assignment.removed_at is not null
          )
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

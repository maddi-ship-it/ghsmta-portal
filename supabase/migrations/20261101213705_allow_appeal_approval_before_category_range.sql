begin;

create table if not exists public.appeal_advisory_votes (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references public.appeals(id) on delete cascade,
  advisory_member_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('approved', 'denied')),
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appeal_id, advisory_member_id)
);

alter table public.appeal_advisory_votes enable row level security;

grant select, insert, update on public.appeal_advisory_votes to authenticated;

drop policy if exists "appeal reviewers read advisory votes"
on public.appeal_advisory_votes;
create policy "appeal reviewers read advisory votes"
on public.appeal_advisory_votes for select to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'));

drop policy if exists "advisory members create own appeal votes"
on public.appeal_advisory_votes;
create policy "advisory members create own appeal votes"
on public.appeal_advisory_votes for insert to authenticated
with check (
  advisory_member_id = (select auth.uid())
  and public.current_user_role() = 'advisory_member'
);

drop policy if exists "advisory members update own appeal votes"
on public.appeal_advisory_votes;
create policy "advisory members update own appeal votes"
on public.appeal_advisory_votes for update to authenticated
using (
  advisory_member_id = (select auth.uid())
  and public.current_user_role() = 'advisory_member'
)
with check (
  advisory_member_id = (select auth.uid())
  and public.current_user_role() = 'advisory_member'
);

create or replace function public.submit_appeal_advisory_vote(
  p_appeal_id uuid,
  p_decision text
)
returns public.appeal_advisory_votes
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer_id uuid := auth.uid();
  reviewer_role public.app_role;
  selected_appeal public.appeals%rowtype;
  saved_vote public.appeal_advisory_votes%rowtype;
begin
  reviewer_role := public.current_user_role();

  if reviewer_id is null then
    raise exception 'Sign in before voting on an eligibility appeal.';
  end if;

  if reviewer_role <> 'advisory_member' then
    raise exception 'Advisory Committee access required.';
  end if;

  if p_decision not in ('approved', 'denied') then
    raise exception 'Choose Approve or Deny.';
  end if;

  select * into selected_appeal
  from public.appeals
  where id = p_appeal_id
    and appeal_type = 'eligibility'
  for update;

  if selected_appeal.id is null then
    raise exception 'Eligibility appeal not found.';
  end if;

  if selected_appeal.status in ('resolved', 'denied') then
    raise exception 'This eligibility appeal is already closed.';
  end if;

  insert into public.appeal_advisory_votes (
    appeal_id,
    advisory_member_id,
    decision,
    responded_at,
    updated_at
  ) values (
    p_appeal_id,
    reviewer_id,
    p_decision,
    now(),
    now()
  )
  on conflict (appeal_id, advisory_member_id)
  do update set
    decision = excluded.decision,
    responded_at = now(),
    updated_at = now()
  returning * into saved_vote;

  update public.appeals
  set status = case
    when status = 'submitted' then 'advisory_review'
    else status
  end
  where id = p_appeal_id;

  return saved_vote;
end;
$$;

revoke all on function public.submit_appeal_advisory_vote(uuid, text)
from public, anon;
grant execute on function public.submit_appeal_advisory_vote(uuid, text)
to authenticated;

-- Preserve the named approvals already recorded in Buford's legacy committee
-- notes. Future appeals use the structured vote workflow above.
insert into public.appeal_advisory_votes (
  appeal_id,
  advisory_member_id,
  decision,
  responded_at,
  created_at,
  updated_at
)
select
  appeal.id,
  profile.id,
  'approved',
  coalesce(appeal.updated_at, appeal.submitted_at, now()),
  coalesce(appeal.updated_at, appeal.submitted_at, now()),
  coalesce(appeal.updated_at, appeal.submitted_at, now())
from public.appeals appeal
join public.applications application
  on application.id = appeal.application_id
join public.scoring_categories category
  on category.id = appeal.category_id
join public.profiles profile
  on profile.full_name in (
    'Carmen Williams',
    'Christy Baggett',
    'Lauren Tully-Bampfield',
    'Stephen Hansen',
    'Sydney Frederiksen',
    'Tim Harris',
    'Timothy Ellis'
  )
where appeal.appeal_type = 'eligibility'
  and application.school_name = 'Buford High School'
  and upper(category.title) = 'MUSIC DIRECTION'
  and lower(coalesce(appeal.advisory_notes, '')) like '%vote for elig%'
on conflict (appeal_id, advisory_member_id) do nothing;

create or replace function public.review_eligibility_appeal(
  p_appeal_id uuid,
  p_status text,
  p_advisory_notes text,
  p_owner_notes text,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer_id uuid := auth.uid();
  reviewer_role public.app_role;
  selected_appeal public.appeals%rowtype;
  selected_application public.applications%rowtype;
  category_title_value text;
  decision_label text;
  panel_message text;
  notification_body text;
begin
  reviewer_role := public.current_user_role();

  if reviewer_id is null then
    raise exception 'Sign in before reviewing an eligibility appeal.';
  end if;

  if reviewer_role not in ('advisory_member', 'owner') then
    raise exception 'Advisory Committee or Owner access required.';
  end if;

  if p_status not in ('submitted', 'advisory_review', 'owner_review', 'resolved', 'denied') then
    raise exception 'Choose a valid eligibility appeal status.';
  end if;

  if reviewer_role <> 'owner' and p_status in ('resolved', 'denied') then
    raise exception 'Only an Owner can issue the final eligibility decision.';
  end if;

  select * into selected_appeal
  from public.appeals
  where id = p_appeal_id
    and appeal_type = 'eligibility'
  for update;

  if selected_appeal.id is null then
    raise exception 'Eligibility appeal not found.';
  end if;

  if selected_appeal.status in ('resolved', 'denied') then
    raise exception 'This eligibility appeal is already closed.';
  end if;

  if reviewer_role = 'owner'
    and p_status in ('resolved', 'denied')
    and nullif(trim(p_resolution), '') is null then
    raise exception 'A school-facing decision message is required.';
  end if;

  select * into selected_application
  from public.applications
  where id = selected_appeal.application_id;

  select category.title into category_title_value
  from public.scoring_categories category
  where category.id = selected_appeal.category_id;

  category_title_value := coalesce(nullif(trim(category_title_value), ''), 'Category');

  if reviewer_role = 'owner' and p_status = 'resolved' then
    if selected_appeal.category_id is null then
      raise exception 'The appeal category is missing.';
    end if;

    insert into public.adjudication_category_proposals (
      application_id,
      category_id,
      proposed_by,
      is_eligible,
      range_min,
      range_max,
      status,
      owner_override_note,
      approved_at,
      updated_at
    ) values (
      selected_appeal.application_id,
      selected_appeal.category_id,
      reviewer_id,
      true,
      null,
      null,
      'overridden',
      nullif(trim(p_resolution), ''),
      now(),
      now()
    )
    on conflict (application_id, category_id)
    do update set
      is_eligible = true,
      status = 'overridden',
      owner_override_note = excluded.owner_override_note,
      approved_at = now(),
      updated_at = now();
  end if;

  update public.appeals
  set
    status = p_status,
    advisory_notes = coalesce(
      advisory_notes,
      nullif(trim(p_advisory_notes), '')
    ),
    owner_notes = case
      when reviewer_role = 'owner' then nullif(trim(p_owner_notes), '')
      else owner_notes
    end,
    resolution = case
      when reviewer_role = 'owner' then nullif(trim(p_resolution), '')
      else resolution
    end,
    resolved_by = case
      when reviewer_role = 'owner' and p_status in ('resolved', 'denied')
        then reviewer_id
      else resolved_by
    end,
    resolved_at = case
      when reviewer_role = 'owner' and p_status in ('resolved', 'denied')
        then now()
      else resolved_at
    end,
    eligibility_applied_at = case
      when reviewer_role = 'owner' and p_status = 'resolved' then now()
      else eligibility_applied_at
    end,
    eligibility_applied_by = case
      when reviewer_role = 'owner' and p_status = 'resolved' then reviewer_id
      else eligibility_applied_by
    end
  where id = p_appeal_id;

  if reviewer_role = 'owner' and p_status in ('resolved', 'denied') then
    decision_label := case when p_status = 'resolved' then 'APPROVED' else 'DENIED' end;
    notification_body := category_title_value || ' appeal ' || lower(decision_label) ||
      ' for ' || selected_application.school_name || '.';
    panel_message := concat_ws(
      E'\n',
      'Eligibility appeal decision: ' || decision_label,
      '',
      selected_application.school_name || ' — ' ||
        coalesce(selected_application.production_title, 'Untitled production'),
      'Category: ' || category_title_value,
      '',
      case
        when p_status = 'resolved'
          then 'The appeal was approved. This category is now eligible for awards consideration.'
        else 'The appeal was denied. The existing category eligibility determination remains in place.'
      end,
      'The appeal is now closed.'
    );

    insert into public.chat_posts (
      channel_id,
      author_id,
      subject,
      body
    )
    select
      channel.id,
      reviewer_id,
      ('Eligibility appeal decision: ' || decision_label || ' — ' || category_title_value)::text,
      case
        when channel.channel_type = 'school_dm' then trim(p_resolution)
        else panel_message
      end
    from public.chat_channels channel
    where channel.active = true
      and (
        (
          channel.application_id = selected_appeal.application_id
          and channel.channel_type in ('school_dm', 'school')
        )
        or (
          channel.application_id is null
          and channel.channel_type = 'advisory_committee'
        )
      );

    update public.chat_channels channel
    set updated_at = now()
    where channel.active = true
      and (
        (
          channel.application_id = selected_appeal.application_id
          and channel.channel_type in ('school_dm', 'school')
        )
        or (
          channel.application_id is null
          and channel.channel_type = 'advisory_committee'
        )
      );

    insert into public.user_notifications (
      user_id,
      notification_type,
      title,
      body,
      href,
      related_application_id
    )
    select distinct
      school_recipient.user_id,
      'appeal_decision',
      'Eligibility appeal ' || lower(decision_label),
      notification_body,
      '/portal/appeals',
      selected_appeal.application_id
    from (
      select selected_appeal.submitted_by as user_id
      union
      select selected_application.applicant_user_id
      union
      select member.user_id
      from public.application_members member
      where member.application_id = selected_appeal.application_id
        and member.active = true
        and member.removed_at is null
    ) school_recipient
    where school_recipient.user_id is not null
      and school_recipient.user_id <> reviewer_id;

    insert into public.user_notifications (
      user_id,
      notification_type,
      title,
      body,
      href,
      related_application_id
    )
    select distinct
      panel_recipient.user_id,
      'appeal_decision',
      'Panel eligibility update',
      notification_body,
      '/portal/adjudication/' || selected_appeal.application_id::text,
      selected_appeal.application_id
    from (
      select assignment.adjudicator_user_id as user_id
      from public.adjudicator_assignments assignment
      where assignment.application_id = selected_appeal.application_id
        and assignment.removed_at is null

      union

      select staff.user_id
      from public.schedule_school_bookings booking
      join public.schedule_slot_staff staff on staff.slot_id = booking.slot_id
      where booking.application_id = selected_appeal.application_id
        and staff.joined_as in ('adjudicator', 'advisory_member')
    ) panel_recipient
    where panel_recipient.user_id is not null
      and panel_recipient.user_id <> reviewer_id;

    insert into public.owner_activity_log (
      activity_type,
      title,
      detail,
      actor_id,
      application_id,
      appeal_id,
      metadata
    ) values (
      'appeal_decision',
      'Eligibility appeal ' || lower(decision_label),
      selected_application.school_name || ' — ' || category_title_value,
      reviewer_id,
      selected_appeal.application_id,
      selected_appeal.id,
      jsonb_build_object(
        'decision', decision_label,
        'category_id', selected_appeal.category_id
      )
    );
  end if;
end;
$$;

revoke all on function public.review_eligibility_appeal(uuid, text, text, text, text)
from public, anon;
grant execute on function public.review_eligibility_appeal(uuid, text, text, text, text)
to authenticated;

commit;

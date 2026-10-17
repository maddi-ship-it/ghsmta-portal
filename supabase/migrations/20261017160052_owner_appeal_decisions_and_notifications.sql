begin;

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
  existing_proposal public.adjudication_category_proposals%rowtype;
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
    select * into existing_proposal
    from public.adjudication_category_proposals
    where application_id = selected_appeal.application_id
      and category_id = selected_appeal.category_id
    for update;

    if existing_proposal.id is null then
      raise exception 'The category must have an Advisory eligibility decision before an appeal can be approved.';
    end if;

    if existing_proposal.range_min is null or existing_proposal.range_max is null then
      raise exception 'Set the category two-point range before approving the eligibility appeal.';
    end if;

    update public.adjudication_category_proposals
    set
      is_eligible = true,
      status = 'overridden',
      owner_override_note = nullif(trim(p_resolution), ''),
      updated_at = now()
    where id = existing_proposal.id;
  end if;

  update public.appeals
  set
    status = p_status,
    advisory_notes = case
      when reviewer_role in ('advisory_member', 'owner')
        then nullif(trim(p_advisory_notes), '')
      else advisory_notes
    end,
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

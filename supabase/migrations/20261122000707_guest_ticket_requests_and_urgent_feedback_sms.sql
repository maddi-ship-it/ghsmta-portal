begin;

create table if not exists public.adjudication_guest_ticket_requests (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.schedule_slots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  needs_guest_ticket boolean not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, user_id)
);

create index if not exists adjudication_guest_ticket_requests_slot_idx
  on public.adjudication_guest_ticket_requests(slot_id, submitted_at);

drop trigger if exists adjudication_guest_ticket_requests_set_updated_at
on public.adjudication_guest_ticket_requests;
create trigger adjudication_guest_ticket_requests_set_updated_at
before update on public.adjudication_guest_ticket_requests
for each row execute function public.set_updated_at();

alter table public.adjudication_guest_ticket_requests enable row level security;
revoke all on table public.adjudication_guest_ticket_requests
from public, anon, authenticated;
grant all on table public.adjudication_guest_ticket_requests to service_role;

comment on table public.adjudication_guest_ticket_requests is
  'Server-managed guest-ticket responses for active adjudication panel assignments.';

create table if not exists public.adjudication_schedule_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.schedule_slots(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  notification_kind text not null check (
    notification_kind in (
      'visit_details_14_day',
      'guest_ticket_7_day',
      'guest_ticket_72_hour'
    )
  ),
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  post_id uuid references public.chat_posts(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, notification_kind)
);

create index if not exists adjudication_schedule_notifications_due_idx
  on public.adjudication_schedule_notification_deliveries(
    status,
    next_attempt_at,
    scheduled_for
  );

drop trigger if exists adjudication_schedule_notifications_set_updated_at
on public.adjudication_schedule_notification_deliveries;
create trigger adjudication_schedule_notifications_set_updated_at
before update on public.adjudication_schedule_notification_deliveries
for each row execute function public.set_updated_at();

alter table public.adjudication_schedule_notification_deliveries
  enable row level security;
revoke all on table public.adjudication_schedule_notification_deliveries
from public, anon, authenticated;
grant all on table public.adjudication_schedule_notification_deliveries
to service_role;

create or replace function public.claim_due_adjudication_schedule_notifications(
  p_claim_token uuid,
  p_limit integer default 50
)
returns setof public.adjudication_schedule_notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.adjudication_schedule_notification_deliveries (
    slot_id,
    application_id,
    notification_kind,
    scheduled_for
  )
  select
    slot.id,
    booking.application_id,
    due.notification_kind,
    due.scheduled_for
  from public.schedule_slots slot
  join public.schedule_school_bookings booking
    on booking.slot_id = slot.id
  left join public.schedule_slot_school_details details
    on details.slot_id = slot.id
  cross join lateral (
    values
      ('visit_details_14_day'::text, slot.starts_at - interval '14 days'),
      ('guest_ticket_7_day'::text, slot.starts_at - interval '7 days'),
      ('guest_ticket_72_hour'::text, slot.starts_at - interval '72 hours')
  ) as due(notification_kind, scheduled_for)
  where booking.approval_status = 'confirmed'
    and slot.status in ('open', 'closed')
    and slot.starts_at > now()
    and due.scheduled_for <= now()
    and (
      due.notification_kind <> 'visit_details_14_day'
      or nullif(trim(coalesce(details.venue_name, '')), '') is null
      or nullif(trim(coalesce(details.venue_address, '')), '') is null
      or nullif(trim(coalesce(details.arrival_entrance, '')), '') is null
      or nullif(trim(coalesce(details.parking_instructions, '')), '') is null
      or nullif(trim(coalesce(details.day_of_contact_name, '')), '') is null
      or nullif(trim(coalesce(details.day_of_contact_phone, '')), '') is null
    )
  on conflict (slot_id, notification_kind) do nothing;

  return query
  with claimable as (
    select delivery.id
    from public.adjudication_schedule_notification_deliveries delivery
    join public.schedule_slots slot on slot.id = delivery.slot_id
    where slot.starts_at > now()
      and delivery.next_attempt_at <= now()
      and (
        delivery.status in ('pending', 'failed')
        or (
          delivery.status = 'processing'
          and delivery.claimed_at < now() - interval '20 minutes'
        )
      )
    order by delivery.scheduled_for, delivery.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    for update of delivery skip locked
  )
  update public.adjudication_schedule_notification_deliveries delivery
  set
    status = 'processing',
    claim_token = p_claim_token,
    claimed_at = now(),
    attempt_count = delivery.attempt_count + 1,
    last_error = null
  from claimable
  where delivery.id = claimable.id
  returning delivery.*;
end;
$$;

revoke all on function public.claim_due_adjudication_schedule_notifications(
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.claim_due_adjudication_schedule_notifications(
  uuid,
  integer
) to service_role;

alter table public.chat_urgent_sms_deliveries
  drop constraint if exists chat_urgent_sms_deliveries_message_kind_check;

alter table public.chat_urgent_sms_deliveries
  add constraint chat_urgent_sms_deliveries_message_kind_check
  check (message_kind in ('post', 'reply', 'broadcast', 'feedback'));

-- Saving an unchanged Review All Categories draft must not demote an approved
-- proposal or erase its adjudicator approvals. The earlier draft helper always
-- wrote status=draft, which could silently clear a completed two-point range.
create or replace function public.save_adjudication_category_proposal_drafts(
  p_application_id uuid,
  p_decisions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.app_role;
  decision jsonb;
  selected_category_id uuid;
  selected_eligible boolean;
  selected_range_min numeric(4,2);
  selected_range_max numeric(4,2);
  selected_note text;
  selected_override_note text;
  existing_proposal public.adjudication_category_proposals%rowtype;
  saved_proposal_id uuid;
  content_changed boolean;
  next_status text;
  next_approved_at timestamptz;
  changed_count integer := 0;
begin
  actor_role := public.current_user_role();

  if actor_role not in ('advisory_member', 'owner') then
    raise exception 'Advisory Committee or Owner access required.';
  end if;

  if not exists (
    select 1
    from public.applications application
    where application.id = p_application_id
      and coalesce(application.is_archived, false) = false
  ) then
    raise exception 'The active application was not found.';
  end if;

  if not public.can_advisory_review_application(
    p_application_id,
    auth.uid()
  ) then
    raise exception 'You are not assigned to review this application.';
  end if;

  if coalesce(jsonb_typeof(p_decisions), 'null') <> 'array'
     or jsonb_array_length(p_decisions) = 0 then
    raise exception 'No category decisions were submitted.';
  end if;

  for decision in select value from jsonb_array_elements(p_decisions)
  loop
    begin
      selected_category_id := (decision ->> 'category_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'A category decision contains an invalid category ID.';
    end;

    if not exists (
      select 1
      from public.applications application
      join public.application_form_versions form_version
        on form_version.id = application.form_version_id
      join public.scoring_categories category
        on category.rubric_id = form_version.scoring_rubric_id
      where application.id = p_application_id
        and category.id = selected_category_id
        and category.active = true
    ) then
      raise exception 'A submitted category does not belong to this application rubric.';
    end if;

    selected_eligible := coalesce((decision ->> 'is_eligible')::boolean, false);
    selected_note := nullif(trim(decision ->> 'advisory_note'), '');
    selected_override_note := case
      when actor_role = 'owner'
        then nullif(trim(decision ->> 'owner_override_note'), '')
      else null
    end;
    selected_range_min := nullif(decision ->> 'range_min', '')::numeric;
    selected_range_max := nullif(decision ->> 'range_max', '')::numeric;

    if (selected_range_min is null) <> (selected_range_max is null)
       or (
         selected_range_min is not null
         and (
           selected_range_min < 1
           or selected_range_max > 10
           or selected_range_max - selected_range_min <> 2.00
         )
       ) then
      raise exception 'A saved draft range must be a valid two-point range.';
    end if;

    select * into existing_proposal
    from public.adjudication_category_proposals
    where application_id = p_application_id
      and category_id = selected_category_id
    for update;

    if existing_proposal.id is not null
       and existing_proposal.status = 'overridden'
       and actor_role <> 'owner' then
      continue;
    end if;

    content_changed := existing_proposal.id is null
      or existing_proposal.is_eligible is distinct from selected_eligible
      or existing_proposal.range_min is distinct from selected_range_min
      or existing_proposal.range_max is distinct from selected_range_max
      or existing_proposal.advisory_note is distinct from selected_note
      or (
        actor_role = 'owner'
        and existing_proposal.owner_override_note
          is distinct from selected_override_note
      );

    next_status := case
      when existing_proposal.id is not null and not content_changed
        then existing_proposal.status
      else 'draft'
    end;
    next_approved_at := case
      when existing_proposal.id is not null and not content_changed
        then existing_proposal.approved_at
      else null
    end;

    insert into public.adjudication_category_proposals (
      application_id,
      category_id,
      proposed_by,
      is_eligible,
      range_min,
      range_max,
      status,
      advisory_note,
      owner_override_note,
      approved_at
    ) values (
      p_application_id,
      selected_category_id,
      auth.uid(),
      selected_eligible,
      selected_range_min,
      selected_range_max,
      next_status,
      selected_note,
      selected_override_note,
      next_approved_at
    )
    on conflict (application_id, category_id) do update set
      proposed_by = excluded.proposed_by,
      is_eligible = excluded.is_eligible,
      range_min = excluded.range_min,
      range_max = excluded.range_max,
      status = excluded.status,
      advisory_note = excluded.advisory_note,
      owner_override_note = excluded.owner_override_note,
      approved_at = excluded.approved_at,
      updated_at = now()
    returning id into saved_proposal_id;

    if content_changed then
      delete from public.adjudication_category_approvals
      where proposal_id = saved_proposal_id;
      changed_count := changed_count + 1;
    end if;
  end loop;

  return changed_count;
end;
$$;

revoke execute on function public.save_adjudication_category_proposal_drafts(
  uuid,
  jsonb
) from public, anon;

grant execute on function public.save_adjudication_category_proposal_drafts(
  uuid,
  jsonb
) to authenticated;

commit;

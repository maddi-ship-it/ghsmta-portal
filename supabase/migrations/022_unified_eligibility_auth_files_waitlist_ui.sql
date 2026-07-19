-- GHSMTA Portal unified rollout:
-- account/contact security, eligibility-only appeals, typed school files,
-- per-timeslot waitlists, feedback statuses, and MFA rollout metadata.
-- Run after migration 021.

-- ---------------------------------------------------------------------------
-- Account details, verified phone, and MFA rollout metadata
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists preferred_name text,
  add column if not exists phone_e164 text,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists phone_required_at timestamptz,
  add column if not exists pronouns text,
  add column if not exists organization text,
  add column if not exists notification_preferences jsonb not null default '{"email":true,"sms":false,"in_app":true}'::jsonb,
  add column if not exists mfa_required boolean not null default false,
  add column if not exists mfa_grace_until timestamptz;

update public.profiles
set
  mfa_required = true,
  mfa_grace_until = coalesce(mfa_grace_until, now() + interval '14 days')
where role in ('owner', 'advisory_member');

create or replace function public.apply_profile_security_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.phone_e164 is not null and new.phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Phone numbers must use international E.164 format.';
  end if;

  if new.role in ('owner', 'advisory_member') then
    new.mfa_required := true;
    new.mfa_grace_until := coalesce(new.mfa_grace_until, now() + interval '14 days');
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_apply_security_defaults on public.profiles;
create trigger profiles_apply_security_defaults
before insert or update of role, phone_e164, mfa_required, mfa_grace_until
on public.profiles
for each row execute function public.apply_profile_security_defaults();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplied_phone text;
begin
  supplied_phone := nullif(trim(new.raw_user_meta_data ->> 'phone_e164'), '');

  insert into public.profiles (
    id,
    email,
    full_name,
    preferred_name,
    phone_e164,
    phone_required_at,
    role
  ) values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'preferred_name', ''),
    supplied_phone,
    case
      when coalesce((new.raw_user_meta_data ->> 'require_phone_verification')::boolean, false)
        then now()
      else null
    end,
    'applicant'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    preferred_name = coalesce(excluded.preferred_name, public.profiles.preferred_name),
    phone_e164 = coalesce(excluded.phone_e164, public.profiles.phone_e164),
    phone_required_at = coalesce(excluded.phone_required_at, public.profiles.phone_required_at);

  return new;
end;
$$;

create or replace function public.update_my_account_profile(
  p_full_name text,
  p_preferred_name text,
  p_phone_e164 text,
  p_pronouns text,
  p_organization text,
  p_notification_preferences jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text;
  prior_phone text;
begin
  normalized_phone := nullif(regexp_replace(trim(coalesce(p_phone_e164, '')), '[^0-9+]', '', 'g'), '');

  if normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter a valid mobile number in international format, such as +14045551234.';
  end if;

  select phone_e164 into prior_phone
  from public.profiles
  where id = auth.uid();

  update public.profiles
  set
    full_name = nullif(trim(p_full_name), ''),
    preferred_name = nullif(trim(p_preferred_name), ''),
    phone_e164 = normalized_phone,
    pronouns = nullif(trim(p_pronouns), ''),
    organization = nullif(trim(p_organization), ''),
    notification_preferences = coalesce(p_notification_preferences, notification_preferences),
    phone_verified_at = case
      when prior_phone is distinct from normalized_phone then null
      else phone_verified_at
    end,
    phone_required_at = case
      when prior_phone is distinct from normalized_phone then now()
      else phone_required_at
    end
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

grant execute on function public.update_my_account_profile(text, text, text, text, text, jsonb)
to authenticated;

create or replace function public.sync_my_verified_phone(p_phone_e164 text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_phone text;
begin
  normalized_phone := nullif(regexp_replace(trim(coalesce(p_phone_e164, '')), '[^0-9+]', '', 'g'), '');

  if not exists (
    select 1
    from auth.users auth_user
    where auth_user.id = auth.uid()
      and auth_user.phone = normalized_phone
      and auth_user.phone_confirmed_at is not null
  ) then
    raise exception 'The phone number has not been verified with the authentication provider.';
  end if;

  update public.profiles
  set
    phone_e164 = normalized_phone,
    phone_verified_at = now(),
    phone_required_at = null
  where id = auth.uid();
end;
$$;

grant execute on function public.sync_my_verified_phone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Consolidated Advisory category-decision save
-- ---------------------------------------------------------------------------

create or replace function public.save_all_adjudication_category_proposals(
  p_application_id uuid,
  p_decisions jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.app_role;
  decision jsonb;
  selected_category_id uuid;
  selected_eligible boolean;
  selected_range_min numeric(4,2);
  selected_range_max numeric(4,2);
  selected_note text;
  selected_override boolean;
  selected_override_note text;
  existing_proposal public.adjudication_category_proposals%rowtype;
  saved_proposal_id uuid;
  decision_changed boolean;
  next_status text;
  changed_count integer := 0;
begin
  actor_role := public.current_user_role();

  if actor_role not in ('advisory_member', 'owner') then
    raise exception 'Advisory Committee or Owner access required.';
  end if;

  if not exists (
    select 1
    from public.applications application
    join public.award_cycles cycle on cycle.id = application.cycle_id
    where application.id = p_application_id
      and coalesce(application.is_archived, false) = false
      and cycle.is_active = true
      and cycle.status <> 'archived'
  ) then
    raise exception 'The active application was not found.';
  end if;

  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
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
      join public.scoring_rubrics rubric on rubric.cycle_id = application.cycle_id
      join public.scoring_categories category on category.rubric_id = rubric.id
      where application.id = p_application_id
        and category.id = selected_category_id
        and category.active = true
    ) then
      raise exception 'A submitted category does not belong to this application rubric.';
    end if;

    selected_eligible := coalesce((decision ->> 'is_eligible')::boolean, false);
    selected_note := nullif(trim(decision ->> 'advisory_note'), '');
    selected_override := actor_role = 'owner'
      and coalesce((decision ->> 'owner_override')::boolean, false);
    selected_override_note := case
      when actor_role = 'owner' then nullif(trim(decision ->> 'owner_override_note'), '')
      else null
    end;

    if selected_eligible then
      selected_range_min := nullif(decision ->> 'range_min', '')::numeric;
      selected_range_max := nullif(decision ->> 'range_max', '')::numeric;

      if selected_range_min is null
         or selected_range_max is null
         or selected_range_min < 1
         or selected_range_max > 10
         or selected_range_max - selected_range_min <> 2.00 then
        raise exception 'Every eligible category needs a valid two-point range.';
      end if;
    else
      selected_range_min := null;
      selected_range_max := null;
    end if;

    if selected_override and selected_override_note is null then
      raise exception 'Every Owner override needs an override note.';
    end if;

    select * into existing_proposal
    from public.adjudication_category_proposals
    where application_id = p_application_id
      and category_id = selected_category_id
    for update;

    -- Advisory members cannot silently replace an Owner's override.
    if existing_proposal.id is not null
       and existing_proposal.status = 'overridden'
       and actor_role <> 'owner' then
      continue;
    end if;

    decision_changed := existing_proposal.id is null
      or existing_proposal.is_eligible is distinct from selected_eligible
      or existing_proposal.range_min is distinct from selected_range_min
      or existing_proposal.range_max is distinct from selected_range_max
      or existing_proposal.advisory_note is distinct from selected_note
      or (
        actor_role = 'owner'
        and existing_proposal.owner_override_note is distinct from selected_override_note
      )
      or (selected_override and existing_proposal.status <> 'overridden')
      or (not selected_override and existing_proposal.status = 'overridden');

    next_status := case
      when selected_override then 'overridden'
      when existing_proposal.id is not null and not decision_changed then existing_proposal.status
      else 'proposed'
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
      case when actor_role = 'owner' then selected_override_note else null end,
      case when next_status = 'approved' then existing_proposal.approved_at else null end
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

    if decision_changed then
      delete from public.adjudication_category_approvals
      where proposal_id = saved_proposal_id;
      changed_count := changed_count + 1;
    end if;
  end loop;

  if changed_count > 0 then
    insert into public.user_notifications (
      user_id,
      notification_type,
      title,
      body,
      href,
      related_application_id
    )
    select distinct
      assignment.adjudicator_user_id,
      'category_approval_required',
      'Category decisions ready for review',
      changed_count::text || ' eligibility or two-point range decision' ||
        case when changed_count = 1 then '' else 's' end || ' updated.',
      '/portal/adjudication/' || p_application_id::text,
      p_application_id
    from public.adjudicator_assignments assignment
    where assignment.application_id = p_application_id
      and assignment.can_score = true
      and assignment.removed_at is null;
  end if;

  return changed_count;
end;
$$;

grant execute on function public.save_all_adjudication_category_proposals(uuid, jsonb)
to authenticated;

-- ---------------------------------------------------------------------------
-- Eligibility-only appeals
-- ---------------------------------------------------------------------------

alter table public.appeals
  add column if not exists current_eligibility boolean,
  add column if not exists requested_eligibility boolean not null default true,
  add column if not exists school_contact_name text,
  add column if not exists school_contact_email text,
  add column if not exists school_contact_phone text,
  add column if not exists certification_accepted boolean not null default false,
  add column if not exists eligibility_applied_at timestamptz,
  add column if not exists eligibility_applied_by uuid references public.profiles(id) on delete set null;

-- New appeals are eligibility-only. Historical appeal records retain their
-- original type so the Owner archive remains an accurate record.
alter table public.appeals
  alter column appeal_type set default 'eligibility';

create or replace function public.submit_eligibility_appeal(
  p_application_id uuid,
  p_category_id uuid,
  p_explanation text,
  p_current_eligibility boolean,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_certification_accepted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  if not public.is_application_member(p_application_id, auth.uid()) then
    raise exception 'You do not have access to this application.';
  end if;

  if p_category_id is null then
    raise exception 'Choose the category eligibility determination being appealed.';
  end if;

  if char_length(trim(coalesce(p_explanation, ''))) < 10 then
    raise exception 'Enter a complete explanation for the eligibility appeal.';
  end if;

  if not p_certification_accepted then
    raise exception 'The school certification must be accepted.';
  end if;

  insert into public.appeals (
    application_id,
    submitted_by,
    category_id,
    appeal_type,
    explanation,
    status,
    current_eligibility,
    requested_eligibility,
    school_contact_name,
    school_contact_email,
    school_contact_phone,
    certification_accepted
  ) values (
    p_application_id,
    auth.uid(),
    p_category_id,
    'eligibility',
    trim(p_explanation),
    'submitted',
    p_current_eligibility,
    true,
    nullif(trim(p_contact_name), ''),
    nullif(trim(p_contact_email), ''),
    nullif(trim(p_contact_phone), ''),
    true
  )
  returning id into result_id;

  return result_id;
end;
$$;

grant execute on function public.submit_eligibility_appeal(uuid, uuid, text, boolean, text, text, text, boolean)
to authenticated;

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
set search_path = public
as $$
declare
  reviewer_role public.app_role;
  selected_appeal public.appeals%rowtype;
  existing_proposal public.adjudication_category_proposals%rowtype;
begin
  reviewer_role := public.current_user_role();

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
  for update;

  if selected_appeal.id is null then
    raise exception 'Eligibility appeal not found.';
  end if;

  update public.appeals
  set
    status = p_status,
    advisory_notes = case
      when reviewer_role in ('advisory_member', 'owner') then nullif(trim(p_advisory_notes), '')
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
      when reviewer_role = 'owner' and p_status in ('resolved', 'denied') then auth.uid()
      else resolved_by
    end,
    resolved_at = case
      when reviewer_role = 'owner' and p_status in ('resolved', 'denied') then now()
      else resolved_at
    end,
    eligibility_applied_at = case
      when reviewer_role = 'owner' and p_status = 'resolved' then now()
      else eligibility_applied_at
    end,
    eligibility_applied_by = case
      when reviewer_role = 'owner' and p_status = 'resolved' then auth.uid()
      else eligibility_applied_by
    end
  where id = p_appeal_id;

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
      owner_override_note = coalesce(
        nullif(trim(p_resolution), ''),
        'Eligibility appeal approved by an Owner.'
      ),
      updated_at = now()
    where id = existing_proposal.id;
  end if;
end;
$$;

grant execute on function public.review_eligibility_appeal(uuid, text, text, text, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Typed school-file metadata
-- ---------------------------------------------------------------------------

alter table public.portal_files
  add column if not exists display_name text,
  add column if not exists person_name text,
  add column if not exists award_category text,
  add column if not exists role_or_character text,
  add column if not exists designer_name text,
  add column if not exists phonetic_spelling text,
  add column if not exists file_notes text,
  add column if not exists production_name text;

create index if not exists portal_files_category_person_idx
  on public.portal_files(application_id, document_category, person_name, created_at desc)
  where context_type = 'application' and archived_at is null;

-- ---------------------------------------------------------------------------
-- Per-timeslot schedule waitlists
-- ---------------------------------------------------------------------------

create table if not exists public.schedule_slot_waitlist (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.schedule_slots(id) on delete cascade,
  cycle_id uuid not null references public.award_cycles(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  status text not null default 'waiting' check (
    status in ('waiting', 'offered', 'accepted', 'declined', 'removed', 'expired')
  ),
  queue_rank integer not null,
  offer_expires_at timestamptz,
  offered_by uuid references public.profiles(id) on delete set null,
  applicant_notes text,
  owner_notes text,
  joined_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists schedule_slot_waitlist_active_unique
  on public.schedule_slot_waitlist(application_id, slot_id)
  where status in ('waiting', 'offered');

create index if not exists schedule_slot_waitlist_queue_idx
  on public.schedule_slot_waitlist(slot_id, status, queue_rank, created_at);

drop trigger if exists schedule_slot_waitlist_set_updated_at on public.schedule_slot_waitlist;
create trigger schedule_slot_waitlist_set_updated_at
before update on public.schedule_slot_waitlist
for each row execute function public.set_updated_at();

alter table public.schedule_slot_waitlist enable row level security;
grant select on public.schedule_slot_waitlist to authenticated;

drop policy if exists "slot waitlist owners and school teams read"
on public.schedule_slot_waitlist;
create policy "slot waitlist owners and school teams read"
on public.schedule_slot_waitlist for select to authenticated
using (
  public.current_user_role() = 'owner'
  or public.is_application_member(application_id, auth.uid())
);

-- Retire active date-based entries so they no longer appear operationally.
update public.schedule_date_waitlist
set status = 'expired', updated_at = now()
where status in ('waiting', 'offered');

create or replace function public.join_schedule_slot_waitlist(
  p_application_id uuid,
  p_slot_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_application public.applications%rowtype;
  selected_slot public.schedule_slots%rowtype;
  next_rank integer;
  result_id uuid;
begin
  if not public.is_application_member(p_application_id, auth.uid()) then
    raise exception 'You do not have access to this application.';
  end if;

  select * into selected_application
  from public.applications
  where id = p_application_id
    and coalesce(is_archived, false) = false;

  select * into selected_slot
  from public.schedule_slots
  where id = p_slot_id
  for update;

  if selected_application.id is null or selected_slot.id is null then
    raise exception 'Application or schedule slot not found.';
  end if;

  if selected_application.cycle_id <> selected_slot.cycle_id then
    raise exception 'This slot belongs to a different program.';
  end if;

  if selected_slot.status <> 'open' or selected_slot.starts_at <= now() then
    raise exception 'This timeslot is not eligible for a waitlist.';
  end if;

  if exists (
    select 1 from public.schedule_school_bookings booking
    where public.is_application_member(booking.application_id, auth.uid())
  ) then
    raise exception 'Your school already has a schedule reservation.';
  end if;

  if not exists (
    select 1 from public.schedule_school_bookings booking
    where booking.slot_id = p_slot_id
  ) and not exists (
    select 1 from public.schedule_slot_waitlist waitlist
    where waitlist.slot_id = p_slot_id
      and waitlist.status = 'offered'
      and waitlist.offer_expires_at > now()
  ) then
    raise exception 'This timeslot is open now. Reserve it instead of joining the waitlist.';
  end if;

  select coalesce(max(queue_rank), 0) + 1
  into next_rank
  from public.schedule_slot_waitlist
  where slot_id = p_slot_id;

  insert into public.schedule_slot_waitlist (
    slot_id,
    cycle_id,
    application_id,
    status,
    queue_rank,
    applicant_notes,
    joined_by
  ) values (
    p_slot_id,
    selected_slot.cycle_id,
    p_application_id,
    'waiting',
    next_rank,
    nullif(trim(p_notes), ''),
    auth.uid()
  )
  on conflict (application_id, slot_id)
  where status in ('waiting', 'offered')
  do update set
    applicant_notes = excluded.applicant_notes,
    status = 'waiting',
    offer_expires_at = null,
    offered_by = null,
    updated_at = now()
  returning id into result_id;

  return result_id;
end;
$$;

grant execute on function public.join_schedule_slot_waitlist(uuid, uuid, text)
to authenticated;

create or replace function public.offer_next_schedule_slot_waitlist(
  p_slot_id uuid,
  p_expires_minutes integer default 15,
  p_offered_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_entry public.schedule_slot_waitlist%rowtype;
  actor_id uuid;
  school_dm_id uuid;
  slot_label text;
begin
  perform 1 from public.schedule_slots where id = p_slot_id for update;

  update public.schedule_slot_waitlist
  set status = 'expired', updated_at = now()
  where slot_id = p_slot_id
    and status = 'offered'
    and offer_expires_at <= now();

  if exists (
    select 1 from public.schedule_school_bookings booking
    where booking.slot_id = p_slot_id
  ) then
    return null;
  end if;

  select * into selected_entry
  from public.schedule_slot_waitlist
  where slot_id = p_slot_id
    and status = 'offered'
    and offer_expires_at > now()
  order by offer_expires_at desc
  limit 1;

  if selected_entry.id is not null then
    return selected_entry.id;
  end if;

  select * into selected_entry
  from public.schedule_slot_waitlist
  where slot_id = p_slot_id
    and status = 'waiting'
  order by queue_rank, created_at
  for update skip locked
  limit 1;

  if selected_entry.id is null then
    return null;
  end if;

  actor_id := coalesce(
    p_offered_by,
    auth.uid(),
    (select id from public.profiles where role = 'owner' and active = true order by created_at limit 1)
  );

  update public.schedule_slot_waitlist
  set
    status = 'offered',
    offer_expires_at = now() + make_interval(mins => greatest(5, least(p_expires_minutes, 1440))),
    offered_by = actor_id,
    updated_at = now()
  where id = selected_entry.id;

  select slot.title || ' · ' || to_char(slot.starts_at at time zone 'America/New_York', 'Mon DD, YYYY FMHH12:MI AM')
  into slot_label
  from public.schedule_slots slot
  where slot.id = p_slot_id;

  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href,
    related_application_id
  )
  select distinct member_user_id, 'schedule_slot_waitlist_offer',
    'Your waitlisted timeslot is available',
    coalesce(slot_label, 'A GHSMTA timeslot') || ' is being held for your school for 15 minutes.',
    '/portal/schedule',
    selected_entry.application_id
  from (
    select member.user_id as member_user_id
    from public.application_members member
    where member.application_id = selected_entry.application_id
      and member.active = true
    union
    select application.applicant_user_id
    from public.applications application
    where application.id = selected_entry.application_id
      and application.applicant_user_id is not null
  ) recipients
  where member_user_id is not null;

  select channel.id into school_dm_id
  from public.chat_channels channel
  where channel.application_id = selected_entry.application_id
    and channel.channel_type = 'school_dm'
    and channel.active = true
  limit 1;

  if school_dm_id is not null and actor_id is not null then
    insert into public.chat_posts(channel_id, author_id, subject, body)
    values (
      school_dm_id,
      actor_id,
      'Waitlisted timeslot available',
      coalesce(slot_label, 'A GHSMTA timeslot') ||
      ' is being held for your school. Open Scheduling to accept or decline before the offer expires.'
    );
  end if;

  return selected_entry.id;
end;
$$;

revoke all on function public.offer_next_schedule_slot_waitlist(uuid, integer, uuid) from public;

create or replace function public.owner_offer_next_schedule_slot_waitlist(
  p_slot_id uuid,
  p_expires_minutes integer default 15
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Owner access required.';
  end if;

  return public.offer_next_schedule_slot_waitlist(
    p_slot_id,
    p_expires_minutes,
    auth.uid()
  );
end;
$$;

grant execute on function public.owner_offer_next_schedule_slot_waitlist(uuid, integer)
to authenticated;

create or replace function public.leave_schedule_slot_waitlist(p_waitlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_entry public.schedule_slot_waitlist%rowtype;
begin
  select * into selected_entry
  from public.schedule_slot_waitlist
  where id = p_waitlist_id
  for update;

  if selected_entry.id is null
     or not public.is_application_member(selected_entry.application_id, auth.uid())
     or selected_entry.status not in ('waiting', 'offered') then
    raise exception 'Waitlist entry not found or cannot be removed.';
  end if;

  update public.schedule_slot_waitlist
  set status = 'removed', updated_at = now()
  where id = p_waitlist_id;

  if selected_entry.status = 'offered' then
    perform public.offer_next_schedule_slot_waitlist(selected_entry.slot_id, 15, null);
  end if;
end;
$$;

grant execute on function public.leave_schedule_slot_waitlist(uuid) to authenticated;

create or replace function public.accept_schedule_slot_waitlist_offer(p_waitlist_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_entry public.schedule_slot_waitlist%rowtype;
  selected_slot public.schedule_slots%rowtype;
  booking_id uuid;
begin
  select * into selected_entry
  from public.schedule_slot_waitlist
  where id = p_waitlist_id
  for update;

  if selected_entry.id is null
     or not public.is_application_member(selected_entry.application_id, auth.uid()) then
    raise exception 'Waitlist offer not found.';
  end if;

  if selected_entry.status <> 'offered' then
    raise exception 'This waitlist entry does not have an active offer.';
  end if;

  if selected_entry.offer_expires_at is null or selected_entry.offer_expires_at <= now() then
    update public.schedule_slot_waitlist
    set status = 'expired', updated_at = now()
    where id = p_waitlist_id;
    perform public.offer_next_schedule_slot_waitlist(selected_entry.slot_id, 15, null);
    return null;
  end if;

  select * into selected_slot
  from public.schedule_slots
  where id = selected_entry.slot_id
  for update;

  if exists (
    select 1 from public.schedule_school_bookings booking
    where booking.slot_id = selected_entry.slot_id
  ) then
    raise exception 'The timeslot is no longer available.';
  end if;

  insert into public.schedule_school_bookings(slot_id, application_id, booked_by)
  values (selected_entry.slot_id, selected_entry.application_id, auth.uid())
  returning id into booking_id;

  update public.schedule_slot_waitlist
  set status = 'accepted', updated_at = now()
  where id = p_waitlist_id;

  update public.schedule_slot_waitlist
  set status = 'removed', updated_at = now()
  where application_id = selected_entry.application_id
    and id <> p_waitlist_id
    and status in ('waiting', 'offered');

  return booking_id;
exception
  when unique_violation then
    raise exception 'The school or timeslot already has a reservation.';
end;
$$;

grant execute on function public.accept_schedule_slot_waitlist_offer(uuid)
to authenticated;

create or replace function public.decline_schedule_slot_waitlist_offer(p_waitlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_entry public.schedule_slot_waitlist%rowtype;
begin
  select * into selected_entry
  from public.schedule_slot_waitlist
  where id = p_waitlist_id
  for update;

  if selected_entry.id is null
     or not public.is_application_member(selected_entry.application_id, auth.uid())
     or selected_entry.status <> 'offered' then
    raise exception 'Waitlist offer not found.';
  end if;

  update public.schedule_slot_waitlist
  set status = 'declined', updated_at = now()
  where id = p_waitlist_id;

  perform public.offer_next_schedule_slot_waitlist(selected_entry.slot_id, 15, null);
end;
$$;

grant execute on function public.decline_schedule_slot_waitlist_offer(uuid)
to authenticated;

create or replace function public.get_schedule_slot_waitlist_summary()
returns table (
  slot_id uuid,
  waitlist_count bigint,
  my_waitlist_id uuid,
  my_waitlist_status text,
  my_offer_expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    slot.id as slot_id,
    count(waitlist.id) filter (
      where waitlist.status in ('waiting', 'offered')
    ) as waitlist_count,
    my_waitlist.id as my_waitlist_id,
    my_waitlist.status as my_waitlist_status,
    my_waitlist.offer_expires_at as my_offer_expires_at
  from public.schedule_slots slot
  left join public.schedule_slot_waitlist waitlist
    on waitlist.slot_id = slot.id
  left join lateral (
    select
      candidate.id,
      candidate.status,
      candidate.offer_expires_at
    from public.schedule_slot_waitlist candidate
    where candidate.slot_id = slot.id
      and public.is_application_member(candidate.application_id, auth.uid())
      and candidate.status in ('waiting', 'offered')
    order by
      case when candidate.status = 'offered' then 0 else 1 end,
      candidate.updated_at desc,
      candidate.created_at desc
    limit 1
  ) my_waitlist on true
  group by
    slot.id,
    my_waitlist.id,
    my_waitlist.status,
    my_waitlist.offer_expires_at;
$$;

grant execute on function public.get_schedule_slot_waitlist_summary()
to authenticated;

create or replace function public.schedule_booking_offer_next_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.offer_next_schedule_slot_waitlist(old.slot_id, 15, null);
  return old;
end;
$$;

revoke all on function public.schedule_booking_offer_next_waitlist() from public;

drop trigger if exists schedule_booking_offer_next_waitlist
on public.schedule_school_bookings;
create trigger schedule_booking_offer_next_waitlist
after delete on public.schedule_school_bookings
for each row execute function public.schedule_booking_offer_next_waitlist();

-- Replace the school-booking function so an active waitlist offer reserves the
-- slot from the public booking race while still retaining row-level locking.
create or replace function public.book_schedule_slot(
  p_slot_id uuid,
  p_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_slot public.schedule_slots%rowtype;
  selected_application public.applications%rowtype;
  active_offer public.schedule_slot_waitlist%rowtype;
  booking_id uuid;
begin
  if public.current_user_role() <> 'applicant' then
    raise exception 'Only school applicants can reserve a schedule slot.';
  end if;

  select * into selected_slot
  from public.schedule_slots
  where id = p_slot_id
  for update;

  if selected_slot.id is null then
    raise exception 'Schedule slot not found.';
  end if;

  if selected_slot.status <> 'open' or selected_slot.starts_at <= now() then
    raise exception 'This schedule slot is no longer open.';
  end if;

  if selected_slot.school_booking_opens_at is null then
    raise exception 'This schedule slot has not been released to schools.';
  end if;

  if selected_slot.school_booking_opens_at > now() then
    raise exception 'School selection has not opened for this schedule slot.';
  end if;

  if selected_slot.school_booking_closes_at is not null
     and selected_slot.school_booking_closes_at <= now() then
    raise exception 'School selection has closed for this schedule slot.';
  end if;

  select * into selected_application
  from public.applications
  where id = p_application_id
    and public.can_edit_application(id, auth.uid())
    and is_archived = false;

  if selected_application.id is null then
    raise exception 'Application not found or you do not have editing access.';
  end if;

  if selected_application.cycle_id <> selected_slot.cycle_id then
    raise exception 'This slot belongs to a different application program.';
  end if;

  if exists (
    select 1
    from public.schedule_school_bookings booking
    where public.is_application_member(booking.application_id, auth.uid())
  ) then
    raise exception 'Your school already has a schedule slot.';
  end if;

  update public.schedule_slot_waitlist
  set status = 'expired', updated_at = now()
  where slot_id = p_slot_id
    and status = 'offered'
    and offer_expires_at <= now();

  select * into active_offer
  from public.schedule_slot_waitlist
  where slot_id = p_slot_id
    and status = 'offered'
    and offer_expires_at > now()
  order by offer_expires_at desc
  limit 1;

  if active_offer.id is not null then
    raise exception 'This timeslot is temporarily held for the next school on its waitlist.';
  end if;

  if exists (
    select 1
    from public.schedule_school_bookings booking
    where booking.slot_id = p_slot_id
  ) then
    raise exception 'Another school selected this slot moments before you. Choose another available time.';
  end if;

  begin
    insert into public.schedule_school_bookings (
      slot_id,
      application_id,
      booked_by
    ) values (
      p_slot_id,
      p_application_id,
      auth.uid()
    )
    returning id into booking_id;
  exception
    when unique_violation then
      if exists (
        select 1
        from public.schedule_school_bookings
        where slot_id = p_slot_id
      ) then
        raise exception 'Another school selected this slot moments before you. Choose another available time.';
      end if;

      raise exception 'Your school already has a schedule reservation.';
  end;

  return booking_id;
end;
$$;

grant execute on function public.book_schedule_slot(uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Feedback workflow status expansion and realtime
-- ---------------------------------------------------------------------------

alter table public.portal_feedback_requests
  drop constraint if exists portal_feedback_requests_status_check;
alter table public.portal_feedback_requests
  add constraint portal_feedback_requests_status_check check (
    status in (
      'new',
      'needs_information',
      'reviewing',
      'planned',
      'in_progress',
      'resolved',
      'closed'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'schedule_slot_waitlist'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.schedule_slot_waitlist;
  END IF;
END
$$;

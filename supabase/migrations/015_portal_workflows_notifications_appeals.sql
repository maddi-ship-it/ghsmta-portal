-- GHSMTA Portal: communication refactor, appeals, shared uploads,
-- adjudication consensus/review, scheduled notifications, owner digest,
-- advisory schedule management, and user feedback.
-- Run after migration 014.

-- ---------------------------------------------------------------------------
-- Chat architecture
-- ---------------------------------------------------------------------------

-- Extend participant assignments before chat/access functions reference them.
alter table public.adjudicator_assignments
  add column if not exists participant_role public.app_role,
  add column if not exists can_score boolean not null default true,
  add column if not exists can_comment boolean not null default true,
  add column if not exists removed_at timestamptz;

alter table public.chat_channels
  drop constraint if exists chat_channels_application_id_key;

alter table public.chat_channels
  drop constraint if exists chat_channels_channel_type_check;

alter table public.chat_channels
  add constraint chat_channels_channel_type_check check (
    channel_type in (
      'school',
      'school_dm',
      'applicant_community',
      'general',
      'networking',
      'advisory_committee'
    )
  );

alter table public.chat_channels
  drop constraint if exists chat_channels_application_type_check;

alter table public.chat_channels
  add constraint chat_channels_application_type_check check (
    (
      channel_type in ('school', 'school_dm')
      and application_id is not null
    )
    or
    (
      channel_type not in ('school', 'school_dm')
      and application_id is null
    )
  );

create unique index if not exists chat_channels_application_type_unique
  on public.chat_channels(application_id, channel_type)
  where application_id is not null;

update public.chat_channels
set
  name = 'Community Chat',
  description = 'A shared threaded space for applicants and GHSMTA owners.',
  updated_at = now()
where channel_type = 'applicant_community';

update public.chat_channels channel
set
  name = application.school_name || ' — School Staff',
  description = 'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
  updated_at = now()
from public.applications application
where channel.channel_type = 'school'
  and channel.application_id = application.id;

insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'school_dm',
  application.school_name || ' — Owner DM',
  'Private messages between the school applicant and GHSMTA owners.',
  application.id,
  true
from public.applications application
where application.applicant_user_id is not null
  and coalesce(application.is_archived, false) = false
on conflict (application_id, channel_type) do update set
  name = excluded.name,
  description = excluded.description,
  active = true,
  updated_at = now();

create or replace function public.sync_application_chat_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.applicant_user_id is not null
     and coalesce(new.is_archived, false) = false then
    insert into public.chat_channels (
      channel_type,
      name,
      description,
      application_id,
      active
    ) values (
      'school',
      new.school_name || ' — School Staff',
      'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
      new.id,
      true
    )
    on conflict (application_id, channel_type) do update set
      name = excluded.name,
      description = excluded.description,
      active = true,
      updated_at = now();

    insert into public.chat_channels (
      channel_type,
      name,
      description,
      application_id,
      active
    ) values (
      'school_dm',
      new.school_name || ' — Owner DM',
      'Private messages between the school applicant and GHSMTA owners.',
      new.id,
      true
    )
    on conflict (application_id, channel_type) do update set
      name = excluded.name,
      description = excluded.description,
      active = true,
      updated_at = now();
  else
    update public.chat_channels
    set active = false,
        updated_at = now()
    where application_id = new.id
      and channel_type in ('school', 'school_dm');
  end if;

  return new;
end;
$$;

create or replace function public.can_access_chat_channel(
  p_channel_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_channels channel
    join public.profiles profile
      on profile.id = p_user_id
     and profile.active = true
    left join public.applications application
      on application.id = channel.application_id
    where channel.id = p_channel_id
      and channel.active = true
      and (
        profile.role = 'owner'
        or (
          channel.channel_type = 'applicant_community'
          and profile.role = 'applicant'
        )
        or (
          channel.channel_type in ('general', 'networking')
          and profile.role in ('adjudicator', 'advisory_member')
        )
        or (
          channel.channel_type = 'advisory_committee'
          and profile.role = 'advisory_member'
        )
        or (
          channel.channel_type = 'school_dm'
          and application.applicant_user_id = p_user_id
        )
        or (
          channel.channel_type = 'school'
          and (
            exists (
              select 1
              from public.adjudicator_assignments assignment
              where assignment.application_id = channel.application_id
                and assignment.adjudicator_user_id = p_user_id
                and coalesce(assignment.removed_at, 'infinity'::timestamptz) > now()
            )
            or exists (
              select 1
              from public.schedule_school_bookings booking
              join public.schedule_slot_staff enrollment
                on enrollment.slot_id = booking.slot_id
              where booking.application_id = channel.application_id
                and enrollment.user_id = p_user_id
                and enrollment.joined_as = 'advisory_member'
            )
          )
        )
      )
  );
$$;

grant execute on function public.can_access_chat_channel(uuid, uuid)
to authenticated;

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
    select channel.channel_type, channel.application_id
    from public.chat_channels channel
    where channel.id = p_channel_id
      and channel.active = true
  ),
  eligible_users as (
    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where profile.active = true
      and profile.role = 'owner'

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'applicant_community'
      and profile.active = true
      and profile.role = 'applicant'

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type in ('general', 'networking')
      and profile.active = true
      and profile.role in ('adjudicator', 'advisory_member')

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'advisory_committee'
      and profile.active = true
      and profile.role = 'advisory_member'

    union

    select application.applicant_user_id
    from selected_channel channel
    join public.applications application
      on application.id = channel.application_id
    where channel.channel_type = 'school_dm'
      and application.applicant_user_id is not null

    union

    select assignment.adjudicator_user_id
    from selected_channel channel
    join public.adjudicator_assignments assignment
      on assignment.application_id = channel.application_id
    where channel.channel_type = 'school'
      and coalesce(assignment.removed_at, 'infinity'::timestamptz) > now()

    union

    select enrollment.user_id
    from selected_channel channel
    join public.schedule_school_bookings booking
      on booking.application_id = channel.application_id
    join public.schedule_slot_staff enrollment
      on enrollment.slot_id = booking.slot_id
    where channel.channel_type = 'school'
      and enrollment.joined_as = 'advisory_member'
  )
  select
    profile.id,
    coalesce(nullif(trim(profile.full_name), ''), profile.email, 'Portal user'),
    profile.role
  from eligible_users eligible
  join public.profiles profile on profile.id = eligible.id
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

-- ---------------------------------------------------------------------------
-- Generic automatically named uploads
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('portal-files', 'portal-files', false, 52428800)
on conflict (id) do update set
  public = false,
  file_size_limit = 52428800;

create table if not exists public.portal_files (
  id uuid primary key default gen_random_uuid(),
  context_type text not null check (
    context_type in ('appeal', 'bug_report', 'feature_request', 'application')
  ),
  context_id uuid not null,
  application_id uuid references public.applications(id) on delete cascade,
  original_name text not null,
  generated_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint,
  uploaded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists portal_files_context_idx
  on public.portal_files(context_type, context_id, created_at);

alter table public.portal_files enable row level security;

grant select, insert, delete on public.portal_files to authenticated;

-- ---------------------------------------------------------------------------
-- Appeals
-- ---------------------------------------------------------------------------

create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  category_id uuid references public.scoring_categories(id) on delete set null,
  appeal_type text not null default 'adjudication',
  explanation text not null check (char_length(explanation) between 10 and 10000),
  status text not null default 'submitted' check (
    status in ('draft', 'submitted', 'advisory_review', 'owner_review', 'resolved', 'denied', 'withdrawn')
  ),
  advisory_notes text,
  owner_notes text,
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appeals_application_idx
  on public.appeals(application_id, submitted_at desc);
create index if not exists appeals_status_idx
  on public.appeals(status, submitted_at desc);

drop trigger if exists appeals_set_updated_at on public.appeals;
create trigger appeals_set_updated_at
before update on public.appeals
for each row execute function public.set_updated_at();

alter table public.appeals enable row level security;

grant select, insert, update on public.appeals to authenticated;

create policy "applicants create own appeals"
on public.appeals for insert to authenticated
with check (
  submitted_by = auth.uid()
  and exists (
    select 1 from public.applications application
    where application.id = application_id
      and application.applicant_user_id = auth.uid()
  )
);

create policy "appeal participants read appeals"
on public.appeals for select to authenticated
using (
  public.current_user_role() in ('advisory_member', 'owner')
  or exists (
    select 1 from public.applications application
    where application.id = appeals.application_id
      and application.applicant_user_id = auth.uid()
  )
);

create policy "advisory and owners update appeals"
on public.appeals for update to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'))
with check (public.current_user_role() in ('advisory_member', 'owner'));

-- ---------------------------------------------------------------------------
-- Bug reports and feature requests
-- ---------------------------------------------------------------------------

create table if not exists public.portal_feedback_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('bug_report', 'feature_request')),
  title text not null check (char_length(title) between 3 and 180),
  description text not null check (char_length(description) between 10 and 10000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'new' check (
    status in ('new', 'reviewing', 'planned', 'in_progress', 'resolved', 'closed')
  ),
  page_url text,
  browser_info text,
  application_id uuid references public.applications(id) on delete set null,
  submitted_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  owner_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portal_feedback_status_idx
  on public.portal_feedback_requests(status, created_at desc);

drop trigger if exists portal_feedback_requests_set_updated_at
on public.portal_feedback_requests;
create trigger portal_feedback_requests_set_updated_at
before update on public.portal_feedback_requests
for each row execute function public.set_updated_at();

alter table public.portal_feedback_requests enable row level security;
grant select, insert, update on public.portal_feedback_requests to authenticated;

create policy "users create feedback requests"
on public.portal_feedback_requests for insert to authenticated
with check (submitted_by = auth.uid());

create policy "users read own feedback owners read all"
on public.portal_feedback_requests for select to authenticated
using (submitted_by = auth.uid() or public.current_user_role() = 'owner');

create policy "owners manage feedback requests"
on public.portal_feedback_requests for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

-- ---------------------------------------------------------------------------
-- In-app notifications and owner audit/digest
-- ---------------------------------------------------------------------------

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  href text,
  related_application_id uuid references public.applications(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_notifications_user_idx
  on public.user_notifications(user_id, read_at, created_at desc);

alter table public.user_notifications enable row level security;
grant select, update on public.user_notifications to authenticated;

create policy "users read own notifications"
on public.user_notifications for select to authenticated
using (user_id = auth.uid());

create policy "users mark own notifications read"
on public.user_notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create table if not exists public.owner_activity_log (
  id uuid primary key default gen_random_uuid(),
  activity_type text not null,
  title text not null,
  detail text,
  actor_id uuid references public.profiles(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  slot_id uuid references public.schedule_slots(id) on delete set null,
  appeal_id uuid references public.appeals(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists owner_activity_log_created_idx
  on public.owner_activity_log(created_at desc);

alter table public.owner_activity_log enable row level security;
grant select on public.owner_activity_log to authenticated;

create policy "owners read activity log"
on public.owner_activity_log for select to authenticated
using (public.current_user_role() = 'owner');

create table if not exists public.owner_digest_settings (
  owner_user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  delivery_hour integer not null default 8 check (delivery_hour between 0 and 23),
  time_zone text not null default 'America/New_York',
  include_empty boolean not null default false,
  recipient_email text,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.owner_digest_settings enable row level security;
grant select, insert, update on public.owner_digest_settings to authenticated;

create policy "owners manage own digest settings"
on public.owner_digest_settings for all to authenticated
using (owner_user_id = auth.uid() and public.current_user_role() = 'owner')
with check (owner_user_id = auth.uid() and public.current_user_role() = 'owner');

insert into public.owner_digest_settings (owner_user_id, recipient_email)
select profile.id, profile.email
from public.profiles profile
where profile.role = 'owner'
on conflict (owner_user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Schedule notification rules
-- ---------------------------------------------------------------------------

create table if not exists public.schedule_notification_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cycle_id uuid references public.award_cycles(id) on delete cascade,
  offset_minutes integer not null check (offset_minutes between 0 and 525600),
  audience text not null check (audience in ('school', 'school_staff')),
  destination text not null check (destination in ('school_dm', 'school_channel', 'in_app', 'email')),
  title_template text not null,
  message_template text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists schedule_notification_rules_set_updated_at
on public.schedule_notification_rules;
create trigger schedule_notification_rules_set_updated_at
before update on public.schedule_notification_rules
for each row execute function public.set_updated_at();

create table if not exists public.schedule_notification_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.schedule_notification_rules(id) on delete cascade,
  slot_id uuid not null references public.schedule_slots(id) on delete cascade,
  scheduled_for timestamptz not null,
  processed_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'partial', 'failed', 'skipped')),
  detail text,
  unique (rule_id, slot_id, scheduled_for)
);

alter table public.schedule_notification_rules enable row level security;
alter table public.schedule_notification_runs enable row level security;
grant select, insert, update, delete on public.schedule_notification_rules to authenticated;
grant select on public.schedule_notification_runs to authenticated;

create policy "owners manage schedule notification rules"
on public.schedule_notification_rules for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners read schedule notification runs"
on public.schedule_notification_runs for select to authenticated
using (public.current_user_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Advisory category proposals and adjudicator approvals
-- ---------------------------------------------------------------------------

alter table public.adjudicator_assignments
  add column if not exists participant_role public.app_role,
  add column if not exists can_score boolean not null default true,
  add column if not exists can_comment boolean not null default true,
  add column if not exists removed_at timestamptz;

update public.adjudicator_assignments assignment
set participant_role = profile.role
from public.profiles profile
where profile.id = assignment.adjudicator_user_id
  and assignment.participant_role is null;

create table if not exists public.adjudication_category_proposals (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  category_id uuid not null references public.scoring_categories(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  is_eligible boolean not null,
  range_min numeric(4,2),
  range_max numeric(4,2),
  status text not null default 'proposed' check (
    status in ('proposed', 'approved', 'disputed', 'overridden')
  ),
  advisory_note text,
  owner_override_note text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, category_id),
  check (
    not is_eligible
    or (
      range_min is not null
      and range_max is not null
      and range_max - range_min = 2.00
    )
  )
);

create table if not exists public.adjudication_category_approvals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.adjudication_category_proposals(id) on delete cascade,
  adjudicator_user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  eligibility_approved boolean not null,
  range_approved boolean not null,
  response text not null check (response in ('approved', 'disputed')),
  comment text,
  responded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proposal_id, adjudicator_user_id)
);

create table if not exists public.adjudication_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  status text not null default 'draft' check (
    status in (
      'draft',
      'advisory_review',
      'awaiting_approvals',
      'ready_for_owner',
      'owner_review',
      'returned',
      'released'
    )
  ),
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  owner_reviewed_by uuid references public.profiles(id) on delete set null,
  owner_reviewed_at timestamptz,
  owner_note text,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists adjudication_category_proposals_set_updated_at
on public.adjudication_category_proposals;
create trigger adjudication_category_proposals_set_updated_at
before update on public.adjudication_category_proposals
for each row execute function public.set_updated_at();

drop trigger if exists adjudication_category_approvals_set_updated_at
on public.adjudication_category_approvals;
create trigger adjudication_category_approvals_set_updated_at
before update on public.adjudication_category_approvals
for each row execute function public.set_updated_at();

drop trigger if exists adjudication_reviews_set_updated_at
on public.adjudication_reviews;
create trigger adjudication_reviews_set_updated_at
before update on public.adjudication_reviews
for each row execute function public.set_updated_at();

alter table public.adjudication_category_proposals enable row level security;
alter table public.adjudication_category_approvals enable row level security;
alter table public.adjudication_reviews enable row level security;

grant select, insert, update on public.adjudication_category_proposals to authenticated;
grant select, insert, update on public.adjudication_category_approvals to authenticated;
grant select, insert, update on public.adjudication_reviews to authenticated;

create policy "staff read category proposals"
on public.adjudication_category_proposals for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "advisory and owners manage proposals"
on public.adjudication_category_proposals for insert to authenticated
with check (public.current_user_role() in ('advisory_member', 'owner'));

create policy "advisory and owners update proposals"
on public.adjudication_category_proposals for update to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'))
with check (public.current_user_role() in ('advisory_member', 'owner'));

create policy "staff read proposal approvals"
on public.adjudication_category_approvals for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "assigned adjudicators respond to proposals"
on public.adjudication_category_approvals for insert to authenticated
with check (
  adjudicator_user_id = auth.uid()
  and exists (
    select 1
    from public.adjudication_category_proposals proposal
    join public.adjudicator_assignments assignment
      on assignment.application_id = proposal.application_id
    where proposal.id = proposal_id
      and assignment.adjudicator_user_id = auth.uid()
      and assignment.can_score = true
      and assignment.removed_at is null
  )
);

create policy "assigned adjudicators update own proposal response"
on public.adjudication_category_approvals for update to authenticated
using (adjudicator_user_id = auth.uid())
with check (adjudicator_user_id = auth.uid());

create policy "staff read adjudication reviews"
on public.adjudication_reviews for select to authenticated
using (public.current_user_role() in ('adjudicator', 'advisory_member', 'owner'));

create policy "advisory and owners create reviews"
on public.adjudication_reviews for insert to authenticated
with check (public.current_user_role() in ('advisory_member', 'owner'));

create policy "advisory and owners update reviews"
on public.adjudication_reviews for update to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'))
with check (public.current_user_role() in ('advisory_member', 'owner'));

create or replace function public.recompute_category_proposal_status(
  p_proposal_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal_application_id uuid;
  expected_count integer;
  response_count integer;
  dispute_count integer;
  next_status text;
begin
  select application_id into proposal_application_id
  from public.adjudication_category_proposals
  where id = p_proposal_id;

  select count(*) into expected_count
  from public.adjudicator_assignments assignment
  where assignment.application_id = proposal_application_id
    and assignment.can_score = true
    and assignment.removed_at is null;

  select
    count(*),
    count(*) filter (where response = 'disputed')
  into response_count, dispute_count
  from public.adjudication_category_approvals
  where proposal_id = p_proposal_id;

  next_status := case
    when dispute_count > 0 then 'disputed'
    when expected_count > 0 and response_count >= expected_count then 'approved'
    else 'proposed'
  end;

  update public.adjudication_category_proposals
  set
    status = next_status,
    approved_at = case when next_status = 'approved' then now() else null end,
    updated_at = now()
  where id = p_proposal_id
    and status <> 'overridden';

  return next_status;
end;
$$;

create or replace function public.category_approval_recompute_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_category_proposal_status(new.proposal_id);
  return new;
end;
$$;

drop trigger if exists category_approval_recompute
on public.adjudication_category_approvals;
create trigger category_approval_recompute
after insert or update on public.adjudication_category_approvals
for each row execute function public.category_approval_recompute_trigger();

create or replace function public.owner_set_scoring_participant(
  p_application_id uuid,
  p_user_id uuid,
  p_can_score boolean,
  p_can_comment boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role public.app_role;
  assignment_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can configure scoring participants.';
  end if;

  select role into selected_role
  from public.profiles
  where id = p_user_id and active = true;

  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception 'Choose an active adjudicator or advisory committee member.';
  end if;

  insert into public.adjudicator_assignments (
    application_id,
    adjudicator_user_id,
    assigned_by,
    status,
    participant_role,
    can_score,
    can_comment,
    removed_at,
    internal_notes
  ) values (
    p_application_id,
    p_user_id,
    auth.uid(),
    'assigned',
    selected_role,
    p_can_score,
    p_can_comment,
    null,
    case when selected_role = 'advisory_member'
      then 'Advisory committee member assigned as a scoring/commenting participant.'
      else null
    end
  )
  on conflict (application_id, adjudicator_user_id) do update set
    participant_role = excluded.participant_role,
    can_score = excluded.can_score,
    can_comment = excluded.can_comment,
    removed_at = null,
    assigned_by = auth.uid()
  returning id into assignment_id;

  return assignment_id;
end;
$$;

grant execute on function public.owner_set_scoring_participant(uuid, uuid, boolean, boolean)
to authenticated;

create or replace function public.ensure_adjudication_scorecard(
  p_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_assignment public.adjudicator_assignments%rowtype;
  selected_rubric_id uuid;
  scorecard_id uuid;
begin
  if public.current_user_role() not in ('adjudicator', 'advisory_member') then
    raise exception 'A scoring participant account is required.';
  end if;

  select * into selected_assignment
  from public.adjudicator_assignments
  where application_id = p_application_id
    and adjudicator_user_id = auth.uid()
    and can_score = true
    and removed_at is null;

  if selected_assignment.id is null then
    raise exception 'You are not assigned as a scoring participant for this application.';
  end if;

  select rubric.id into selected_rubric_id
  from public.scoring_rubrics rubric
  join public.applications application
    on application.cycle_id = rubric.cycle_id
  where application.id = p_application_id
    and rubric.status = 'published'
  order by rubric.version_number desc
  limit 1;

  if selected_rubric_id is null then
    raise exception 'No published scoring rubric exists for this program.';
  end if;

  insert into public.adjudication_scorecards (
    assignment_id,
    application_id,
    adjudicator_user_id,
    rubric_id,
    status
  ) values (
    selected_assignment.id,
    p_application_id,
    auth.uid(),
    selected_rubric_id,
    'draft'
  )
  on conflict (assignment_id) do update set updated_at = now()
  returning id into scorecard_id;

  update public.adjudicator_assignments
  set status = case when status = 'assigned' then 'in_progress' else status end
  where id = selected_assignment.id;

  return scorecard_id;
end;
$$;

grant execute on function public.ensure_adjudication_scorecard(uuid)
to authenticated;

-- Replace scorecard policies so advisory scoring participants can use their own scorecard.
drop policy if exists "adjudicators create own scorecards"
on public.adjudication_scorecards;
create policy "scoring participants create own scorecards"
on public.adjudication_scorecards for insert to authenticated
with check (
  adjudicator_user_id = auth.uid()
  and exists (
    select 1 from public.adjudicator_assignments assignment
    where assignment.id = assignment_id
      and assignment.application_id = application_id
      and assignment.adjudicator_user_id = auth.uid()
      and assignment.can_score = true
      and assignment.removed_at is null
  )
);

create or replace function public.submit_adjudication_for_owner(
  p_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  review_id uuid;
  missing_scorecards integer;
  unresolved_proposals integer;
begin
  if public.current_user_role() not in ('advisory_member', 'owner') then
    raise exception 'Only an advisory committee member or owner can submit a panel review.';
  end if;

  select count(*) into missing_scorecards
  from public.adjudicator_assignments assignment
  left join public.adjudication_scorecards scorecard
    on scorecard.assignment_id = assignment.id
  where assignment.application_id = p_application_id
    and assignment.can_score = true
    and assignment.removed_at is null
    and coalesce(scorecard.status, 'missing') not in ('submitted', 'locked');

  if missing_scorecards > 0 then
    raise exception '% scoring participant(s) have not submitted their scorecard.', missing_scorecards;
  end if;

  select count(*) into unresolved_proposals
  from public.scoring_categories category
  join public.scoring_rubrics rubric on rubric.id = category.rubric_id
  join public.applications application on application.cycle_id = rubric.cycle_id
  left join public.adjudication_category_proposals proposal
    on proposal.application_id = application.id
   and proposal.category_id = category.id
  where application.id = p_application_id
    and category.active = true
    and coalesce(proposal.status, 'missing') not in ('approved', 'overridden');

  if unresolved_proposals > 0 then
    raise exception '% category eligibility/range decision(s) remain unresolved.', unresolved_proposals;
  end if;

  insert into public.adjudication_reviews (
    application_id,
    status,
    submitted_by,
    submitted_at
  ) values (
    p_application_id,
    'ready_for_owner',
    auth.uid(),
    now()
  )
  on conflict (application_id) do update set
    status = 'ready_for_owner',
    submitted_by = auth.uid(),
    submitted_at = now(),
    returned_at = null,
    updated_at = now()
  returning id into review_id;

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    application_id
  ) values (
    'adjudication_ready_for_owner',
    'Adjudication ready for Owner review',
    'All scorecards and category decisions are complete.',
    auth.uid(),
    p_application_id
  );

  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href,
    related_application_id
  )
  select
    profile.id,
    'adjudication_ready_for_owner',
    'Adjudication ready for review',
    application.school_name || ' — ' || coalesce(application.production_title, 'Untitled production'),
    '/portal/adjudication/' || p_application_id::text,
    p_application_id
  from public.profiles profile
  cross join public.applications application
  where profile.role = 'owner'
    and profile.active = true
    and application.id = p_application_id;

  return review_id;
end;
$$;

grant execute on function public.submit_adjudication_for_owner(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Advisory schedule participant management
-- ---------------------------------------------------------------------------

create or replace function public.manage_schedule_staff(
  p_slot_id uuid,
  p_user_id uuid,
  p_action text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.app_role;
  selected_role public.app_role;
  enrollment_id uuid;
  actor_name text;
  selected_name text;
  slot_title text;
  booked_application_id uuid;
begin
  actor_role := public.current_user_role();
  if actor_role not in ('advisory_member', 'owner') then
    raise exception 'Only owners and advisory committee members can manage slot participants.';
  end if;

  select role, coalesce(full_name, email, 'Portal user')
  into selected_role, selected_name
  from public.profiles
  where id = p_user_id and active = true;

  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception 'Choose an active adjudicator or advisory committee member.';
  end if;

  select title into slot_title from public.schedule_slots where id = p_slot_id;
  if slot_title is null then raise exception 'Schedule slot not found.'; end if;

  select coalesce(full_name, email, 'Portal user') into actor_name
  from public.profiles where id = auth.uid();

  select application_id into booked_application_id
  from public.schedule_school_bookings where slot_id = p_slot_id;

  if p_action = 'add' then
    insert into public.schedule_slot_staff (
      slot_id, user_id, joined_as, joined_by
    ) values (
      p_slot_id, p_user_id, selected_role, auth.uid()
    )
    on conflict (slot_id, user_id) do update set
      joined_as = excluded.joined_as,
      joined_by = auth.uid()
    returning id into enrollment_id;
  elsif p_action = 'remove' then
    if actor_role = 'advisory_member' and coalesce(trim(p_reason), '') = '' then
      raise exception 'Enter a reason when removing a participant.';
    end if;

    select id into enrollment_id
    from public.schedule_slot_staff
    where slot_id = p_slot_id and user_id = p_user_id;

    delete from public.schedule_slot_staff
    where slot_id = p_slot_id and user_id = p_user_id;
  else
    raise exception 'Unsupported schedule action.';
  end if;

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    application_id,
    slot_id,
    metadata
  ) values (
    'schedule_participant_' || p_action,
    actor_name || ' ' || case when p_action = 'add' then 'added ' else 'removed ' end || selected_name,
    coalesce(nullif(trim(p_reason), ''), slot_title),
    auth.uid(),
    booked_application_id,
    p_slot_id,
    jsonb_build_object(
      'participant_id', p_user_id,
      'participant_role', selected_role,
      'reason', p_reason
    )
  );

  return enrollment_id;
end;
$$;

grant execute on function public.manage_schedule_staff(uuid, uuid, text, text)
to authenticated;

-- Keep direct schedule deletes Owner-only; advisory management goes through RPC.

-- ---------------------------------------------------------------------------
-- Appeal submission notifications
-- ---------------------------------------------------------------------------

create or replace function public.notify_appeal_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  school_name_value text;
  production_title_value text;
  dm_channel_id uuid;
  advisory_channel_id uuid;
  actor_name text;
begin
  select
    application.school_name,
    application.production_title
  into school_name_value, production_title_value
  from public.applications application
  where application.id = new.application_id;

  select coalesce(profile.full_name, profile.email, 'Applicant')
  into actor_name
  from public.profiles profile
  where profile.id = new.submitted_by;

  select id into dm_channel_id
  from public.chat_channels
  where application_id = new.application_id
    and channel_type = 'school_dm'
    and active = true;

  select id into advisory_channel_id
  from public.chat_channels
  where channel_type = 'advisory_committee'
    and application_id is null
    and active = true;

  if dm_channel_id is not null then
    insert into public.chat_posts (
      channel_id,
      author_id,
      subject,
      body
    ) values (
      dm_channel_id,
      new.submitted_by,
      'Appeal submitted',
      'An appeal has been submitted for ' || school_name_value || '. Owners will review it in the portal.'
    );
  end if;

  if advisory_channel_id is not null then
    insert into public.chat_posts (
      channel_id,
      author_id,
      subject,
      body
    ) values (
      advisory_channel_id,
      new.submitted_by,
      'New appeal — ' || school_name_value,
      actor_name || ' submitted an appeal for ' || school_name_value || ' — ' || coalesce(production_title_value, 'Untitled production') || '. Open the Appeals page to review it.'
    );
  end if;

  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href,
    related_application_id
  )
  select
    profile.id,
    'appeal_submitted',
    'New appeal submitted',
    school_name_value || ' — ' || coalesce(production_title_value, 'Untitled production'),
    '/portal/appeals',
    new.application_id
  from public.profiles profile
  where profile.active = true
    and profile.role in ('advisory_member', 'owner');

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    application_id,
    appeal_id
  ) values (
    'appeal_submitted',
    'New appeal from ' || school_name_value,
    coalesce(production_title_value, 'Untitled production'),
    new.submitted_by,
    new.application_id,
    new.id
  );

  return new;
end;
$$;

drop trigger if exists appeals_notify_submission on public.appeals;
create trigger appeals_notify_submission
after insert on public.appeals
for each row
when (new.status = 'submitted')
execute function public.notify_appeal_submitted();

-- ---------------------------------------------------------------------------
-- Portal file access policies and Storage policies
-- ---------------------------------------------------------------------------

create policy "context participants read portal files"
on public.portal_files for select to authenticated
using (
  public.current_user_role() = 'owner'
  or uploaded_by = auth.uid()
  or (
    context_type = 'appeal'
    and public.current_user_role() = 'advisory_member'
  )
  or (
    application_id is not null
    and exists (
      select 1 from public.applications application
      where application.id = portal_files.application_id
        and application.applicant_user_id = auth.uid()
    )
  )
);

create policy "users register own portal files"
on public.portal_files for insert to authenticated
with check (uploaded_by = auth.uid());

create policy "owners delete portal files"
on public.portal_files for delete to authenticated
using (public.current_user_role() = 'owner' or uploaded_by = auth.uid());

create policy "authenticated upload portal files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'portal-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "portal file participants read storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'portal-files'
  and exists (
    select 1
    from public.portal_files file
    where file.storage_path = name
      and (
        public.current_user_role() = 'owner'
        or file.uploaded_by = auth.uid()
        or (file.context_type = 'appeal' and public.current_user_role() = 'advisory_member')
        or (
          file.application_id is not null
          and exists (
            select 1 from public.applications application
            where application.id = file.application_id
              and application.applicant_user_id = auth.uid()
          )
        )
      )
  )
);

create policy "portal file owners and uploaders delete storage"
on storage.objects for delete to authenticated
using (
  bucket_id = 'portal-files'
  and exists (
    select 1 from public.portal_files file
    where file.storage_path = name
      and (
        public.current_user_role() = 'owner'
        or file.uploaded_by = auth.uid()
      )
  )
);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.user_notifications;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.adjudication_category_proposals;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.adjudication_category_approvals;
exception when duplicate_object then null;
end $$;

-- Workflow actions create notifications and reset proposal responses through
-- authenticated server actions.
grant insert on public.user_notifications to authenticated;
create policy "staff create workflow notifications"
on public.user_notifications for insert to authenticated
with check (
  public.current_user_role() in ('adjudicator', 'advisory_member', 'owner')
);

grant delete on public.adjudication_category_approvals to authenticated;
create policy "advisory and owners reset proposal approvals"
on public.adjudication_category_approvals for delete to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'));

-- Ensure school DMs sort directly beside their internal school channels.
create or replace function public.get_my_chat_channels()
returns table (
  channel_id uuid,
  channel_type text,
  channel_name text,
  channel_description text,
  application_id uuid,
  school_name text,
  production_title text,
  last_activity_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    channel.id,
    channel.channel_type,
    channel.name,
    channel.description,
    channel.application_id,
    application.school_name,
    application.production_title,
    greatest(
      channel.updated_at,
      coalesce((select max(post.last_activity_at) from public.chat_posts post where post.channel_id = channel.id), channel.created_at)
    ),
    (
      select count(*)
      from (
        select post.created_at, post.author_id from public.chat_posts post where post.channel_id = channel.id
        union all
        select reply.created_at, reply.author_id from public.chat_replies reply where reply.channel_id = channel.id
      ) activity
      where activity.author_id <> auth.uid()
        and activity.created_at > coalesce(
          (select read_state.last_read_at from public.chat_channel_reads read_state where read_state.channel_id = channel.id and read_state.user_id = auth.uid()),
          '-infinity'::timestamptz
        )
    )::bigint
  from public.chat_channels channel
  left join public.applications application on application.id = channel.application_id
  where public.can_access_chat_channel(channel.id, auth.uid())
  order by
    case channel.channel_type
      when 'applicant_community' then 1
      when 'general' then 2
      when 'networking' then 3
      when 'advisory_committee' then 4
      when 'school_dm' then 5
      when 'school' then 6
      else 7
    end,
    channel.name;
$$;

grant execute on function public.get_my_chat_channels() to authenticated;

-- GHSMTA Portal: Reports Center infrastructure, digest preferences,
-- and Owner-created direct/group chat participants.

begin;

alter table public.owner_digest_settings
  add column if not exists preference_scope jsonb not null default jsonb_build_object(
    'all_cycle_activity', true,
    'assigned_regions_only', false,
    'assigned_schools_only', false,
    'application_issues', true,
    'scheduling_issues', true,
    'assignment_issues', true,
    'scoring_issues', true,
    'comment_review_issues', true,
    'appeals', true,
    'eligibility', true,
    'results_readiness', true,
    'communication_failures', true,
    'user_access_issues', true,
    'system_errors', true,
    'daily_digest', true,
    'weekly_summary', false,
    'immediate_critical_alerts', true
  ),
  add column if not exists weekly_summary_enabled boolean not null default false,
  add column if not exists immediate_alerts_enabled boolean not null default true;

create table if not exists public.report_presets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  report_key text not null,
  name text not null,
  description text,
  filters jsonb not null default '{}'::jsonb,
  columns text[] not null default '{}'::text[],
  format text not null default 'pdf' check (format in ('pdf','csv','zip')),
  variant text not null default 'internal' check (variant in ('internal','external')),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, report_key, name)
);

create index if not exists report_presets_owner_idx
  on public.report_presets(owner_user_id, favorite desc, updated_at desc);

drop trigger if exists report_presets_set_updated_at on public.report_presets;
create trigger report_presets_set_updated_at
before update on public.report_presets
for each row execute function public.set_updated_at();

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  report_key text not null,
  report_title text not null,
  requested_format text not null check (requested_format in ('pdf','csv','zip')),
  variant text not null default 'internal' check (variant in ('internal','external')),
  status text not null default 'completed' check (
    status in ('queued','running','completed','failed','expired','deleted')
  ),
  requested_by uuid references public.profiles(id) on delete set null,
  filters jsonb not null default '{}'::jsonb,
  row_count integer not null default 0,
  file_name text,
  storage_path text,
  mime_type text,
  byte_size bigint,
  error_detail text,
  expires_at timestamptz,
  generated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists report_runs_requested_by_idx
  on public.report_runs(requested_by, created_at desc);

create index if not exists report_runs_report_idx
  on public.report_runs(report_key, created_at desc);

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  report_key text not null,
  name text not null,
  enabled boolean not null default true,
  format text not null default 'pdf' check (format in ('pdf','csv','zip')),
  variant text not null default 'internal' check (variant in ('internal','external')),
  filters jsonb not null default '{}'::jsonb,
  delivery_emails text[] not null default '{}'::text[],
  cron_expression text,
  time_zone text not null default 'America/New_York',
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_schedules_due_idx
  on public.report_schedules(enabled, next_run_at);

drop trigger if exists report_schedules_set_updated_at on public.report_schedules;
create trigger report_schedules_set_updated_at
before update on public.report_schedules
for each row execute function public.set_updated_at();

create table if not exists public.report_delivery_log (
  id uuid primary key default gen_random_uuid(),
  report_run_id uuid references public.report_runs(id) on delete cascade,
  report_schedule_id uuid references public.report_schedules(id) on delete set null,
  recipient_email text,
  delivery_status text not null default 'pending' check (
    delivery_status in ('pending','sent','failed','skipped')
  ),
  detail text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists report_delivery_log_run_idx
  on public.report_delivery_log(report_run_id, created_at desc);

alter table public.report_presets enable row level security;
alter table public.report_runs enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_delivery_log enable row level security;

grant select, insert, update, delete on public.report_presets to authenticated;
grant select, insert, update on public.report_runs to authenticated;
grant select, insert, update, delete on public.report_schedules to authenticated;
grant select, insert, update on public.report_delivery_log to authenticated;

drop policy if exists "owners manage own report presets" on public.report_presets;
create policy "owners manage own report presets"
on public.report_presets for all to authenticated
using (owner_user_id = auth.uid() and public.current_user_role() = 'owner')
with check (owner_user_id = auth.uid() and public.current_user_role() = 'owner');

drop policy if exists "owners read report runs" on public.report_runs;
create policy "owners read report runs"
on public.report_runs for select to authenticated
using (public.current_user_role() = 'owner');

drop policy if exists "owners create report runs" on public.report_runs;
create policy "owners create report runs"
on public.report_runs for insert to authenticated
with check (requested_by = auth.uid() and public.current_user_role() = 'owner');

drop policy if exists "owners update report runs" on public.report_runs;
create policy "owners update report runs"
on public.report_runs for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "owners manage own report schedules" on public.report_schedules;
create policy "owners manage own report schedules"
on public.report_schedules for all to authenticated
using (owner_user_id = auth.uid() and public.current_user_role() = 'owner')
with check (owner_user_id = auth.uid() and public.current_user_role() = 'owner');

drop policy if exists "owners read report delivery log" on public.report_delivery_log;
create policy "owners read report delivery log"
on public.report_delivery_log for select to authenticated
using (public.current_user_role() = 'owner');

drop policy if exists "owners create report delivery log" on public.report_delivery_log;
create policy "owners create report delivery log"
on public.report_delivery_log for insert to authenticated
with check (public.current_user_role() = 'owner');

drop policy if exists "owners update report delivery log" on public.report_delivery_log;
create policy "owners update report delivery log"
on public.report_delivery_log for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

alter table public.chat_channels
  drop constraint if exists chat_channels_channel_type_check;

alter table public.chat_channels
  add constraint chat_channels_channel_type_check check (
    channel_type in (
      'school',
      'school_dm',
      'scholarship_dm',
      'applicant_community',
      'general',
      'networking',
      'advisory_committee',
      'direct_message',
      'group_direct_message'
    )
  );

drop index if exists public.chat_channels_global_type_unique;

create unique index if not exists chat_channels_global_type_unique
  on public.chat_channels(channel_type)
  where application_id is null
    and channel_type in (
      'applicant_community',
      'general',
      'networking',
      'advisory_committee'
    );

create table if not exists public.chat_direct_participants (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists chat_direct_participants_user_idx
  on public.chat_direct_participants(user_id, channel_id);

alter table public.chat_direct_participants enable row level security;
grant select, insert, delete on public.chat_direct_participants to authenticated;

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
        profile.role = 'owner'

        or (
          channel.channel_type in ('direct_message','group_direct_message')
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
          and profile.role in (
            'adjudicator',
            'advisory_member',
            'program_manager'
          )
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
                and enrollment.joined_as in (
                  'adjudicator',
                  'advisory_member'
                )
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

drop policy if exists "direct chat participants read own channels" on public.chat_direct_participants;
create policy "direct chat participants read own channels"
on public.chat_direct_participants for select to authenticated
using (
  public.current_user_role() = 'owner'
  or user_id = auth.uid()
  or public.can_access_chat_channel(channel_id, auth.uid())
);

drop policy if exists "owners create direct chat participants" on public.chat_direct_participants;
create policy "owners create direct chat participants"
on public.chat_direct_participants for insert to authenticated
with check (public.current_user_role() = 'owner');

drop policy if exists "owners delete direct chat participants" on public.chat_direct_participants;
create policy "owners delete direct chat participants"
on public.chat_direct_participants for delete to authenticated
using (public.current_user_role() = 'owner');

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
set search_path = ''
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
      and channel.channel_type not in ('direct_message','group_direct_message')

    union

    select participant.user_id
    from selected_channel channel
    join public.chat_direct_participants participant
      on participant.channel_id = p_channel_id
    where channel.channel_type in ('direct_message','group_direct_message')

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
    where channel.channel_type = 'general'
      and profile.active = true
      and profile.role in (
        'adjudicator',
        'advisory_member',
        'program_manager'
      )

    union

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'networking'
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

    select profile.id
    from public.profiles profile
    cross join selected_channel channel
    where channel.channel_type = 'scholarship_dm'
      and profile.active = true
      and profile.role = 'program_manager'

    union

    select member.user_id
    from selected_channel channel
    join public.application_members member
      on member.application_id = channel.application_id
    join public.profiles profile
      on profile.id = member.user_id
    where channel.channel_type in ('school_dm', 'scholarship_dm')
      and member.active = true
      and profile.active = true
      and profile.role = 'applicant'

    union

    select assignment.adjudicator_user_id
    from selected_channel channel
    join public.adjudicator_assignments assignment
      on assignment.application_id = channel.application_id
    where channel.channel_type = 'school'
      and assignment.removed_at is null

    union

    select enrollment.user_id
    from selected_channel channel
    join public.schedule_school_bookings booking
      on booking.application_id = channel.application_id
    join public.schedule_slot_staff enrollment
      on enrollment.slot_id = booking.slot_id
    where channel.channel_type = 'school'
      and enrollment.joined_as in ('adjudicator', 'advisory_member')
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
      when 'program_manager' then 2
      when 'advisory_member' then 3
      when 'adjudicator' then 4
      when 'applicant' then 5
      else 6
    end,
    coalesce(profile.full_name, profile.email);
end;
$$;

revoke all on function public.get_chat_channel_members(uuid)
from public, anon;
grant execute on function public.get_chat_channel_members(uuid)
to authenticated;

create or replace function public.get_my_chat_channels_v3()
returns table (
  channel_id uuid,
  channel_type text,
  channel_name text,
  channel_description text,
  application_id uuid,
  school_name text,
  production_title text,
  application_archived boolean,
  last_activity_at timestamptz,
  unread_count bigint,
  latest_message_preview text,
  latest_author_name text,
  channel_group text,
  channel_group_label text,
  channel_group_order integer,
  visibility_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    channel.channel_id,
    channel.channel_type,
    case channel.channel_type
      when 'applicant_community' then 'School Community Chat'
      when 'general' then 'General Announcements'
      else channel.channel_name
    end as channel_name,
    channel.channel_description,
    channel.application_id,
    channel.school_name,
    channel.production_title,
    channel.application_archived,
    channel.last_activity_at,
    channel.unread_count,
    channel.latest_message_preview,
    channel.latest_author_name,
    case
      when channel.application_archived then 'archived'
      when channel.channel_type = 'scholarship_dm'
        then 'scholarship_applicants'
      when channel.channel_type in ('direct_message','group_direct_message')
        then 'owner_direct_messages'
      else channel.channel_group
    end as channel_group,
    case
      when channel.application_archived
        then 'Archived conversations'
      when channel.channel_type = 'scholarship_dm'
        then 'Scholarship Applicants'
      when channel.channel_type in ('direct_message','group_direct_message')
        then 'Direct Messages'
      when channel.channel_group = 'direct_messages'
        then 'School Messaging'
      when channel.channel_group = 'school_staff'
        then 'Panel Channels'
      when channel.channel_group = 'staff'
        then 'Adjudicator Channels'
      else channel.channel_group_label
    end as channel_group_label,
    case
      when channel.application_archived then 60
      when channel.channel_type in ('direct_message','group_direct_message') then 12
      when channel.channel_type = 'scholarship_dm' then 15
      else channel.channel_group_order
    end as channel_group_order,
    case
      when channel.channel_type = 'scholarship_dm'
        then 'Applicant + Program Managers + Owners'
      when channel.channel_type = 'direct_message'
        then 'Private direct message'
      when channel.channel_type = 'group_direct_message'
        then 'Private group message'
      when channel.channel_type = 'general'
        then 'Adjudicators + Advisory + Program Managers + Owners'
      when channel.channel_type = 'school_dm'
        then 'School + Owners'
      when channel.channel_type = 'school'
        then 'Assigned panel + Owners'
      else channel.visibility_label
    end as visibility_label
  from public.get_my_chat_channels_v2() channel
  where auth.uid() is not null
  order by
    channel_group_order,
    case when channel.unread_count > 0 then 0 else 1 end,
    channel.last_activity_at desc,
    channel.channel_name;
$$;

revoke all on function public.get_my_chat_channels_v3()
from public, anon;
grant execute on function public.get_my_chat_channels_v3()
to authenticated;

commit;

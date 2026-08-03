-- Program Manager operations access and private scholarship conversations.
-- Run after 20260803173346_add_program_manager_role.sql.

begin;

-- Program Managers are privileged staff and follow the same MFA baseline as
-- Advisory Committee members and Owners.
update public.profiles
set
  mfa_required = true,
  mfa_grace_until = coalesce(mfa_grace_until, now() + interval '14 days'),
  updated_at = now()
where role = 'program_manager';

create or replace function public.apply_profile_security_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.phone_e164 is not null and new.phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Phone numbers must use international E.164 format.';
  end if;

  if new.role in ('owner', 'advisory_member', 'program_manager') then
    new.mfa_required := true;
    if tg_op = 'INSERT' then
      new.mfa_grace_until := coalesce(
        new.mfa_grace_until,
        now() + interval '14 days'
      );
    elsif old.role is distinct from new.role then
      new.mfa_grace_until := now() + interval '14 days';
    else
      new.mfa_grace_until := coalesce(
        new.mfa_grace_until,
        now() + interval '14 days'
      );
    end if;
  end if;

  return new;
end;
$$;

-- Program Managers can review submitted operational records, but not drafts
-- or archived applications. Application mutation policies remain Owner and
-- applicant-only.
drop policy if exists "program managers read submitted applications"
on public.applications;

create policy "program managers read submitted applications"
on public.applications
for select
to authenticated
using (
  (select public.current_user_role()) = 'program_manager'
  and is_archived = false
  and status in ('submitted', 'under_review', 'complete')
);

-- Preserve all existing Advisory/Owner and school-member release access while
-- allowing Program Managers to see only the immutable released snapshots.
drop policy if exists "elevated read releases applicants read own released snapshot"
on public.adjudication_releases;

create policy "elevated read releases applicants read own released snapshot"
on public.adjudication_releases
for select
to authenticated
using (
  (select public.current_user_role()) in ('advisory_member', 'owner')
  or (
    (scores_released_at is not null or feedback_released_at is not null)
    and (
      (select public.current_user_role()) = 'program_manager'
      or public.is_application_member(application_id, (select auth.uid()))
    )
  )
);

-- Scheduling remains an operational read-only area for Program Managers. The
-- existing mutation functions continue to accept only their original roles.
drop policy if exists "authenticated read visible schedule slots"
on public.schedule_slots;

create policy "authenticated read visible schedule slots"
on public.schedule_slots
for select
to authenticated
using (
  (select public.current_user_role()) = 'owner'
  or (
    (select public.current_user_role()) in (
      'adjudicator',
      'advisory_member',
      'program_manager'
    )
    and status in ('open', 'closed', 'cancelled')
  )
  or (
    (select public.current_user_role()) = 'applicant'
    and (
      exists (
        select 1
        from public.schedule_school_bookings booking
        where booking.slot_id = schedule_slots.id
          and public.is_application_member(
            booking.application_id,
            (select auth.uid())
          )
      )
      or (
        status = 'open'
        and starts_at > now()
        and school_booking_opens_at is not null
        and school_booking_opens_at <= now()
        and (
          school_booking_closes_at is null
          or school_booking_closes_at > now()
        )
      )
    )
  )
);

create or replace function public.get_schedule_bookings_for_staff()
returns table (
  booking_id uuid,
  slot_id uuid,
  application_id uuid,
  cycle_id uuid,
  school_name text,
  production_title text,
  application_status public.application_status,
  booked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in (
    'adjudicator',
    'advisory_member',
    'program_manager',
    'owner'
  ) then
    raise exception 'Staff access required.';
  end if;

  return query
  select
    booking.id,
    booking.slot_id,
    application.id,
    application.cycle_id,
    application.school_name,
    application.production_title,
    application.status,
    booking.booked_at
  from public.schedule_school_bookings booking
  join public.applications application
    on application.id = booking.application_id;
end;
$$;

revoke all on function public.get_schedule_bookings_for_staff()
from public, anon;
grant execute on function public.get_schedule_bookings_for_staff()
to authenticated;

create or replace function public.get_schedule_staff_directory()
returns table (
  enrollment_id uuid,
  slot_id uuid,
  user_id uuid,
  full_name text,
  email text,
  role public.app_role,
  participation_mode text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in (
    'adjudicator',
    'advisory_member',
    'program_manager',
    'owner'
  ) then
    raise exception 'Staff access required.';
  end if;

  return query
  select
    enrollment.id,
    enrollment.slot_id,
    profile.id,
    profile.full_name,
    profile.email,
    enrollment.joined_as,
    enrollment.participation_mode,
    enrollment.joined_at
  from public.schedule_slot_staff enrollment
  join public.profiles profile
    on profile.id = enrollment.user_id
  where profile.active = true;
end;
$$;

revoke all on function public.get_schedule_staff_directory()
from public, anon;
grant execute on function public.get_schedule_staff_directory()
to authenticated;

create or replace function public.can_read_schedule_school_details(
  p_slot_id uuid,
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
    from public.profiles profile
    where profile.id = p_user_id
      and profile.active = true
      and (
        profile.role in ('owner', 'program_manager')
        or exists (
          select 1
          from public.schedule_slot_staff staff
          where staff.slot_id = p_slot_id
            and staff.user_id = p_user_id
        )
        or exists (
          select 1
          from public.schedule_school_bookings booking
          where booking.slot_id = p_slot_id
            and public.is_application_member(
              booking.application_id,
              p_user_id
            )
        )
      )
  );
$$;

revoke all on function public.can_read_schedule_school_details(uuid, uuid)
from public, anon;
grant execute on function public.can_read_schedule_school_details(uuid, uuid)
to authenticated;

-- Add a dedicated application-scoped channel type for scholarship applicants.
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
      'advisory_committee'
    )
  );

alter table public.chat_channels
  drop constraint if exists chat_channels_application_type_check;

alter table public.chat_channels
  add constraint chat_channels_application_type_check check (
    (
      channel_type in ('school', 'school_dm', 'scholarship_dm')
      and application_id is not null
    )
    or
    (
      channel_type not in ('school', 'school_dm', 'scholarship_dm')
      and application_id is null
    )
  );

create or replace function public.sync_scholarship_application_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_program_type text;
  applicant_display_name text;
begin
  select cycle.program_type::text
  into selected_program_type
  from public.award_cycles cycle
  where cycle.id = new.cycle_id;

  if selected_program_type = 'scholarship'
     and new.status in ('submitted', 'under_review', 'complete') then
    applicant_display_name := coalesce(
      nullif(trim(new.external_applicant_name), ''),
      nullif(trim(new.school_name), ''),
      'Scholarship Applicant'
    );

    update public.chat_channels
    set
      name = applicant_display_name || ' — Scholarship Applicant',
      description = 'Private scholarship application conversation for the applicant, Program Managers, and Owners.',
      active = true,
      updated_at = now()
    where application_id = new.id
      and channel_type = 'scholarship_dm';

    if not found then
      insert into public.chat_channels (
        channel_type,
        name,
        description,
        application_id,
        active
      ) values (
        'scholarship_dm',
        applicant_display_name || ' — Scholarship Applicant',
        'Private scholarship application conversation for the applicant, Program Managers, and Owners.',
        new.id,
        true
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_scholarship_application_chat()
from public, anon, authenticated;

drop trigger if exists applications_sync_scholarship_chat
on public.applications;

create trigger applications_sync_scholarship_chat
after insert or update of
  status,
  school_name,
  external_applicant_name,
  cycle_id,
  is_archived
on public.applications
for each row
execute function public.sync_scholarship_application_chat();

-- Backfill conversations for scholarship applications that were already
-- submitted before this role shipped.
insert into public.chat_channels (
  channel_type,
  name,
  description,
  application_id,
  active
)
select
  'scholarship_dm',
  coalesce(
    nullif(trim(application.external_applicant_name), ''),
    nullif(trim(application.school_name), ''),
    'Scholarship Applicant'
  ) || ' — Scholarship Applicant',
  'Private scholarship application conversation for the applicant, Program Managers, and Owners.',
  application.id,
  true
from public.applications application
join public.award_cycles cycle
  on cycle.id = application.cycle_id
where cycle.program_type = 'scholarship'
  and application.status in ('submitted', 'under_review', 'complete')
on conflict (application_id, channel_type)
where application_id is not null
do update set
  name = excluded.name,
  description = excluded.description,
  active = true,
  updated_at = now();

-- This function is the database authorization boundary for every chat RLS
-- policy. Program Managers receive General Announcements and scholarship DMs,
-- but never school, panel, Advisory, community, or adjudicator-network access.
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

-- Enrich the existing chat listing without duplicating its message/unread
-- logic. Scholarship chats receive a dedicated collapsible navigation group.
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
      else channel.channel_group
    end as channel_group,
    case
      when channel.application_archived
        then 'Archived conversations'
      when channel.channel_type = 'scholarship_dm'
        then 'Scholarship Applicants'
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
      when channel.channel_type = 'scholarship_dm' then 15
      else channel.channel_group_order
    end as channel_group_order,
    case
      when channel.channel_type = 'scholarship_dm'
        then 'Applicant + Program Managers + Owners'
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

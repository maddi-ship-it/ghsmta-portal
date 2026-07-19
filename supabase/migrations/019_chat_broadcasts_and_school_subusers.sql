-- GHSMTA Portal: archived chat controls, Owner DM broadcasts, and school sub-users.
-- Run after migration 018.

-- ---------------------------------------------------------------------------
-- Shared school application accounts
-- ---------------------------------------------------------------------------

create table if not exists public.application_members (
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'collaborator' check (
    member_role in ('primary', 'collaborator')
  ),
  can_edit_application boolean not null default true,
  can_manage_members boolean not null default false,
  active boolean not null default true,
  invited_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (application_id, user_id)
);

create index if not exists application_members_user_idx
  on public.application_members(user_id, active, application_id);

create index if not exists application_members_application_idx
  on public.application_members(application_id, active, member_role);

drop trigger if exists application_members_set_updated_at
on public.application_members;
create trigger application_members_set_updated_at
before update on public.application_members
for each row execute function public.set_updated_at();

-- Every existing linked applicant becomes the primary school account member.
insert into public.application_members (
  application_id,
  user_id,
  member_role,
  can_edit_application,
  can_manage_members,
  active,
  invited_by,
  joined_at
)
select
  application.id,
  application.applicant_user_id,
  'primary',
  true,
  true,
  true,
  application.applicant_user_id,
  application.created_at
from public.applications application
where application.applicant_user_id is not null
on conflict (application_id, user_id) do update set
  member_role = 'primary',
  can_edit_application = true,
  can_manage_members = true,
  active = true,
  removed_at = null,
  updated_at = now();

create or replace function public.is_application_member(
  p_application_id uuid,
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
    from public.application_members member
    join public.profiles profile
      on profile.id = member.user_id
    where member.application_id = p_application_id
      and member.user_id = p_user_id
      and member.active = true
      and profile.active = true
      and profile.role = 'applicant'
  );
$$;

grant execute on function public.is_application_member(uuid, uuid)
to authenticated;

create or replace function public.can_edit_application(
  p_application_id uuid,
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
    from public.application_members member
    join public.profiles profile
      on profile.id = member.user_id
    join public.applications application
      on application.id = member.application_id
    where member.application_id = p_application_id
      and member.user_id = p_user_id
      and member.active = true
      and member.can_edit_application = true
      and profile.active = true
      and profile.role = 'applicant'
      and coalesce(application.is_archived, false) = false
  );
$$;

grant execute on function public.can_edit_application(uuid, uuid)
to authenticated;

create or replace function public.can_manage_application_members(
  p_application_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or exists (
      select 1
      from public.application_members member
      join public.profiles profile
        on profile.id = member.user_id
      join public.applications application
        on application.id = member.application_id
      where member.application_id = p_application_id
        and member.user_id = p_user_id
        and member.active = true
        and member.can_manage_members = true
        and profile.active = true
        and profile.role = 'applicant'
        and coalesce(application.is_archived, false) = false
    );
$$;

grant execute on function public.can_manage_application_members(uuid, uuid)
to authenticated;

alter table public.application_members enable row level security;
grant select on public.application_members to authenticated;

drop policy if exists "application members read their school teams"
on public.application_members;
create policy "application members read their school teams"
on public.application_members for select to authenticated
using (
  public.current_user_role() = 'owner'
  or public.is_application_member(application_id, auth.uid())
);

-- Keep a primary membership synchronized when an application's main account
-- changes. Collaborators remain attached until explicitly removed.
create or replace function public.sync_primary_application_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.applicant_user_id is distinct from new.applicant_user_id
     and old.applicant_user_id is not null then
    update public.application_members
    set
      member_role = 'collaborator',
      can_manage_members = false,
      updated_at = now()
    where application_id = new.id
      and user_id = old.applicant_user_id;
  end if;

  if new.applicant_user_id is not null then
    insert into public.application_members (
      application_id,
      user_id,
      member_role,
      can_edit_application,
      can_manage_members,
      active,
      invited_by,
      joined_at
    ) values (
      new.id,
      new.applicant_user_id,
      'primary',
      true,
      true,
      true,
      new.applicant_user_id,
      now()
    )
    on conflict (application_id, user_id) do update set
      member_role = 'primary',
      can_edit_application = true,
      can_manage_members = true,
      active = true,
      removed_at = null,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists applications_sync_primary_member
on public.applications;
create trigger applications_sync_primary_member
after insert or update of applicant_user_id
on public.applications
for each row execute function public.sync_primary_application_member();

create or replace function public.refresh_school_dm_state(
  p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_active_member boolean;
  selected_application public.applications%rowtype;
begin
  select *
  into selected_application
  from public.applications
  where id = p_application_id;

  if selected_application.id is null then
    return;
  end if;

  select exists (
    select 1
    from public.application_members member
    join public.profiles profile on profile.id = member.user_id
    where member.application_id = p_application_id
      and member.active = true
      and profile.active = true
      and profile.role = 'applicant'
  ) into has_active_member;

  update public.chat_channels
  set
    name = selected_application.school_name || ' — Owner DM',
    description = 'Private messages between this school team and GHSMTA owners.',
    active = has_active_member,
    updated_at = now()
  where application_id = p_application_id
    and channel_type = 'school_dm';

  if not found and has_active_member then
    insert into public.chat_channels (
      channel_type,
      name,
      description,
      application_id,
      active
    ) values (
      'school_dm',
      selected_application.school_name || ' — Owner DM',
      'Private messages between this school team and GHSMTA owners.',
      p_application_id,
      true
    );
  end if;
end;
$$;

create or replace function public.sync_application_chat_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_channels
  set
    name = new.school_name || ' — School Staff',
    description = 'Internal school channel for assigned adjudicators, advisory committee members, and owners.',
    active = true,
    updated_at = now()
  where application_id = new.id
    and channel_type = 'school';

  if not found then
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
    );
  end if;

  perform public.refresh_school_dm_state(new.id);
  return new;
end;
$$;

create or replace function public.sync_application_member_chat_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_school_dm_state(
    case when tg_op = 'DELETE' then old.application_id else new.application_id end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists application_members_sync_chat_access
on public.application_members;
create trigger application_members_sync_chat_access
after insert or update of active or delete
on public.application_members
for each row execute function public.sync_application_member_chat_access();

-- Refresh all current DMs now that membership is authoritative.
do $$
declare
  application_record record;
begin
  for application_record in select id from public.applications loop
    perform public.refresh_school_dm_state(application_record.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Application access policies for collaborators
-- ---------------------------------------------------------------------------

drop policy if exists "role scoped application read"
on public.applications;
create policy "role scoped application read"
on public.applications for select to authenticated
using (
  public.is_application_member(id, auth.uid())
  or public.current_user_role() in ('advisory_member', 'owner')
  or exists (
    select 1
    from public.adjudicator_assignments assignment
    where assignment.application_id = applications.id
      and assignment.adjudicator_user_id = auth.uid()
      and assignment.removed_at is null
  )
);

drop policy if exists "applicant draft or owner application update"
on public.applications;
create policy "applicant draft or owner application update"
on public.applications for update to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'applicant'
    and public.can_edit_application(id, auth.uid())
    and status = 'draft'
  )
)
with check (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'applicant'
    and public.can_edit_application(id, auth.uid())
    and status in ('draft', 'submitted')
  )
);

drop policy if exists "applicants or owners insert answers"
on public.application_answers;
create policy "applicants or owners insert answers"
on public.application_answers for insert to authenticated
with check (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications application
    where application.id = application_answers.application_id
      and application.status = 'draft'
      and public.can_edit_application(application.id, auth.uid())
  )
);

drop policy if exists "applicants or owners update answers"
on public.application_answers;
create policy "applicants or owners update answers"
on public.application_answers for update to authenticated
using (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications application
    where application.id = application_answers.application_id
      and application.status = 'draft'
      and public.can_edit_application(application.id, auth.uid())
  )
)
with check (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications application
    where application.id = application_answers.application_id
      and application.status = 'draft'
      and public.can_edit_application(application.id, auth.uid())
  )
);

drop policy if exists "applicants or owners delete answers"
on public.application_answers;
create policy "applicants or owners delete answers"
on public.application_answers for delete to authenticated
using (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications application
    where application.id = application_answers.application_id
      and application.status = 'draft'
      and public.can_edit_application(application.id, auth.uid())
  )
);

drop policy if exists "owners manage stage progress insert"
on public.application_stage_progress;
create policy "owners manage stage progress insert"
on public.application_stage_progress for insert to authenticated
with check (
  public.current_user_role() = 'owner'
  or public.can_edit_application(application_id, auth.uid())
);

drop policy if exists "owners manage stage progress update"
on public.application_stage_progress;
create policy "owners manage stage progress update"
on public.application_stage_progress for update to authenticated
using (
  public.current_user_role() = 'owner'
  or public.can_edit_application(application_id, auth.uid())
)
with check (
  public.current_user_role() = 'owner'
  or public.can_edit_application(application_id, auth.uid())
);

-- Appeals and released results follow the shared school account.
drop policy if exists "applicants create own appeals"
on public.appeals;
create policy "applicants create own appeals"
on public.appeals for insert to authenticated
with check (
  submitted_by = auth.uid()
  and public.is_application_member(application_id, auth.uid())
);

drop policy if exists "appeal participants read appeals"
on public.appeals;
create policy "appeal participants read appeals"
on public.appeals for select to authenticated
using (
  public.current_user_role() in ('advisory_member', 'owner')
  or public.is_application_member(application_id, auth.uid())
);

drop policy if exists "elevated read releases applicants read own released snapshot"
on public.adjudication_releases;
create policy "elevated read releases applicants read own released snapshot"
on public.adjudication_releases for select to authenticated
using (
  public.current_user_role() in ('advisory_member', 'owner')
  or (
    (scores_released_at is not null or feedback_released_at is not null)
    and public.is_application_member(application_id, auth.uid())
  )
);

drop policy if exists "context participants read portal files"
on public.portal_files;
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
    and public.is_application_member(application_id, auth.uid())
  )
);

drop policy if exists "portal file participants read storage"
on storage.objects;
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
        or (
          file.context_type = 'appeal'
          and public.current_user_role() = 'advisory_member'
        )
        or (
          file.application_id is not null
          and public.is_application_member(file.application_id, auth.uid())
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- Scheduling access for all active school team members
-- ---------------------------------------------------------------------------

create or replace function public.get_schedule_slot_availability()
returns table (
  slot_id uuid,
  is_booked boolean,
  is_mine boolean,
  my_application_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'applicant' then
    raise exception 'Applicant access required.';
  end if;

  return query
  select
    slot.id,
    booking.id is not null,
    coalesce(public.is_application_member(application.id, auth.uid()), false),
    case
      when public.is_application_member(application.id, auth.uid())
        then application.id
      else null
    end
  from public.schedule_slots slot
  left join public.schedule_school_bookings booking
    on booking.slot_id = slot.id
  left join public.applications application
    on application.id = booking.application_id
  where
    public.is_application_member(application.id, auth.uid())
    or (
      slot.status = 'open'
      and slot.starts_at > now()
      and slot.school_booking_opens_at is not null
      and slot.school_booking_opens_at <= now()
      and (
        slot.school_booking_closes_at is null
        or slot.school_booking_closes_at > now()
      )
    );
end;
$$;

grant execute on function public.get_schedule_slot_availability()
to authenticated;

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

  if exists (
    select 1
    from public.schedule_school_bookings booking
    where booking.slot_id = p_slot_id
  ) then
    raise exception 'Another school has already selected this slot.';
  end if;

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

  return booking_id;
end;
$$;

grant execute on function public.book_schedule_slot(uuid, uuid)
to authenticated;

drop policy if exists "authenticated read visible schedule slots"
on public.schedule_slots;
create policy "authenticated read visible schedule slots"
on public.schedule_slots for select to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() in ('adjudicator', 'advisory_member')
    and status in ('open', 'closed', 'cancelled')
  )
  or (
    public.current_user_role() = 'applicant'
    and (
      exists (
        select 1
        from public.schedule_school_bookings booking
        where booking.slot_id = schedule_slots.id
          and public.is_application_member(booking.application_id, auth.uid())
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

create or replace function public.can_read_schedule_school_details(
  p_slot_id uuid,
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
    from public.profiles profile
    where profile.id = p_user_id
      and profile.active = true
      and (
        profile.role = 'owner'
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
            and public.is_application_member(booking.application_id, p_user_id)
        )
      )
  );
$$;

grant execute on function public.can_read_schedule_school_details(uuid, uuid)
to authenticated;

create or replace function public.update_own_schedule_school_details(
  p_slot_id uuid,
  p_venue_name text,
  p_venue_address text,
  p_arrival_entrance text,
  p_parking_instructions text,
  p_accessibility_notes text,
  p_wifi_network text,
  p_wifi_password text,
  p_day_of_contact_name text,
  p_day_of_contact_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  details_deadline timestamptz;
  slot_start timestamptz;
begin
  if public.current_user_role() <> 'applicant' then
    raise exception 'Only school applicants can update school schedule details.';
  end if;

  if not exists (
    select 1
    from public.schedule_school_bookings booking
    join public.applications application
      on application.id = booking.application_id
    where booking.slot_id = p_slot_id
      and public.can_edit_application(application.id, auth.uid())
      and coalesce(application.is_archived, false) = false
  ) then
    raise exception 'This schedule slot is not booked by your school or your account is view-only.';
  end if;

  select details.edit_deadline, slot.starts_at
  into details_deadline, slot_start
  from public.schedule_slots slot
  left join public.schedule_slot_school_details details
    on details.slot_id = slot.id
  where slot.id = p_slot_id;

  if slot_start is null then
    raise exception 'Schedule slot not found.';
  end if;

  if now() >= coalesce(details_deadline, slot_start) then
    raise exception 'The school information edit window has closed.';
  end if;

  insert into public.schedule_slot_school_details (
    slot_id,
    venue_name,
    venue_address,
    arrival_entrance,
    parking_instructions,
    accessibility_notes,
    wifi_network,
    wifi_password,
    day_of_contact_name,
    day_of_contact_phone,
    updated_by
  ) values (
    p_slot_id,
    nullif(trim(p_venue_name), ''),
    nullif(trim(p_venue_address), ''),
    nullif(trim(p_arrival_entrance), ''),
    nullif(trim(p_parking_instructions), ''),
    nullif(trim(p_accessibility_notes), ''),
    nullif(trim(p_wifi_network), ''),
    nullif(trim(p_wifi_password), ''),
    nullif(trim(p_day_of_contact_name), ''),
    nullif(trim(p_day_of_contact_phone), ''),
    auth.uid()
  )
  on conflict (slot_id) do update set
    venue_name = excluded.venue_name,
    venue_address = excluded.venue_address,
    arrival_entrance = excluded.arrival_entrance,
    parking_instructions = excluded.parking_instructions,
    accessibility_notes = excluded.accessibility_notes,
    wifi_network = excluded.wifi_network,
    wifi_password = excluded.wifi_password,
    day_of_contact_name = excluded.day_of_contact_name,
    day_of_contact_phone = excluded.day_of_contact_phone,
    updated_by = auth.uid(),
    updated_at = now();
end;
$$;

grant execute on function public.update_own_schedule_school_details(
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Chat access, archived visibility, and Owner broadcasts
-- ---------------------------------------------------------------------------

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

    select member.user_id
    from selected_channel channel
    join public.application_members member
      on member.application_id = channel.application_id
    join public.profiles profile
      on profile.id = member.user_id
    where channel.channel_type = 'school_dm'
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
    coalesce(nullif(trim(profile.full_name), ''), profile.email, 'Portal user'),
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

create table if not exists public.chat_broadcasts (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 5000),
  sent_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  channel_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.chat_broadcasts enable row level security;
grant select on public.chat_broadcasts to authenticated;

drop policy if exists "owners read chat broadcasts"
on public.chat_broadcasts;
create policy "owners read chat broadcasts"
on public.chat_broadcasts for select to authenticated
using (public.current_user_role() = 'owner');

create or replace function public.broadcast_to_active_school_dms(
  p_body text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_body text;
  broadcast_id uuid;
  inserted_count integer;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only Owners can send a school-wide DM broadcast.';
  end if;

  normalized_body := trim(p_body);
  if normalized_body = '' then
    raise exception 'Enter a message before sending.';
  end if;

  if char_length(normalized_body) > 5000 then
    raise exception 'The broadcast message is longer than the allowed limit.';
  end if;

  insert into public.chat_broadcasts (body, sent_by)
  values (normalized_body, auth.uid())
  returning id into broadcast_id;

  insert into public.chat_posts (
    channel_id,
    author_id,
    subject,
    body
  )
  select
    channel.id,
    auth.uid(),
    'Message',
    normalized_body
  from public.chat_channels channel
  join public.applications application
    on application.id = channel.application_id
  where channel.channel_type = 'school_dm'
    and channel.active = true
    and coalesce(application.is_archived, false) = false
    and exists (
      select 1
      from public.application_members member
      join public.profiles profile on profile.id = member.user_id
      where member.application_id = application.id
        and member.active = true
        and profile.active = true
        and profile.role = 'applicant'
    );

  get diagnostics inserted_count = row_count;

  update public.chat_broadcasts
  set channel_count = inserted_count
  where id = broadcast_id;

  insert into public.owner_activity_log (
    activity_type,
    title,
    detail,
    actor_id,
    metadata
  ) values (
    'chat_broadcast',
    'School DM broadcast sent',
    normalized_body,
    auth.uid(),
    jsonb_build_object(
      'broadcast_id', broadcast_id,
      'channel_count', inserted_count
    )
  );

  return inserted_count;
end;
$$;

grant execute on function public.broadcast_to_active_school_dms(text)
to authenticated;

-- Archived application conversations remain available to Owners, but they do
-- not inflate the normal portal unread badge until explicitly opened.
create or replace function public.get_unread_portal_counts()
returns table (
  notification_count bigint,
  chat_message_count bigint,
  chat_channel_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with channels as (
    select *
    from public.get_my_chat_channels_v2()
    where application_archived = false
  )
  select
    (
      select count(*)::bigint
      from public.user_notifications notification
      where notification.user_id = auth.uid()
        and notification.read_at is null
    ),
    coalesce((select sum(channel.unread_count) from channels channel), 0)::bigint,
    coalesce((select count(*) from channels channel where channel.unread_count > 0), 0)::bigint;
$$;

grant execute on function public.get_unread_portal_counts()
to authenticated;

-- ---------------------------------------------------------------------------
-- School team workspace RPC
-- ---------------------------------------------------------------------------

create or replace function public.get_my_school_team_workspace()
returns table (
  application_id uuid,
  school_name text,
  production_title text,
  application_archived boolean,
  user_id uuid,
  display_name text,
  email text,
  member_role text,
  can_edit_application boolean,
  can_manage_members boolean,
  member_active boolean,
  joined_at timestamptz,
  current_user_can_manage boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'applicant' then
    raise exception 'Applicant access required.';
  end if;

  return query
  select
    application.id,
    application.school_name,
    application.production_title,
    coalesce(application.is_archived, false),
    profile.id,
    coalesce(nullif(trim(profile.full_name), ''), profile.email, 'Portal user'),
    profile.email,
    member.member_role,
    member.can_edit_application,
    member.can_manage_members,
    member.active,
    member.joined_at,
    public.can_manage_application_members(application.id, auth.uid())
  from public.applications application
  join public.application_members current_member
    on current_member.application_id = application.id
   and current_member.user_id = auth.uid()
   and current_member.active = true
  join public.application_members member
    on member.application_id = application.id
  join public.profiles profile
    on profile.id = member.user_id
  order by
    application.is_archived,
    application.school_name,
    case member.member_role when 'primary' then 1 else 2 end,
    coalesce(profile.full_name, profile.email);
end;
$$;

grant execute on function public.get_my_school_team_workspace()
to authenticated;

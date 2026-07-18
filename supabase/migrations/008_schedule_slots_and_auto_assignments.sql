-- GHSMTA Portal: school scheduling, reviewer self-enrollment, privacy-safe
-- schedule visibility, and automatic adjudicator scoring assignments.
-- Run after migrations 001-007.

create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.award_cycles(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  school_instructions text,
  status text not null default 'open',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (status in ('draft', 'open', 'closed', 'cancelled'))
);

create table if not exists public.schedule_school_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.schedule_slots(id) on delete cascade,
  application_id uuid not null unique references public.applications(id) on delete cascade,
  booked_by uuid references public.profiles(id) on delete set null default auth.uid(),
  booked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_slot_staff (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.schedule_slots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_as public.app_role not null,
  joined_by uuid references public.profiles(id) on delete set null default auth.uid(),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (slot_id, user_id),
  check (joined_as in ('adjudicator', 'advisory_member'))
);

alter table public.adjudicator_assignments
  add column if not exists schedule_slot_id uuid
  references public.schedule_slots(id) on delete set null;

create index if not exists schedule_slots_cycle_start_idx
  on public.schedule_slots(cycle_id, starts_at);
create index if not exists schedule_slots_status_start_idx
  on public.schedule_slots(status, starts_at);
create index if not exists schedule_school_bookings_application_idx
  on public.schedule_school_bookings(application_id);
create index if not exists schedule_slot_staff_slot_idx
  on public.schedule_slot_staff(slot_id, joined_at);
create index if not exists schedule_slot_staff_user_idx
  on public.schedule_slot_staff(user_id, joined_at);
create index if not exists adjudicator_assignments_schedule_slot_idx
  on public.adjudicator_assignments(schedule_slot_id);

drop trigger if exists schedule_slots_set_updated_at on public.schedule_slots;
create trigger schedule_slots_set_updated_at
before update on public.schedule_slots
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Automatic scoring assignments
-- ---------------------------------------------------------------------------

create or replace function public.upsert_schedule_adjudicator_assignment(
  p_slot_id uuid,
  p_application_id uuid,
  p_adjudicator_user_id uuid,
  p_assigned_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.adjudicator_assignments (
    application_id,
    adjudicator_user_id,
    assigned_by,
    status,
    schedule_slot_id,
    internal_notes
  ) values (
    p_application_id,
    p_adjudicator_user_id,
    p_assigned_by,
    'assigned',
    p_slot_id,
    'Automatically assigned from schedule enrollment.'
  )
  on conflict (application_id, adjudicator_user_id) do update set
    schedule_slot_id = excluded.schedule_slot_id,
    assigned_by = coalesce(
      public.adjudicator_assignments.assigned_by,
      excluded.assigned_by
    ),
    internal_notes = coalesce(
      public.adjudicator_assignments.internal_notes,
      excluded.internal_notes
    );
end;
$$;

revoke all on function public.upsert_schedule_adjudicator_assignment(uuid, uuid, uuid, uuid)
from public, anon, authenticated;

create or replace function public.schedule_booking_assign_adjudicators()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_member record;
begin
  for staff_member in
    select user_id
    from public.schedule_slot_staff
    where slot_id = new.slot_id
      and joined_as = 'adjudicator'
  loop
    perform public.upsert_schedule_adjudicator_assignment(
      new.slot_id,
      new.application_id,
      staff_member.user_id,
      new.booked_by
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists schedule_booking_assign_adjudicators
on public.schedule_school_bookings;
create trigger schedule_booking_assign_adjudicators
after insert on public.schedule_school_bookings
for each row execute function public.schedule_booking_assign_adjudicators();

create or replace function public.schedule_staff_assign_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  booked_application_id uuid;
begin
  if new.joined_as <> 'adjudicator' then
    return new;
  end if;

  select application_id
  into booked_application_id
  from public.schedule_school_bookings
  where slot_id = new.slot_id;

  if booked_application_id is not null then
    perform public.upsert_schedule_adjudicator_assignment(
      new.slot_id,
      booked_application_id,
      new.user_id,
      new.joined_by
    );
  end if;

  return new;
end;
$$;

drop trigger if exists schedule_staff_assign_application
on public.schedule_slot_staff;
create trigger schedule_staff_assign_application
after insert on public.schedule_slot_staff
for each row execute function public.schedule_staff_assign_application();

-- Owner removal should remove untouched auto-assignments, but never erase
-- scorecards or entered scoring work.
create or replace function public.schedule_staff_remove_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  booked_application_id uuid;
  selected_assignment_id uuid;
begin
  if old.joined_as <> 'adjudicator' then
    return old;
  end if;

  select application_id
  into booked_application_id
  from public.schedule_school_bookings
  where slot_id = old.slot_id;

  if booked_application_id is null then
    return old;
  end if;

  select id
  into selected_assignment_id
  from public.adjudicator_assignments
  where application_id = booked_application_id
    and adjudicator_user_id = old.user_id
    and schedule_slot_id = old.slot_id;

  if selected_assignment_id is null then
    return old;
  end if;

  if exists (
    select 1
    from public.adjudication_scorecards
    where assignment_id = selected_assignment_id
  ) then
    update public.adjudicator_assignments
    set schedule_slot_id = null
    where id = selected_assignment_id;
  else
    delete from public.adjudicator_assignments
    where id = selected_assignment_id;
  end if;

  return old;
end;
$$;

drop trigger if exists schedule_staff_remove_assignment
on public.schedule_slot_staff;
create trigger schedule_staff_remove_assignment
after delete on public.schedule_slot_staff
for each row execute function public.schedule_staff_remove_assignment();

create or replace function public.schedule_booking_remove_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_assignment record;
begin
  for selected_assignment in
    select id
    from public.adjudicator_assignments
    where application_id = old.application_id
      and schedule_slot_id = old.slot_id
  loop
    if exists (
      select 1
      from public.adjudication_scorecards
      where assignment_id = selected_assignment.id
    ) then
      update public.adjudicator_assignments
      set schedule_slot_id = null
      where id = selected_assignment.id;
    else
      delete from public.adjudicator_assignments
      where id = selected_assignment.id;
    end if;
  end loop;

  return old;
end;
$$;

drop trigger if exists schedule_booking_remove_assignments
on public.schedule_school_bookings;
create trigger schedule_booking_remove_assignments
after delete on public.schedule_school_bookings
for each row execute function public.schedule_booking_remove_assignments();

-- ---------------------------------------------------------------------------
-- Privacy-safe schedule RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_schedule_slot_availability()
returns table (
  slot_id uuid,
  is_booked boolean,
  is_mine boolean,
  my_application_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    slot.id as slot_id,
    booking.id is not null as is_booked,
    coalesce(application.applicant_user_id = auth.uid(), false) as is_mine,
    case
      when application.applicant_user_id = auth.uid()
        then application.id
      else null
    end as my_application_id
  from public.schedule_slots slot
  left join public.schedule_school_bookings booking
    on booking.slot_id = slot.id
  left join public.applications application
    on application.id = booking.application_id
  where auth.uid() is not null;
$$;

grant execute on function public.get_schedule_slot_availability()
to authenticated;

create or replace function public.get_schedule_server_time()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select now();
$$;

grant execute on function public.get_schedule_server_time()
to authenticated;

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
set search_path = public
as $$
begin
  if public.current_user_role() not in (
    'adjudicator',
    'advisory_member',
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
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in (
    'adjudicator',
    'advisory_member',
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
    enrollment.joined_at
  from public.schedule_slot_staff enrollment
  join public.profiles profile
    on profile.id = enrollment.user_id
  where profile.active = true;
end;
$$;

grant execute on function public.get_schedule_staff_directory()
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

  select *
  into selected_slot
  from public.schedule_slots
  where id = p_slot_id
  for update;

  if selected_slot.id is null then
    raise exception 'Schedule slot not found.';
  end if;

  if selected_slot.status <> 'open' or selected_slot.starts_at <= now() then
    raise exception 'This schedule slot is no longer open.';
  end if;

  select *
  into selected_application
  from public.applications
  where id = p_application_id
    and applicant_user_id = auth.uid()
    and is_archived = false;

  if selected_application.id is null then
    raise exception 'Application not found.';
  end if;

  if selected_application.cycle_id <> selected_slot.cycle_id then
    raise exception 'This slot belongs to a different application program.';
  end if;

  if exists (
    select 1
    from public.schedule_school_bookings booking
    join public.applications application
      on application.id = booking.application_id
    where application.applicant_user_id = auth.uid()
  ) then
    raise exception 'Your school already has a schedule slot.';
  end if;

  if exists (
    select 1
    from public.schedule_school_bookings
    where slot_id = p_slot_id
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

create or replace function public.join_schedule_slot(
  p_slot_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role public.app_role;
  selected_slot public.schedule_slots%rowtype;
  enrollment_id uuid;
begin
  selected_role := public.current_user_role();

  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception 'Only adjudicators and advisory members can join schedule slots.';
  end if;

  select *
  into selected_slot
  from public.schedule_slots
  where id = p_slot_id;

  if selected_slot.id is null then
    raise exception 'Schedule slot not found.';
  end if;

  if selected_slot.status <> 'open' or selected_slot.starts_at <= now() then
    raise exception 'This schedule slot is no longer open.';
  end if;

  insert into public.schedule_slot_staff (
    slot_id,
    user_id,
    joined_as,
    joined_by
  ) values (
    p_slot_id,
    auth.uid(),
    selected_role,
    auth.uid()
  )
  on conflict (slot_id, user_id) do update
    set joined_as = excluded.joined_as
  returning id into enrollment_id;

  return enrollment_id;
end;
$$;

grant execute on function public.join_schedule_slot(uuid)
to authenticated;

create or replace function public.owner_book_schedule_slot(
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
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can schedule a school on its behalf.';
  end if;

  select * into selected_slot
  from public.schedule_slots
  where id = p_slot_id
  for update;

  select * into selected_application
  from public.applications
  where id = p_application_id
    and is_archived = false;

  if selected_slot.id is null or selected_application.id is null then
    raise exception 'Slot or application not found.';
  end if;

  if selected_application.cycle_id <> selected_slot.cycle_id then
    raise exception 'The application and slot must belong to the same program.';
  end if;

  if exists (
    select 1
    from public.schedule_school_bookings booking
    join public.applications application
      on application.id = booking.application_id
    where selected_application.applicant_user_id is not null
      and application.applicant_user_id = selected_application.applicant_user_id
  ) then
    raise exception 'This school account already has a schedule slot.';
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

grant execute on function public.owner_book_schedule_slot(uuid, uuid)
to authenticated;

create or replace function public.owner_add_schedule_staff(
  p_slot_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role public.app_role;
  enrollment_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can add another staff member.';
  end if;

  select role
  into selected_role
  from public.profiles
  where id = p_user_id
    and active = true;

  if selected_role not in ('adjudicator', 'advisory_member') then
    raise exception 'Choose an active adjudicator or advisory member.';
  end if;

  insert into public.schedule_slot_staff (
    slot_id,
    user_id,
    joined_as,
    joined_by
  ) values (
    p_slot_id,
    p_user_id,
    selected_role,
    auth.uid()
  )
  on conflict (slot_id, user_id) do update
    set joined_as = excluded.joined_as
  returning id into enrollment_id;

  return enrollment_id;
end;
$$;

grant execute on function public.owner_add_schedule_staff(uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.schedule_slots enable row level security;
alter table public.schedule_school_bookings enable row level security;
alter table public.schedule_slot_staff enable row level security;

drop policy if exists "authenticated read visible schedule slots"
on public.schedule_slots;
create policy "authenticated read visible schedule slots"
on public.schedule_slots for select to authenticated
using (
  public.current_user_role() = 'owner'
  or status in ('open', 'closed', 'cancelled')
);

drop policy if exists "owners insert schedule slots"
on public.schedule_slots;
create policy "owners insert schedule slots"
on public.schedule_slots for insert to authenticated
with check (public.current_user_role() = 'owner');

drop policy if exists "owners update schedule slots"
on public.schedule_slots;
create policy "owners update schedule slots"
on public.schedule_slots for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "owners delete schedule slots"
on public.schedule_slots;
create policy "owners delete schedule slots"
on public.schedule_slots for delete to authenticated
using (public.current_user_role() = 'owner');

drop policy if exists "role scoped schedule bookings read"
on public.schedule_school_bookings;
create policy "role scoped schedule bookings read"
on public.schedule_school_bookings for select to authenticated
using (
  public.current_user_role() in ('adjudicator', 'advisory_member', 'owner')
  or exists (
    select 1
    from public.applications application
    where application.id = schedule_school_bookings.application_id
      and application.applicant_user_id = auth.uid()
  )
);

drop policy if exists "owners remove school bookings"
on public.schedule_school_bookings;
create policy "owners remove school bookings"
on public.schedule_school_bookings for delete to authenticated
using (public.current_user_role() = 'owner');

drop policy if exists "staff read schedule enrollments"
on public.schedule_slot_staff;
create policy "staff read schedule enrollments"
on public.schedule_slot_staff for select to authenticated
using (
  public.current_user_role() in ('adjudicator', 'advisory_member', 'owner')
);

drop policy if exists "owners remove schedule enrollments"
on public.schedule_slot_staff;
create policy "owners remove schedule enrollments"
on public.schedule_slot_staff for delete to authenticated
using (public.current_user_role() = 'owner');

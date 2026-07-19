-- GHSMTA Portal: live schedule availability and high-concurrency booking safety.
-- Run after migrations 001-020.

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'schedule_slots'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.schedule_slots;
  END IF;
END
$$;

-- Every booking insert/delete touches the related slot. Schools can subscribe
-- only to schedule_slots, which exposes no competing school's identity, while
-- still receiving a realtime signal that availability changed.
create or replace function public.touch_schedule_slot_for_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.schedule_slots
    set updated_at = now()
    where id = old.slot_id;

    return old;
  end if;

  if tg_op = 'UPDATE' and old.slot_id is distinct from new.slot_id then
    update public.schedule_slots
    set updated_at = now()
    where id = old.slot_id;
  end if;

  update public.schedule_slots
  set updated_at = now()
  where id = new.slot_id;

  return new;
end;
$$;

revoke all on function public.touch_schedule_slot_for_realtime() from public;

drop trigger if exists schedule_bookings_touch_slot_realtime
on public.schedule_school_bookings;
create trigger schedule_bookings_touch_slot_realtime
after insert or update or delete
on public.schedule_school_bookings
for each row execute function public.touch_schedule_slot_for_realtime();

-- ---------------------------------------------------------------------------
-- Atomic school booking with friendly collision handling
-- ---------------------------------------------------------------------------

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

  -- Competing requests for the same slot serialize here. Once the first
  -- transaction commits, every later request sees the completed booking.
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


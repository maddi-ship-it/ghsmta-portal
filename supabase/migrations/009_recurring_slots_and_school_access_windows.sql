-- GHSMTA Portal: recurring schedule series and timed school booking windows.
-- Run after migration 008.

alter table public.schedule_slots
  add column if not exists school_booking_opens_at timestamptz,
  add column if not exists school_booking_closes_at timestamptz,
  add column if not exists series_id uuid,
  add column if not exists series_sequence integer;

-- Preserve the behavior of slots that were already open before this migration.
update public.schedule_slots
set school_booking_opens_at = coalesce(school_booking_opens_at, created_at)
where status = 'open'
  and school_booking_opens_at is null;

alter table public.schedule_slots
  drop constraint if exists schedule_slots_school_booking_window_check;

alter table public.schedule_slots
  add constraint schedule_slots_school_booking_window_check
  check (
    school_booking_closes_at is null
    or school_booking_opens_at is null
    or school_booking_closes_at > school_booking_opens_at
  );

create index if not exists schedule_slots_school_access_idx
  on public.schedule_slots(
    status,
    school_booking_opens_at,
    school_booking_closes_at,
    starts_at
  );

create index if not exists schedule_slots_series_idx
  on public.schedule_slots(series_id, series_sequence)
  where series_id is not null;

-- Applicants only receive availability records for slots they are allowed to
-- see, plus their own locked reservation after booking.
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
  where
    application.applicant_user_id = auth.uid()
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

-- School booking is enforced in the database so a future opening time cannot
-- be bypassed through a handcrafted API call.
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

  if selected_slot.school_booking_opens_at is null then
    raise exception 'This schedule slot has not been released to schools.';
  end if;

  if selected_slot.school_booking_opens_at > now() then
    raise exception 'School selection has not opened for this schedule slot.';
  end if;

  if (
    selected_slot.school_booking_closes_at is not null
    and selected_slot.school_booking_closes_at <= now()
  ) then
    raise exception 'School selection has closed for this schedule slot.';
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

-- Keep owner/staff visibility broad, while applicants see only an active
-- school-selection window or the slot they already booked.
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
        join public.applications application
          on application.id = booking.application_id
        where booking.slot_id = schedule_slots.id
          and application.applicant_user_id = auth.uid()
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

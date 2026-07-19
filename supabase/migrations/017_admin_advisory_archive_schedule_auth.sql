-- GHSMTA Portal: rubric versioning, application archive controls,
-- school-maintained schedule details, and forced password reset metadata.
-- Run after migration 016.

alter table public.applications
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.profiles
  add column if not exists force_password_reset boolean not null default false,
  add column if not exists password_reset_requested_at timestamptz;

create table if not exists public.schedule_slot_school_details (
  slot_id uuid primary key references public.schedule_slots(id) on delete cascade,
  venue_name text,
  venue_address text,
  arrival_entrance text,
  parking_instructions text,
  accessibility_notes text,
  wifi_network text,
  wifi_password text,
  day_of_contact_name text,
  day_of_contact_phone text,
  edit_deadline timestamptz,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists schedule_slot_school_details_set_updated_at
on public.schedule_slot_school_details;
create trigger schedule_slot_school_details_set_updated_at
before update on public.schedule_slot_school_details
for each row execute function public.set_updated_at();

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
          join public.applications application
            on application.id = booking.application_id
          where booking.slot_id = p_slot_id
            and application.applicant_user_id = p_user_id
        )
      )
  );
$$;

grant execute on function public.can_read_schedule_school_details(uuid, uuid)
to authenticated;

alter table public.schedule_slot_school_details enable row level security;

drop policy if exists "authorized read schedule school details"
on public.schedule_slot_school_details;
create policy "authorized read schedule school details"
on public.schedule_slot_school_details for select to authenticated
using (public.can_read_schedule_school_details(slot_id, auth.uid()));

drop policy if exists "owners manage schedule school details"
on public.schedule_slot_school_details;
create policy "owners manage schedule school details"
on public.schedule_slot_school_details for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

grant select, insert, update, delete
on public.schedule_slot_school_details to authenticated;

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
      and application.applicant_user_id = auth.uid()
      and coalesce(application.is_archived, false) = false
  ) then
    raise exception 'This schedule slot is not booked by your school.';
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

create or replace function public.set_application_archive_state(
  p_application_ids uuid[],
  p_archived boolean,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can archive applications.';
  end if;

  update public.applications
  set
    is_archived = p_archived,
    archived_at = case when p_archived then now() else null end,
    archived_by = case when p_archived then auth.uid() else null end,
    archive_reason = case when p_archived then nullif(trim(p_reason), '') else null end,
    updated_at = now()
  where id = any(p_application_ids);

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

grant execute on function public.set_application_archive_state(uuid[], boolean, text)
to authenticated;

create or replace function public.duplicate_scoring_rubric_version(
  p_source_rubric_id uuid,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_rubric public.scoring_rubrics%rowtype;
  next_version integer;
  new_rubric_id uuid;
  source_category record;
  new_category_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can duplicate scoring rubrics.';
  end if;

  select * into source_rubric
  from public.scoring_rubrics
  where id = p_source_rubric_id;

  if source_rubric.id is null then
    raise exception 'Source scoring rubric not found.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.scoring_rubrics
  where cycle_id = source_rubric.cycle_id;

  insert into public.scoring_rubrics (
    cycle_id, name, version_number, status, score_min, score_max, source_system
  ) values (
    source_rubric.cycle_id,
    coalesce(nullif(trim(p_name), ''), source_rubric.name || ' — Copy'),
    next_version,
    'draft',
    source_rubric.score_min,
    source_rubric.score_max,
    source_rubric.source_system
  ) returning id into new_rubric_id;

  insert into public.scoring_scale_levels (
    rubric_id, score, label, description, sort_order
  )
  select new_rubric_id, score, label, description, sort_order
  from public.scoring_scale_levels
  where rubric_id = source_rubric.id;

  for source_category in
    select *
    from public.scoring_categories
    where rubric_id = source_rubric.id
    order by sort_order, created_at
  loop
    insert into public.scoring_categories (
      rubric_id, category_key, title, description, guidance, subject_label,
      sort_order, required, allow_not_applicable, active
    ) values (
      new_rubric_id, source_category.category_key, source_category.title,
      source_category.description, source_category.guidance,
      source_category.subject_label, source_category.sort_order,
      source_category.required, source_category.allow_not_applicable,
      source_category.active
    ) returning id into new_category_id;

    insert into public.scoring_criteria (
      category_id, criterion_key, title, description, weight, sort_order, active
    )
    select new_category_id, criterion_key, title, description, weight,
      sort_order, active
    from public.scoring_criteria
    where category_id = source_category.id;
  end loop;

  return new_rubric_id;
end;
$$;

grant execute on function public.duplicate_scoring_rubric_version(uuid, text)
to authenticated;

create or replace function public.publish_scoring_rubric(
  p_rubric_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_rubric public.scoring_rubrics%rowtype;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can publish scoring rubrics.';
  end if;

  select * into selected_rubric
  from public.scoring_rubrics
  where id = p_rubric_id;

  if selected_rubric.id is null then
    raise exception 'Scoring rubric not found.';
  end if;

  if selected_rubric.status <> 'draft' then
    raise exception 'Only draft rubrics can be published.';
  end if;

  if exists (
    select 1
    from public.adjudication_scorecards scorecard
    join public.applications application
      on application.id = scorecard.application_id
    where application.cycle_id = selected_rubric.cycle_id
  ) then
    raise exception 'Scoring has already begun for this program. Duplicate the program or keep the current published rubric.';
  end if;

  update public.scoring_rubrics
  set status = 'archived', updated_at = now()
  where cycle_id = selected_rubric.cycle_id
    and status = 'published'
    and id <> p_rubric_id;

  update public.scoring_rubrics
  set status = 'published', updated_at = now()
  where id = p_rubric_id;
end;
$$;

grant execute on function public.publish_scoring_rubric(uuid)
to authenticated;

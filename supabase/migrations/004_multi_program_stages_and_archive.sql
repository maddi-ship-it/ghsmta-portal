-- GHSMTA Portal: multiple concurrent programs, staged forms, duplication,
-- and archive-safe applications.
-- Run after 001, 002, and 003.

-- ---------------------------------------------------------------------------
-- 1. Generalize award_cycles so Directors, Scholarship, Mentorship, etc. can
--    all be open at the same time.
-- ---------------------------------------------------------------------------

drop index if exists public.only_one_active_award_cycle;

alter table public.award_cycles
  drop constraint if exists award_cycles_season_year_key;

alter table public.award_cycles
  add column if not exists cycle_key text,
  add column if not exists program_type text not null default 'directors',
  add column if not exists description text,
  add column if not exists status text not null default 'draft',
  add column if not exists source_system text,
  add column if not exists source_program_name text,
  add column if not exists cloned_from_cycle_id uuid references public.award_cycles(id) on delete set null;

update public.award_cycles
set cycle_key = lower(
  trim(both '-' from regexp_replace(
    coalesce(season_year, 'cycle') || '-' || coalesce(name, id::text),
    '[^a-zA-Z0-9]+',
    '-',
    'g'
  ))
)
where cycle_key is null or trim(cycle_key) = '';

alter table public.award_cycles
  alter column cycle_key set not null;

alter table public.award_cycles
  drop constraint if exists award_cycles_program_type_check;
alter table public.award_cycles
  add constraint award_cycles_program_type_check check (
    program_type in (
      'directors',
      'scholarship',
      'mentorship',
      'student_program',
      'adjudicator',
      'other'
    )
  );

alter table public.award_cycles
  drop constraint if exists award_cycles_status_check;
alter table public.award_cycles
  add constraint award_cycles_status_check check (
    status in ('draft', 'open', 'closed', 'archived')
  );

create unique index if not exists award_cycles_cycle_key_key
  on public.award_cycles(cycle_key);

create index if not exists award_cycles_active_program_idx
  on public.award_cycles(is_active, status, program_type, season_year);

-- Existing active cycles should behave as open programs.
update public.award_cycles
set status = 'open'
where is_active = true and status = 'draft';

-- Backward-compatible activation: activating one program no longer closes all
-- other programs.
create or replace function public.activate_award_cycle(target_cycle_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can activate an application program.';
  end if;

  update public.award_cycles
  set is_active = true,
      status = case when status = 'archived' then 'archived' else 'open' end
  where id = target_cycle_id;

  if not found then
    raise exception 'Application program not found.';
  end if;
end;
$$;

grant execute on function public.activate_award_cycle(uuid) to authenticated;

create or replace function public.deactivate_award_cycle(target_cycle_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can deactivate an application program.';
  end if;

  update public.award_cycles
  set is_active = false,
      status = case when status = 'open' then 'closed' else status end
  where id = target_cycle_id;

  if not found then
    raise exception 'Application program not found.';
  end if;
end;
$$;

grant execute on function public.deactivate_award_cycle(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Add explicit stages to form versions.
-- ---------------------------------------------------------------------------

create table if not exists public.application_stages (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.application_form_versions(id) on delete cascade,
  stage_key text not null,
  title text not null,
  description text,
  sort_order integer not null default 0,
  is_initial boolean not null default false,
  applicant_visible boolean not null default true,
  opens_at timestamptz,
  closes_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_version_id, stage_key),
  check (jsonb_typeof(settings) = 'object')
);

create unique index if not exists one_initial_stage_per_form
  on public.application_stages(form_version_id)
  where is_initial = true;

create trigger application_stages_set_updated_at
before update on public.application_stages
for each row execute function public.set_updated_at();

alter table public.application_sections
  add column if not exists stage_id uuid references public.application_stages(id) on delete cascade;

alter table public.application_questions
  add column if not exists source_column_index integer,
  add column if not exists source_label text,
  add column if not exists imported boolean not null default false;

create unique index if not exists application_questions_source_column_key
  on public.application_questions(form_version_id, source_column_index);

alter table public.application_form_versions
  add column if not exists cloned_from_form_version_id uuid references public.application_form_versions(id) on delete set null,
  add column if not exists source_system text,
  add column if not exists source_program_name text;

-- ---------------------------------------------------------------------------
-- 3. Permit archive applications without portal accounts and preserve raw
--    source payloads alongside normalized answers.
-- ---------------------------------------------------------------------------

alter table public.applications
  alter column applicant_user_id drop not null;

alter table public.applications
  drop constraint if exists applications_cycle_id_applicant_user_id_key;

alter table public.applications
  add column if not exists current_stage_id uuid references public.application_stages(id) on delete set null,
  add column if not exists external_applicant_name text,
  add column if not exists external_applicant_email text,
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists source_stage text,
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_payload jsonb not null default '{}'::jsonb,
  add column if not exists cloned_from_application_id uuid references public.applications(id) on delete set null;

create unique index if not exists one_live_application_per_user_program
  on public.applications(cycle_id, applicant_user_id)
  where applicant_user_id is not null and is_archived = false;

create unique index if not exists applications_source_record_key
  on public.applications(source_system, source_record_id);

create index if not exists applications_archive_idx
  on public.applications(is_archived, cycle_id, source_stage);

create table if not exists public.application_stage_progress (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  stage_id uuid not null references public.application_stages(id) on delete cascade,
  status text not null default 'locked',
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  reopened_at timestamptz,
  owner_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, stage_id),
  check (status in ('locked', 'available', 'in_progress', 'submitted', 'complete', 'reopened'))
);

create trigger application_stage_progress_set_updated_at
before update on public.application_stage_progress
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Start a specific program when several programs are open.
-- ---------------------------------------------------------------------------

create or replace function public.start_application(
  p_cycle_id uuid,
  p_school_name text,
  p_production_title text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_cycle public.award_cycles%rowtype;
  published_form_id uuid;
  initial_stage_id uuid;
  existing_application_id uuid;
  new_application_id uuid;
begin
  if public.current_user_role() <> 'applicant' then
    raise exception 'Only applicant accounts can start an application.';
  end if;

  select *
  into selected_cycle
  from public.award_cycles
  where id = p_cycle_id
    and is_active = true
    and status = 'open'
    and (opens_at is null or opens_at <= now())
    and (closes_at is null or closes_at >= now());

  if selected_cycle.id is null then
    raise exception 'This application program is not currently open.';
  end if;

  select id
  into published_form_id
  from public.application_form_versions
  where cycle_id = p_cycle_id
    and status = 'published'
  order by version_number desc
  limit 1;

  if published_form_id is null then
    raise exception 'This application program does not have a published form.';
  end if;

  select id
  into initial_stage_id
  from public.application_stages
  where form_version_id = published_form_id
  order by is_initial desc, sort_order, created_at
  limit 1;

  select id
  into existing_application_id
  from public.applications
  where cycle_id = p_cycle_id
    and applicant_user_id = auth.uid()
    and is_archived = false
  limit 1;

  if existing_application_id is not null then
    update public.applications
    set school_name = trim(p_school_name),
        production_title = coalesce(
          nullif(trim(coalesce(p_production_title, '')), ''),
          production_title
        )
    where id = existing_application_id;

    return existing_application_id;
  end if;

  insert into public.applications (
    cycle_id,
    form_version_id,
    applicant_user_id,
    school_name,
    production_title,
    status,
    current_stage_id
  )
  values (
    p_cycle_id,
    published_form_id,
    auth.uid(),
    trim(p_school_name),
    nullif(trim(coalesce(p_production_title, '')), ''),
    'draft',
    initial_stage_id
  )
  returning id into new_application_id;

  if initial_stage_id is not null then
    insert into public.application_stage_progress (
      application_id,
      stage_id,
      status,
      started_at
    ) values (
      new_application_id,
      initial_stage_id,
      'in_progress',
      now()
    ) on conflict (application_id, stage_id) do nothing;
  end if;

  return new_application_id;
end;
$$;

grant execute on function public.start_application(uuid, text, text) to authenticated;

-- Keep the original two-argument call working only when exactly one program is
-- open. New UI should always send p_cycle_id.
create or replace function public.start_application(
  p_school_name text,
  p_production_title text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_cycle_id uuid;
  open_count integer;
begin
  select count(*), (array_agg(id order by created_at))[1]
  into open_count, selected_cycle_id
  from public.award_cycles
  where is_active = true
    and status = 'open'
    and (opens_at is null or opens_at <= now())
    and (closes_at is null or closes_at >= now());

  if open_count = 0 then
    raise exception 'There are no open application programs.';
  elsif open_count > 1 then
    raise exception 'Choose which application program you want to start.';
  end if;

  return public.start_application(selected_cycle_id, p_school_name, p_production_title);
end;
$$;

grant execute on function public.start_application(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Owner duplication helpers.
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_form_version(
  p_source_form_version_id uuid,
  p_target_cycle_id uuid,
  p_name text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_form public.application_form_versions%rowtype;
  new_form_id uuid;
  next_version integer;
  source_stage record;
  source_section record;
  new_stage_id uuid;
  new_section_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can duplicate forms.';
  end if;

  select * into source_form
  from public.application_form_versions
  where id = p_source_form_version_id;

  if source_form.id is null then
    raise exception 'Source form not found.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.application_form_versions
  where cycle_id = p_target_cycle_id;

  insert into public.application_form_versions (
    cycle_id,
    version_number,
    name,
    status,
    cloned_from_form_version_id,
    source_system,
    source_program_name
  ) values (
    p_target_cycle_id,
    next_version,
    coalesce(nullif(trim(p_name), ''), source_form.name || ' Copy'),
    'draft',
    source_form.id,
    source_form.source_system,
    source_form.source_program_name
  ) returning id into new_form_id;

  for source_stage in
    select *
    from public.application_stages
    where form_version_id = source_form.id
    order by sort_order, created_at
  loop
    insert into public.application_stages (
      form_version_id,
      stage_key,
      title,
      description,
      sort_order,
      is_initial,
      applicant_visible,
      opens_at,
      closes_at,
      settings
    ) values (
      new_form_id,
      source_stage.stage_key,
      source_stage.title,
      source_stage.description,
      source_stage.sort_order,
      source_stage.is_initial,
      source_stage.applicant_visible,
      source_stage.opens_at,
      source_stage.closes_at,
      source_stage.settings
    ) returning id into new_stage_id;

    for source_section in
      select *
      from public.application_sections
      where form_version_id = source_form.id
        and stage_id = source_stage.id
      order by sort_order, created_at
    loop
      insert into public.application_sections (
        form_version_id,
        stage_id,
        title,
        description,
        sort_order
      ) values (
        new_form_id,
        new_stage_id,
        source_section.title,
        source_section.description,
        source_section.sort_order
      ) returning id into new_section_id;

      insert into public.application_questions (
        form_version_id,
        section_id,
        question_key,
        label,
        description,
        question_type,
        required,
        options,
        settings,
        visibility_rule,
        sort_order,
        active,
        source_column_index,
        source_label,
        imported
      )
      select
        new_form_id,
        new_section_id,
        q.question_key,
        q.label,
        q.description,
        q.question_type,
        q.required,
        q.options,
        q.settings,
        q.visibility_rule,
        q.sort_order,
        q.active,
        q.source_column_index,
        q.source_label,
        q.imported
      from public.application_questions q
      where q.form_version_id = source_form.id
        and q.section_id = source_section.id
      order by q.sort_order, q.created_at;
    end loop;
  end loop;

  -- Copy any legacy sections that were not assigned to a stage.
  for source_section in
    select *
    from public.application_sections
    where form_version_id = source_form.id
      and stage_id is null
    order by sort_order, created_at
  loop
    insert into public.application_sections (
      form_version_id,
      stage_id,
      title,
      description,
      sort_order
    ) values (
      new_form_id,
      null,
      source_section.title,
      source_section.description,
      source_section.sort_order
    ) returning id into new_section_id;

    insert into public.application_questions (
      form_version_id,
      section_id,
      question_key,
      label,
      description,
      question_type,
      required,
      options,
      settings,
      visibility_rule,
      sort_order,
      active,
      source_column_index,
      source_label,
      imported
    )
    select
      new_form_id,
      new_section_id,
      q.question_key,
      q.label,
      q.description,
      q.question_type,
      q.required,
      q.options,
      q.settings,
      q.visibility_rule,
      q.sort_order,
      q.active,
      q.source_column_index,
      q.source_label,
      q.imported
    from public.application_questions q
    where q.form_version_id = source_form.id
      and q.section_id = source_section.id
    order by q.sort_order, q.created_at;
  end loop;

  return new_form_id;
end;
$$;

grant execute on function public.duplicate_form_version(uuid, uuid, text) to authenticated;

create or replace function public.duplicate_application_program(
  p_source_cycle_id uuid,
  p_name text,
  p_season_year text,
  p_cycle_key text,
  p_program_type text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_cycle public.award_cycles%rowtype;
  source_form_id uuid;
  new_cycle_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can duplicate application programs.';
  end if;

  select * into source_cycle
  from public.award_cycles
  where id = p_source_cycle_id;

  if source_cycle.id is null then
    raise exception 'Source application program not found.';
  end if;

  insert into public.award_cycles (
    cycle_key,
    name,
    season_year,
    program_type,
    description,
    status,
    is_active,
    cloned_from_cycle_id
  ) values (
    lower(trim(p_cycle_key)),
    trim(p_name),
    trim(p_season_year),
    coalesce(nullif(trim(p_program_type), ''), source_cycle.program_type),
    source_cycle.description,
    'draft',
    false,
    source_cycle.id
  ) returning id into new_cycle_id;

  select id into source_form_id
  from public.application_form_versions
  where cycle_id = source_cycle.id
  order by (status = 'published') desc, version_number desc
  limit 1;

  if source_form_id is not null then
    perform public.duplicate_form_version(
      source_form_id,
      new_cycle_id,
      trim(p_name) || ' Form'
    );
  end if;

  return new_cycle_id;
end;
$$;

grant execute on function public.duplicate_application_program(uuid, text, text, text, text) to authenticated;

create or replace function public.duplicate_application_record(
  p_source_application_id uuid,
  p_target_cycle_id uuid,
  p_copy_answers boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_application public.applications%rowtype;
  target_form_id uuid;
  target_stage_id uuid;
  new_application_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can duplicate applications.';
  end if;

  select * into source_application
  from public.applications
  where id = p_source_application_id;

  if source_application.id is null then
    raise exception 'Source application not found.';
  end if;

  select id into target_form_id
  from public.application_form_versions
  where cycle_id = p_target_cycle_id
  order by (status = 'published') desc, version_number desc
  limit 1;

  if target_form_id is null then
    raise exception 'Target program has no form version.';
  end if;

  select id into target_stage_id
  from public.application_stages
  where form_version_id = target_form_id
  order by is_initial desc, sort_order, created_at
  limit 1;

  insert into public.applications (
    cycle_id,
    form_version_id,
    applicant_user_id,
    school_id,
    school_name,
    production_title,
    status,
    form_data,
    owner_notes,
    current_stage_id,
    external_applicant_name,
    external_applicant_email,
    source_system,
    source_record_id,
    source_stage,
    is_archived,
    archived_payload,
    cloned_from_application_id
  ) values (
    p_target_cycle_id,
    target_form_id,
    source_application.applicant_user_id,
    source_application.school_id,
    source_application.school_name,
    source_application.production_title,
    'draft',
    source_application.form_data,
    source_application.owner_notes,
    target_stage_id,
    source_application.external_applicant_name,
    source_application.external_applicant_email,
    null,
    null,
    null,
    false,
    source_application.archived_payload,
    source_application.id
  ) returning id into new_application_id;

  if p_copy_answers then
    insert into public.application_answers (
      application_id,
      question_id,
      value,
      updated_by
    )
    select
      new_application_id,
      target_question.id,
      source_answer.value,
      auth.uid()
    from public.application_answers source_answer
    join public.application_questions source_question
      on source_question.id = source_answer.question_id
    join public.application_questions target_question
      on target_question.form_version_id = target_form_id
     and target_question.question_key = source_question.question_key
    where source_answer.application_id = source_application.id
    on conflict (application_id, question_id)
    do update set value = excluded.value, updated_by = auth.uid();
  end if;

  if target_stage_id is not null then
    insert into public.application_stage_progress (
      application_id,
      stage_id,
      status,
      started_at
    ) values (
      new_application_id,
      target_stage_id,
      'in_progress',
      now()
    ) on conflict (application_id, stage_id) do nothing;
  end if;

  return new_application_id;
end;
$$;

grant execute on function public.duplicate_application_record(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS for stages and stage progress.
-- ---------------------------------------------------------------------------

alter table public.application_stages enable row level security;
alter table public.application_stage_progress enable row level security;

create policy "read available application stages"
on public.application_stages for select to authenticated
using (
  exists (
    select 1
    from public.application_form_versions fv
    where fv.id = application_stages.form_version_id
  )
);

create policy "owners insert application stages"
on public.application_stages for insert to authenticated
with check (public.current_user_role() = 'owner');

create policy "owners update application stages"
on public.application_stages for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners delete application stages"
on public.application_stages for delete to authenticated
using (public.current_user_role() = 'owner');

create policy "read stage progress for accessible applications"
on public.application_stage_progress for select to authenticated
using (
  exists (
    select 1 from public.applications a
    where a.id = application_stage_progress.application_id
  )
);

create policy "owners manage stage progress insert"
on public.application_stage_progress for insert to authenticated
with check (
  public.current_user_role() = 'owner'
  or exists (
    select 1 from public.applications a
    where a.id = application_stage_progress.application_id
      and a.applicant_user_id = auth.uid()
  )
);

create policy "owners manage stage progress update"
on public.application_stage_progress for update to authenticated
using (
  public.current_user_role() = 'owner'
  or exists (
    select 1 from public.applications a
    where a.id = application_stage_progress.application_id
      and a.applicant_user_id = auth.uid()
  )
)
with check (
  public.current_user_role() = 'owner'
  or exists (
    select 1 from public.applications a
    where a.id = application_stage_progress.application_id
      and a.applicant_user_id = auth.uid()
  )
);

create policy "owners delete stage progress"
on public.application_stage_progress for delete to authenticated
using (public.current_user_role() = 'owner');

create index if not exists application_stages_form_idx
  on public.application_stages(form_version_id, sort_order);
create index if not exists application_sections_stage_idx
  on public.application_sections(stage_id, sort_order);
create index if not exists application_stage_progress_application_idx
  on public.application_stage_progress(application_id, status);

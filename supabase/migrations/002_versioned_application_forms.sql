-- GHSMTA Awards Backbone: versioned form definitions and normalized answers.
-- Run after 001_initial_schema.sql.

create type public.form_version_status as enum (
  'draft',
  'published',
  'archived'
);

create type public.application_question_type as enum (
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'datetime',
  'select',
  'multi_select',
  'radio',
  'checkbox',
  'yes_no',
  'signature_acknowledgement',
  'content'
);

create table public.application_form_versions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.award_cycles(id) on delete cascade,
  version_number integer not null,
  name text not null,
  status public.form_version_status not null default 'draft',
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, version_number)
);

create unique index one_published_form_per_cycle
  on public.application_form_versions(cycle_id)
  where status = 'published';

create table public.application_sections (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.application_form_versions(id) on delete cascade,
  title text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, form_version_id)
);

create table public.application_questions (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.application_form_versions(id) on delete cascade,
  section_id uuid not null,
  question_key text not null,
  label text not null,
  description text,
  question_type public.application_question_type not null,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  visibility_rule jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_version_id, question_key),
  foreign key (section_id, form_version_id)
    references public.application_sections(id, form_version_id)
    on delete cascade,
  check (jsonb_typeof(options) = 'array'),
  check (jsonb_typeof(settings) = 'object'),
  check (visibility_rule is null or jsonb_typeof(visibility_rule) = 'object')
);

create table public.application_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  question_id uuid not null references public.application_questions(id) on delete restrict,
  value jsonb not null default 'null'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, question_id)
);

alter table public.applications
  add column form_version_id uuid references public.application_form_versions(id) on delete restrict;

create trigger form_versions_set_updated_at
before update on public.application_form_versions
for each row execute function public.set_updated_at();

create trigger application_sections_set_updated_at
before update on public.application_sections
for each row execute function public.set_updated_at();

create trigger application_questions_set_updated_at
before update on public.application_questions
for each row execute function public.set_updated_at();

create trigger application_answers_set_updated_at
before update on public.application_answers
for each row execute function public.set_updated_at();

create or replace function public.create_form_version(
  p_cycle_id uuid,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
  next_version integer;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can create form versions.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.application_form_versions
  where cycle_id = p_cycle_id;

  insert into public.application_form_versions (
    cycle_id,
    version_number,
    name,
    status
  )
  values (
    p_cycle_id,
    next_version,
    nullif(trim(p_name), ''),
    'draft'
  )
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_form_version(uuid, text) to authenticated;

create or replace function public.publish_form_version(target_form_version_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_cycle_id uuid;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can publish application forms.';
  end if;

  select cycle_id
  into target_cycle_id
  from public.application_form_versions
  where id = target_form_version_id;

  if target_cycle_id is null then
    raise exception 'Form version not found.';
  end if;

  update public.application_form_versions
  set status = 'archived'
  where cycle_id = target_cycle_id
    and status = 'published'
    and id <> target_form_version_id;

  update public.application_form_versions
  set status = 'published', published_at = now()
  where id = target_form_version_id;
end;
$$;

grant execute on function public.publish_form_version(uuid) to authenticated;

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
  active_cycle_id uuid;
  published_form_id uuid;
  new_application_id uuid;
begin
  if public.current_user_role() <> 'applicant' then
    raise exception 'Only applicant accounts can start an application.';
  end if;

  select id
  into active_cycle_id
  from public.award_cycles
  where is_active = true
    and (opens_at is null or opens_at <= now())
    and (closes_at is null or closes_at >= now())
  limit 1;

  if active_cycle_id is null then
    raise exception 'There is no open awards cycle.';
  end if;

  select id
  into published_form_id
  from public.application_form_versions
  where cycle_id = active_cycle_id
    and status = 'published'
  limit 1;

  if published_form_id is null then
    raise exception 'The active cycle does not have a published application form.';
  end if;

  insert into public.applications (
    cycle_id,
    form_version_id,
    applicant_user_id,
    school_name,
    production_title,
    status
  )
  values (
    active_cycle_id,
    published_form_id,
    auth.uid(),
    trim(p_school_name),
    nullif(trim(coalesce(p_production_title, '')), ''),
    'draft'
  )
  on conflict (cycle_id, applicant_user_id)
  do update set
    school_name = excluded.school_name,
    production_title = coalesce(excluded.production_title, public.applications.production_title)
  returning id into new_application_id;

  return new_application_id;
end;
$$;

grant execute on function public.start_application(text, text) to authenticated;

alter table public.application_form_versions enable row level security;
alter table public.application_sections enable row level security;
alter table public.application_questions enable row level security;
alter table public.application_answers enable row level security;

create policy "read available form versions"
on public.application_form_versions for select to authenticated
using (
  public.current_user_role() = 'owner'
  or status = 'published'
  or exists (
    select 1
    from public.applications a
    where a.form_version_id = application_form_versions.id
  )
);

create policy "owners insert form versions"
on public.application_form_versions for insert to authenticated
with check (public.current_user_role() = 'owner');

create policy "owners update form versions"
on public.application_form_versions for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners delete draft form versions"
on public.application_form_versions for delete to authenticated
using (
  public.current_user_role() = 'owner'
  and status = 'draft'
);

create policy "read available sections"
on public.application_sections for select to authenticated
using (
  exists (
    select 1
    from public.application_form_versions fv
    where fv.id = application_sections.form_version_id
  )
);

create policy "owners insert sections"
on public.application_sections for insert to authenticated
with check (public.current_user_role() = 'owner');

create policy "owners update sections"
on public.application_sections for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners delete sections"
on public.application_sections for delete to authenticated
using (public.current_user_role() = 'owner');

create policy "read available questions"
on public.application_questions for select to authenticated
using (
  exists (
    select 1
    from public.application_form_versions fv
    where fv.id = application_questions.form_version_id
  )
);

create policy "owners insert questions"
on public.application_questions for insert to authenticated
with check (public.current_user_role() = 'owner');

create policy "owners update questions"
on public.application_questions for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners delete questions"
on public.application_questions for delete to authenticated
using (public.current_user_role() = 'owner');

create policy "read answers for accessible applications"
on public.application_answers for select to authenticated
using (
  exists (
    select 1
    from public.applications a
    where a.id = application_answers.application_id
  )
);

create policy "applicants or owners insert answers"
on public.application_answers for insert to authenticated
with check (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications a
    where a.id = application_answers.application_id
      and a.applicant_user_id = auth.uid()
      and a.status = 'draft'
  )
);

create policy "applicants or owners update answers"
on public.application_answers for update to authenticated
using (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications a
    where a.id = application_answers.application_id
      and a.applicant_user_id = auth.uid()
      and a.status = 'draft'
  )
)
with check (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications a
    where a.id = application_answers.application_id
      and a.applicant_user_id = auth.uid()
      and a.status = 'draft'
  )
);

create policy "applicants or owners delete answers"
on public.application_answers for delete to authenticated
using (
  public.current_user_role() = 'owner'
  or exists (
    select 1
    from public.applications a
    where a.id = application_answers.application_id
      and a.applicant_user_id = auth.uid()
      and a.status = 'draft'
  )
);

create index form_versions_cycle_idx
  on public.application_form_versions(cycle_id, status);
create index sections_form_version_idx
  on public.application_sections(form_version_id, sort_order);
create index questions_form_version_idx
  on public.application_questions(form_version_id, section_id, sort_order);
create index answers_application_idx
  on public.application_answers(application_id);
create index answers_question_idx
  on public.application_answers(question_id);

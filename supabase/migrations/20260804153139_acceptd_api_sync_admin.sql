-- Acceptd API v2 synchronization, owner-managed identity reconciliation, and
-- a hidden/source-managed application schema.

create table public.acceptd_program_mappings (
  id uuid primary key default gen_random_uuid(),
  acceptd_program_id bigint not null unique check (acceptd_program_id > 0),
  acceptd_program_name text not null,
  portal_cycle_id uuid not null references public.award_cycles(id) on delete restrict,
  portal_form_version_id uuid not null references public.application_form_versions(id) on delete restrict,
  schema_source_program_ids bigint[] not null default '{}'::bigint[],
  enabled boolean not null default true,
  sync_drafts boolean not null default true,
  last_schema_sync_at timestamptz,
  last_application_sync_at timestamptz,
  last_sync_status text not null default 'never'
    check (last_sync_status in ('never', 'running', 'succeeded', 'partial', 'failed')),
  last_error text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portal_form_version_id),
  check (trim(acceptd_program_name) <> ''),
  check (0 < all(schema_source_program_ids))
);

create table public.acceptd_user_mappings (
  id uuid primary key default gen_random_uuid(),
  acceptd_user_id bigint not null unique check (acceptd_user_id > 0),
  portal_profile_id uuid not null references public.profiles(id) on delete cascade,
  acceptd_name text,
  acceptd_email text,
  mapped_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portal_profile_id)
);

create table public.acceptd_question_mappings (
  id uuid primary key default gen_random_uuid(),
  program_mapping_id uuid not null references public.acceptd_program_mappings(id) on delete cascade,
  acceptd_question_id bigint not null check (acceptd_question_id > 0),
  portal_question_id uuid not null references public.application_questions(id) on delete cascade,
  acceptd_type text not null,
  label text not null,
  description text,
  category text not null,
  archived boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_mapping_id, acceptd_question_id),
  unique (portal_question_id),
  check (trim(acceptd_type) <> ''),
  check (trim(label) <> ''),
  check (trim(category) <> '')
);

create table public.acceptd_application_snapshots (
  id uuid primary key default gen_random_uuid(),
  program_mapping_id uuid not null references public.acceptd_program_mappings(id) on delete cascade,
  acceptd_application_id bigint not null check (acceptd_application_id > 0),
  acceptd_user_id bigint,
  acceptd_applicant_name text,
  acceptd_applicant_email text,
  acceptd_stage_id bigint,
  portal_application_id uuid references public.applications(id) on delete set null,
  mapping_status text not null default 'unmapped'
    check (mapping_status in ('unmapped', 'mapped', 'missing_portal_application', 'synced', 'failed')),
  issue text,
  payload jsonb not null,
  payload_sha256 text not null,
  acceptd_started_at timestamptz,
  acceptd_submitted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_mapping_id, acceptd_application_id),
  check (acceptd_user_id is null or acceptd_user_id > 0),
  check (acceptd_stage_id is null or acceptd_stage_id > 0),
  check (jsonb_typeof(payload) = 'object'),
  check (payload_sha256 ~ '^[0-9a-f]{64}$')
);

create table public.acceptd_sync_runs (
  id uuid primary key default gen_random_uuid(),
  program_mapping_id uuid references public.acceptd_program_mappings(id) on delete set null,
  trigger_source text not null
    check (trigger_source in ('manual', 'webhook', 'cron', 'schema')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  applications_seen integer not null default 0 check (applications_seen >= 0),
  applications_synced integer not null default 0 check (applications_synced >= 0),
  applications_unmapped integer not null default 0 check (applications_unmapped >= 0),
  applications_failed integer not null default 0 check (applications_failed >= 0),
  questions_discovered integer not null default 0 check (questions_discovered >= 0),
  detail jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(detail) = 'object')
);

create table public.acceptd_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null unique,
  event_type text,
  acceptd_application_id bigint,
  acceptd_program_id bigint,
  signature_header text not null,
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (acceptd_application_id is null or acceptd_application_id > 0),
  check (acceptd_program_id is null or acceptd_program_id > 0),
  check (delivery_key ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(payload) = 'object')
);

create index acceptd_program_mappings_enabled_idx
  on public.acceptd_program_mappings(enabled, acceptd_program_id);
create index acceptd_user_mappings_profile_idx
  on public.acceptd_user_mappings(portal_profile_id);
create index acceptd_question_mappings_program_idx
  on public.acceptd_question_mappings(program_mapping_id, category, acceptd_question_id);
create index acceptd_snapshots_status_idx
  on public.acceptd_application_snapshots(program_mapping_id, mapping_status, last_seen_at desc);
create index acceptd_snapshots_user_idx
  on public.acceptd_application_snapshots(acceptd_user_id);
create index acceptd_sync_runs_recent_idx
  on public.acceptd_sync_runs(program_mapping_id, started_at desc);
create index acceptd_webhook_deliveries_status_idx
  on public.acceptd_webhook_deliveries(status, received_at);

create or replace function public.validate_acceptd_program_mapping()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.application_form_versions form_version
    where form_version.id = new.portal_form_version_id
      and form_version.cycle_id = new.portal_cycle_id
  ) then
    raise exception 'The Acceptd target form must belong to the selected portal program.';
  end if;
  return new;
end;
$$;

create trigger acceptd_program_mapping_validate
before insert or update of portal_cycle_id, portal_form_version_id
on public.acceptd_program_mappings
for each row execute function public.validate_acceptd_program_mapping();

revoke all on function public.validate_acceptd_program_mapping() from public, anon, authenticated;

create trigger acceptd_program_mappings_set_updated_at
before update on public.acceptd_program_mappings
for each row execute function public.set_updated_at();

create or replace function public.claim_acceptd_program_sync(p_mapping_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.acceptd_program_mappings
  set last_sync_status = 'running',
      last_error = null
  where id = p_mapping_id
    and (
      last_sync_status <> 'running'
      or updated_at < now() - interval '5 minutes'
    );
  return found;
end;
$$;

revoke all on function public.claim_acceptd_program_sync(uuid) from public, anon, authenticated;
grant execute on function public.claim_acceptd_program_sync(uuid) to service_role;

create trigger acceptd_user_mappings_set_updated_at
before update on public.acceptd_user_mappings
for each row execute function public.set_updated_at();

create trigger acceptd_question_mappings_set_updated_at
before update on public.acceptd_question_mappings
for each row execute function public.set_updated_at();

create trigger acceptd_application_snapshots_set_updated_at
before update on public.acceptd_application_snapshots
for each row execute function public.set_updated_at();

create trigger acceptd_sync_runs_set_updated_at
before update on public.acceptd_sync_runs
for each row execute function public.set_updated_at();

create trigger acceptd_webhook_deliveries_set_updated_at
before update on public.acceptd_webhook_deliveries
for each row execute function public.set_updated_at();

alter table public.acceptd_program_mappings enable row level security;
alter table public.acceptd_user_mappings enable row level security;
alter table public.acceptd_question_mappings enable row level security;
alter table public.acceptd_application_snapshots enable row level security;
alter table public.acceptd_sync_runs enable row level security;
alter table public.acceptd_webhook_deliveries enable row level security;

create policy "owners manage Acceptd program mappings"
on public.acceptd_program_mappings for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners manage Acceptd user mappings"
on public.acceptd_user_mappings for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

create policy "owners read Acceptd question mappings"
on public.acceptd_question_mappings for select to authenticated
using (public.current_user_role() = 'owner');

create policy "owners read Acceptd application snapshots"
on public.acceptd_application_snapshots for select to authenticated
using (public.current_user_role() = 'owner');

create policy "owners read Acceptd sync runs"
on public.acceptd_sync_runs for select to authenticated
using (public.current_user_role() = 'owner');

create policy "owners read Acceptd webhook deliveries"
on public.acceptd_webhook_deliveries for select to authenticated
using (public.current_user_role() = 'owner');

revoke all on table public.acceptd_program_mappings from anon, authenticated;
revoke all on table public.acceptd_user_mappings from anon, authenticated;
revoke all on table public.acceptd_question_mappings from anon, authenticated;
revoke all on table public.acceptd_application_snapshots from anon, authenticated;
revoke all on table public.acceptd_sync_runs from anon, authenticated;
revoke all on table public.acceptd_webhook_deliveries from anon, authenticated;

grant select, insert, update, delete on table public.acceptd_program_mappings to authenticated;
grant select, insert, update, delete on table public.acceptd_user_mappings to authenticated;
grant select on table public.acceptd_question_mappings to authenticated;
grant select on table public.acceptd_application_snapshots to authenticated;
grant select on table public.acceptd_sync_runs to authenticated;
grant select on table public.acceptd_webhook_deliveries to authenticated;

grant all on table public.acceptd_program_mappings to service_role;
grant all on table public.acceptd_user_mappings to service_role;
grant all on table public.acceptd_question_mappings to service_role;
grant all on table public.acceptd_application_snapshots to service_role;
grant all on table public.acceptd_sync_runs to service_role;
grant all on table public.acceptd_webhook_deliveries to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.application_question_is_source_managed(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select question.settings @> '{"source_managed": true}'::jsonb
      from public.application_questions question
      where question.id = p_question_id
    ),
    false
  );
$$;

revoke all on function private.application_question_is_source_managed(uuid)
from public, anon, authenticated;
grant execute on function private.application_question_is_source_managed(uuid)
to authenticated, service_role;

-- Applicants do not receive the hidden schema or its synchronized answer data,
-- even through direct Data API queries. Staff retain read access.
drop policy if exists "read available application stages"
on public.application_stages;
create policy "read available application stages"
on public.application_stages for select to authenticated
using (
  (public.current_user_role() <> 'applicant' or applicant_visible = true)
  and exists (
    select 1
    from public.application_form_versions form_version
    where form_version.id = application_stages.form_version_id
  )
);

drop policy if exists "read available questions"
on public.application_questions;
create policy "read available questions"
on public.application_questions for select to authenticated
using (
  (public.current_user_role() <> 'applicant' or not settings @> '{"source_managed": true}'::jsonb)
  and exists (
    select 1
    from public.application_form_versions form_version
    where form_version.id = application_questions.form_version_id
  )
);

drop policy if exists "read answers for accessible applications"
on public.application_answers;
create policy "read answers for accessible applications"
on public.application_answers for select to authenticated
using (
  (
    public.current_user_role() <> 'applicant'
    or not private.application_question_is_source_managed(question_id)
  )
  and exists (
    select 1
    from public.applications application
    where application.id = application_answers.application_id
  )
);

-- The form builder can manage portal-authored stages, sections, and questions,
-- but Acceptd-owned schema rows remain service-managed.
drop policy if exists "owners insert application stages"
on public.application_stages;
create policy "owners insert application stages"
on public.application_stages for insert to authenticated
with check (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
);

drop policy if exists "owners update application stages"
on public.application_stages;
create policy "owners update application stages"
on public.application_stages for update to authenticated
using (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
)
with check (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
);

drop policy if exists "owners delete application stages"
on public.application_stages;
create policy "owners delete application stages"
on public.application_stages for delete to authenticated
using (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
);

drop policy if exists "owners insert sections"
on public.application_sections;
create policy "owners insert sections"
on public.application_sections for insert to authenticated
with check (
  public.current_user_role() = 'owner'
  and not exists (
    select 1
    from public.application_stages source_stage
    where source_stage.id = application_sections.stage_id
      and source_stage.settings @> '{"source_managed": true}'::jsonb
  )
);

drop policy if exists "owners update sections"
on public.application_sections;
create policy "owners update sections"
on public.application_sections for update to authenticated
using (
  public.current_user_role() = 'owner'
  and not exists (
    select 1
    from public.application_stages source_stage
    where source_stage.id = application_sections.stage_id
      and source_stage.settings @> '{"source_managed": true}'::jsonb
  )
)
with check (
  public.current_user_role() = 'owner'
  and not exists (
    select 1
    from public.application_stages source_stage
    where source_stage.id = application_sections.stage_id
      and source_stage.settings @> '{"source_managed": true}'::jsonb
  )
);

drop policy if exists "owners delete sections"
on public.application_sections;
create policy "owners delete sections"
on public.application_sections for delete to authenticated
using (
  public.current_user_role() = 'owner'
  and not exists (
    select 1
    from public.application_stages source_stage
    where source_stage.id = application_sections.stage_id
      and source_stage.settings @> '{"source_managed": true}'::jsonb
  )
);

drop policy if exists "owners insert questions"
on public.application_questions;
create policy "owners insert questions"
on public.application_questions for insert to authenticated
with check (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
);

drop policy if exists "owners update questions"
on public.application_questions;
create policy "owners update questions"
on public.application_questions for update to authenticated
using (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
)
with check (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
);

drop policy if exists "owners delete questions"
on public.application_questions;
create policy "owners delete questions"
on public.application_questions for delete to authenticated
using (
  public.current_user_role() = 'owner'
  and not settings @> '{"source_managed": true}'::jsonb
);

-- Applicants and authenticated owners can continue editing ordinary portal
-- questions. Answers marked source_managed are writable only by service_role,
-- which bypasses RLS, and applicant writes must target the current visible stage.
drop policy if exists "applicants or owners insert answers"
on public.application_answers;
create policy "applicants or owners insert answers"
on public.application_answers for insert to authenticated
with check (
  not private.application_question_is_source_managed(application_answers.question_id)
  and (
    public.current_user_role() = 'owner'
    or exists (
      select 1
      from public.applications application
      join public.application_questions question
        on question.id = application_answers.question_id
       and question.form_version_id = application.form_version_id
      join public.application_sections section on section.id = question.section_id
      join public.application_stages stage on stage.id = section.stage_id
      where application.id = application_answers.application_id
        and application.status = 'draft'
        and application.current_stage_id = stage.id
        and stage.applicant_visible = true
        and public.can_edit_application(application.id, auth.uid())
    )
  )
);

drop policy if exists "applicants or owners update answers"
on public.application_answers;
create policy "applicants or owners update answers"
on public.application_answers for update to authenticated
using (
  not private.application_question_is_source_managed(application_answers.question_id)
  and (
    public.current_user_role() = 'owner'
    or exists (
      select 1
      from public.applications application
      join public.application_questions question
        on question.id = application_answers.question_id
       and question.form_version_id = application.form_version_id
      join public.application_sections section on section.id = question.section_id
      join public.application_stages stage on stage.id = section.stage_id
      where application.id = application_answers.application_id
        and application.status = 'draft'
        and application.current_stage_id = stage.id
        and stage.applicant_visible = true
        and public.can_edit_application(application.id, auth.uid())
    )
  )
)
with check (
  not private.application_question_is_source_managed(application_answers.question_id)
  and (
    public.current_user_role() = 'owner'
    or exists (
      select 1
      from public.applications application
      join public.application_questions question
        on question.id = application_answers.question_id
       and question.form_version_id = application.form_version_id
      join public.application_sections section on section.id = question.section_id
      join public.application_stages stage on stage.id = section.stage_id
      where application.id = application_answers.application_id
        and application.status = 'draft'
        and application.current_stage_id = stage.id
        and stage.applicant_visible = true
        and public.can_edit_application(application.id, auth.uid())
    )
  )
);

drop policy if exists "applicants or owners delete answers"
on public.application_answers;
create policy "applicants or owners delete answers"
on public.application_answers for delete to authenticated
using (
  not private.application_question_is_source_managed(application_answers.question_id)
  and (
    public.current_user_role() = 'owner'
    or exists (
      select 1
      from public.applications application
      join public.application_questions question
        on question.id = application_answers.question_id
       and question.form_version_id = application.form_version_id
      join public.application_sections section on section.id = question.section_id
      join public.application_stages stage on stage.id = section.stage_id
      where application.id = application_answers.application_id
        and application.status = 'draft'
        and application.current_stage_id = stage.id
        and stage.applicant_visible = true
        and public.can_edit_application(application.id, auth.uid())
    )
  )
);

-- Broadcast only status/IDs. Raw application payloads and applicant PII never
-- leave the owner-only tables through Realtime.
create policy "owners receive Acceptd sync broadcasts"
on realtime.messages for select to authenticated
using (
  public.current_user_role() = 'owner'
  and realtime.topic() = 'admin:acceptd-sync'
  and extension = 'broadcast'
);

create or replace function public.broadcast_acceptd_sync_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'run_id', new.id,
      'program_mapping_id', new.program_mapping_id,
      'status', new.status,
      'finished_at', new.finished_at
    ),
    'sync_changed',
    'admin:acceptd-sync',
    true
  );
  return new;
end;
$$;

revoke all on function public.broadcast_acceptd_sync_change() from public, anon, authenticated;

create trigger acceptd_sync_runs_broadcast
after insert or update of status, finished_at on public.acceptd_sync_runs
for each row execute function public.broadcast_acceptd_sync_change();

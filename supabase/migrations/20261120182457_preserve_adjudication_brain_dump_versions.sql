-- Preserve database-backed versions of both adjudication brain dumps. The
-- scorecard row remains the live draft; this history makes an earlier draft
-- recoverable if a later device or template-only autosave replaces it.

begin;

create table if not exists public.adjudication_brain_dump_versions (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null
    references public.adjudication_scorecards(id) on delete cascade,
  application_id uuid not null
    references public.applications(id) on delete cascade,
  adjudicator_user_id uuid not null
    references public.profiles(id) on delete cascade,
  intermission_notes text,
  post_show_notes text,
  actor_user_id uuid references public.profiles(id) on delete set null,
  source text not null default 'autosave',
  saved_at timestamptz not null default now(),
  constraint adjudication_brain_dump_versions_source_check
    check (source in ('autosave', 'initial_snapshot', 'manual_restore'))
);

create index if not exists adjudication_brain_dump_versions_scorecard_saved_idx
  on public.adjudication_brain_dump_versions(scorecard_id, saved_at desc);

create index if not exists adjudication_brain_dump_versions_application_idx
  on public.adjudication_brain_dump_versions(application_id, saved_at desc);

alter table public.adjudication_brain_dump_versions enable row level security;

drop policy if exists "participants read own brain dump history"
on public.adjudication_brain_dump_versions;
create policy "participants read own brain dump history"
on public.adjudication_brain_dump_versions
for select
to authenticated
using ((select auth.uid()) = adjudicator_user_id);

drop policy if exists "owners read brain dump history"
on public.adjudication_brain_dump_versions;
create policy "owners read brain dump history"
on public.adjudication_brain_dump_versions
for select
to authenticated
using (public.current_user_role() = 'owner'::public.app_role);

grant select on public.adjudication_brain_dump_versions to authenticated;
revoke insert, update, delete, truncate
on public.adjudication_brain_dump_versions
from anon, authenticated;

comment on table public.adjudication_brain_dump_versions is
  'Immutable server-side snapshots of adjudicator intermission and post-show brain dumps.';

create or replace function private.archive_adjudication_brain_dump_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.adjudication_brain_dump_versions (
    scorecard_id,
    application_id,
    adjudicator_user_id,
    intermission_notes,
    post_show_notes,
    actor_user_id,
    source,
    saved_at
  ) values (
    old.id,
    old.application_id,
    old.adjudicator_user_id,
    old.internal_notes,
    old.post_show_notes,
    (select auth.uid()),
    'autosave',
    now()
  );

  return new;
end;
$$;

revoke all on function private.archive_adjudication_brain_dump_version()
from public, anon, authenticated;

drop trigger if exists archive_adjudication_brain_dump_version
on public.adjudication_scorecards;
create trigger archive_adjudication_brain_dump_version
before update of internal_notes, post_show_notes
on public.adjudication_scorecards
for each row
when (
  old.internal_notes is distinct from new.internal_notes
  or old.post_show_notes is distinct from new.post_show_notes
)
execute function private.archive_adjudication_brain_dump_version();

-- Establish a database checkpoint for every current non-empty brain dump.
insert into public.adjudication_brain_dump_versions (
  scorecard_id,
  application_id,
  adjudicator_user_id,
  intermission_notes,
  post_show_notes,
  actor_user_id,
  source,
  saved_at
)
select
  scorecard.id,
  scorecard.application_id,
  scorecard.adjudicator_user_id,
  scorecard.internal_notes,
  scorecard.post_show_notes,
  null,
  'initial_snapshot',
  scorecard.updated_at
from public.adjudication_scorecards scorecard
where nullif(trim(coalesce(scorecard.internal_notes, '')), '') is not null
   or nullif(trim(coalesce(scorecard.post_show_notes, '')), '') is not null;

commit;

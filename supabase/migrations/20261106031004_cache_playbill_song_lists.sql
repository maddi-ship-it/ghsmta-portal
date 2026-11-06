create table public.playbill_song_lists (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  portal_file_id uuid not null references public.portal_files(id) on delete cascade,
  songs jsonb not null default '[]'::jsonb check (jsonb_typeof(songs) = 'array'),
  extractor_version integer not null default 1 check (extractor_version > 0),
  model text not null,
  extracted_by uuid references public.profiles(id) on delete set null,
  extracted_at timestamptz not null default now(),
  unique (portal_file_id)
);

create index playbill_song_lists_application_idx
  on public.playbill_song_lists(application_id, extracted_at desc);

alter table public.playbill_song_lists enable row level security;

-- The application server performs the adjudication-session access check and
-- returns only the cached list. Keeping this table service-role-only prevents
-- a second, independently maintained client-side permission boundary.
revoke all on table public.playbill_song_lists
from public, anon, authenticated;

grant select, insert, update, delete on table public.playbill_song_lists
to service_role;

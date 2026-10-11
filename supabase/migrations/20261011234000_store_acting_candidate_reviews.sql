-- Candidate approval state is operational data, not an audit-log query.
-- Keeping one row per application avoids scanning the high-volume application
-- audit trail every time an adjudication workspace or School Files is opened.
create table if not exists public.acting_candidate_reviews (
  application_id uuid primary key
    references public.applications(id) on delete cascade,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists acting_candidate_reviews_set_updated_at
  on public.acting_candidate_reviews;
create trigger acting_candidate_reviews_set_updated_at
before update on public.acting_candidate_reviews
for each row execute function public.set_updated_at();

alter table public.acting_candidate_reviews enable row level security;

grant select, insert, update, delete
  on public.acting_candidate_reviews
  to service_role;

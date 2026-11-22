begin;

create table if not exists public.community_testimonials (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  testimonial text not null check (
    char_length(btrim(testimonial)) between 50 and 4000
  ),
  attribution_name text not null check (
    char_length(btrim(attribution_name)) between 1 and 150
  ),
  organization text check (
    organization is null or char_length(btrim(organization)) <= 180
  ),
  relationship text not null check (
    relationship in (
      'student',
      'educator',
      'adjudicator',
      'advisory_member',
      'production_team',
      'parent_guardian',
      'community_partner',
      'other'
    )
  ),
  permission_to_publish boolean not null default false check (
    permission_to_publish = true
  ),
  consented_at timestamptz not null default now(),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'declined')
  ),
  owner_notes text check (
    owner_notes is null or char_length(owner_notes) <= 4000
  ),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or
    (status in ('approved', 'declined') and reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists community_testimonials_submitter_idx
  on public.community_testimonials(submitted_by, created_at desc);

create index if not exists community_testimonials_review_queue_idx
  on public.community_testimonials(status, created_at desc);

drop trigger if exists community_testimonials_set_updated_at
on public.community_testimonials;
create trigger community_testimonials_set_updated_at
before update on public.community_testimonials
for each row execute function public.set_updated_at();

alter table public.community_testimonials enable row level security;
revoke all on table public.community_testimonials from public, anon, authenticated;
grant all on table public.community_testimonials to service_role;

comment on table public.community_testimonials is
  'Private portal testimonial submissions that require Owner review before use.';
comment on column public.community_testimonials.permission_to_publish is
  'Explicit permission from the submitter for GHSMTA to quote and publish the testimonial.';

commit;

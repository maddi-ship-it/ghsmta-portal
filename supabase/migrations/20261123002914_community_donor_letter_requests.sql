begin;

create table if not exists public.community_donor_letter_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  letter_date date not null,
  recipient_name text not null check (
    char_length(btrim(recipient_name)) between 1 and 100
  ),
  recipient_title text not null check (
    char_length(btrim(recipient_title)) between 1 and 100
  ),
  company_name text not null check (
    char_length(btrim(company_name)) between 1 and 120
  ),
  address text not null check (
    char_length(btrim(address)) between 1 and 160
  ),
  city text not null check (
    char_length(btrim(city)) between 1 and 80
  ),
  state text not null check (
    char_length(btrim(state)) between 1 and 30
  ),
  zip text not null check (
    char_length(btrim(zip)) between 1 and 15
  ),
  created_at timestamptz not null default now()
);

create index if not exists community_donor_letter_requests_created_idx
  on public.community_donor_letter_requests(created_at desc);

create index if not exists community_donor_letter_requests_requester_idx
  on public.community_donor_letter_requests(requested_by, created_at desc);

alter table public.community_donor_letter_requests enable row level security;

revoke all on table public.community_donor_letter_requests
  from public, anon, authenticated;
grant select, insert on table public.community_donor_letter_requests
  to authenticated;
grant all on table public.community_donor_letter_requests
  to service_role;

drop policy if exists "requesters and owners read donor letter requests"
  on public.community_donor_letter_requests;
create policy "requesters and owners read donor letter requests"
on public.community_donor_letter_requests
for select
to authenticated
using (
  requested_by = (select auth.uid())
  or (select public.current_user_role()) = 'owner'
);

drop policy if exists "authenticated users create their donor letter requests"
  on public.community_donor_letter_requests;
create policy "authenticated users create their donor letter requests"
on public.community_donor_letter_requests
for insert
to authenticated
with check (requested_by = (select auth.uid()));

comment on table public.community_donor_letter_requests is
  'Private history of generated Lasting Legacy donor letters. Owners can review every request; other users can review only their own.';

commit;

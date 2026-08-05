-- Owner support impersonation audit trail.

create table if not exists public.portal_impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) >= 3),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  exit_reason text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint portal_impersonation_distinct_users_check
    check (owner_user_id <> target_user_id),
  constraint portal_impersonation_end_after_start_check
    check (ended_at is null or ended_at >= started_at)
);

create index if not exists portal_impersonation_sessions_owner_idx
  on public.portal_impersonation_sessions(owner_user_id, started_at desc);

create index if not exists portal_impersonation_sessions_target_idx
  on public.portal_impersonation_sessions(target_user_id, started_at desc);

alter table public.portal_impersonation_sessions enable row level security;

grant select on public.portal_impersonation_sessions to authenticated;

drop policy if exists "owners read impersonation sessions"
on public.portal_impersonation_sessions;

create policy "owners read impersonation sessions"
on public.portal_impersonation_sessions for select to authenticated
using ((select public.current_user_role()) = 'owner');

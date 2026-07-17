-- GHSMTA Awards Backbone: initial role model, application records, assignments,
-- cycles, and row-level security. Run in a new Supabase project.

create extension if not exists pgcrypto;

create type public.app_role as enum (
  'applicant',
  'adjudicator',
  'advisory_member',
  'owner'
);

create type public.application_status as enum (
  'draft',
  'submitted',
  'under_review',
  'complete',
  'withdrawn'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.app_role not null default 'applicant',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.award_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season_year text not null unique,
  opens_at timestamptz,
  closes_at timestamptz,
  is_active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index only_one_active_award_cycle
  on public.award_cycles (is_active)
  where is_active = true;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  county text,
  school_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.award_cycles(id) on delete restrict,
  applicant_user_id uuid not null references public.profiles(id) on delete restrict,
  school_id uuid references public.schools(id) on delete set null,
  school_name text not null,
  production_title text,
  status public.application_status not null default 'draft',
  submitted_at timestamptz,
  form_version integer not null default 1,
  form_data jsonb not null default '{}'::jsonb,
  owner_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, applicant_user_id)
);

create table public.adjudicator_assignments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  adjudicator_user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  assigned_at timestamptz not null default now(),
  unique (application_id, adjudicator_user_id)
);

create table public.application_audit_log (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  old_record jsonb,
  new_record jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger award_cycles_set_updated_at before update on public.award_cycles
for each row execute function public.set_updated_at();
create trigger schools_set_updated_at before update on public.schools
for each row execute function public.set_updated_at();
create trigger applications_set_updated_at before update on public.applications
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    'applicant'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

grant execute on function public.current_user_role() to authenticated;

create or replace function public.activate_award_cycle(target_cycle_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only owners can activate an awards cycle.';
  end if;
  update public.award_cycles set is_active = false where is_active = true;
  update public.award_cycles set is_active = true where id = target_cycle_id;
  if not found then raise exception 'Cycle not found.'; end if;
end;
$$;

grant execute on function public.activate_award_cycle(uuid) to authenticated;

create or replace function public.log_application_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.application_audit_log (
    application_id,
    actor_user_id,
    action,
    old_record,
    new_record
  ) values (
    coalesce(new.id, old.id),
    auth.uid(),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger applications_audit
after insert or update or delete on public.applications
for each row execute function public.log_application_change();

alter table public.profiles enable row level security;
alter table public.award_cycles enable row level security;
alter table public.schools enable row level security;
alter table public.applications enable row level security;
alter table public.adjudicator_assignments enable row level security;
alter table public.application_audit_log enable row level security;

-- Profiles: users can read themselves. Advisory members and owners can read all.
create policy "profiles read own or elevated"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.current_user_role() in ('advisory_member', 'owner')
);

-- Only owners can modify portal roles and profile access.
create policy "owners update profiles"
on public.profiles for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

-- Cycles are visible to signed-in participants; only owners manage them.
create policy "authenticated read cycles"
on public.award_cycles for select to authenticated
using (true);
create policy "owners insert cycles"
on public.award_cycles for insert to authenticated
with check (public.current_user_role() = 'owner');
create policy "owners update cycles"
on public.award_cycles for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners delete cycles"
on public.award_cycles for delete to authenticated
using (public.current_user_role() = 'owner');

-- Schools can be selected by participants. Only owners change the directory.
create policy "authenticated read schools"
on public.schools for select to authenticated
using (true);
create policy "owners manage schools insert"
on public.schools for insert to authenticated
with check (public.current_user_role() = 'owner');
create policy "owners manage schools update"
on public.schools for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage schools delete"
on public.schools for delete to authenticated
using (public.current_user_role() = 'owner');

-- Application visibility exactly mirrors the four requested access levels.
create policy "role scoped application read"
on public.applications for select to authenticated
using (
  applicant_user_id = auth.uid()
  or public.current_user_role() in ('advisory_member', 'owner')
  or exists (
    select 1 from public.adjudicator_assignments aa
    where aa.application_id = applications.id
      and aa.adjudicator_user_id = auth.uid()
  )
);

-- Applicants may create their own application; owners may create on behalf of users.
create policy "applicant or owner application insert"
on public.applications for insert to authenticated
with check (
  (applicant_user_id = auth.uid() and public.current_user_role() = 'applicant')
  or public.current_user_role() = 'owner'
);

-- Applicants can edit only their own draft. Owners can edit every application.
create policy "applicant draft or owner application update"
on public.applications for update to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    applicant_user_id = auth.uid()
    and public.current_user_role() = 'applicant'
    and status = 'draft'
  )
)
with check (
  public.current_user_role() = 'owner'
  or (
    applicant_user_id = auth.uid()
    and public.current_user_role() = 'applicant'
    and status in ('draft', 'submitted')
  )
);

create policy "owners delete applications"
on public.applications for delete to authenticated
using (public.current_user_role() = 'owner');

-- Adjudicators can see their own assignments; advisory and owner can see all.
create policy "assignment read"
on public.adjudicator_assignments for select to authenticated
using (
  adjudicator_user_id = auth.uid()
  or public.current_user_role() in ('advisory_member', 'owner')
);
create policy "owners insert assignments"
on public.adjudicator_assignments for insert to authenticated
with check (public.current_user_role() = 'owner');
create policy "owners update assignments"
on public.adjudicator_assignments for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners delete assignments"
on public.adjudicator_assignments for delete to authenticated
using (public.current_user_role() = 'owner');

create policy "elevated read audit log"
on public.application_audit_log for select to authenticated
using (public.current_user_role() in ('advisory_member', 'owner'));

-- No client insert/update policies are granted for audit rows; the trigger owns writes.

create index applications_cycle_idx on public.applications(cycle_id);
create index applications_applicant_idx on public.applications(applicant_user_id);
create index applications_status_idx on public.applications(status);
create index assignments_adjudicator_idx on public.adjudicator_assignments(adjudicator_user_id);
create index assignments_application_idx on public.adjudicator_assignments(application_id);
create index audit_application_idx on public.application_audit_log(application_id, created_at desc);

-- After creating your own account, promote the first owner in the SQL editor:
-- update public.profiles set role = 'owner' where email = 'you@example.com';

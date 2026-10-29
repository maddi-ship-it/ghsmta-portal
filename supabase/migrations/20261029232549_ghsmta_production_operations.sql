-- GHSMTA Production Operations
--
-- Provides the Schedule, Calls, and Budget workflow in a separate,
-- owner-only GHSMTA workspace. These tables intentionally do not reuse the
-- awards adjudication scheduling tables.

begin;

create table public.ghsmta_operations_productions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references public.award_cycles(id) on delete set null,
  name text not null,
  code text,
  status text not null default 'planning' check (
    status in ('planning', 'active', 'on_hold', 'complete', 'cancelled', 'archived')
  ),
  director text,
  venue text,
  first_rehearsal_date date,
  load_in_date date,
  opening_date date,
  closing_date date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ghsmta_operations_productions_code_unique
  on public.ghsmta_operations_productions (lower(code))
  where nullif(btrim(code), '') is not null;
create index ghsmta_operations_productions_cycle_idx
  on public.ghsmta_operations_productions (cycle_id);
create index ghsmta_operations_productions_status_idx
  on public.ghsmta_operations_productions (status, opening_date);

create table public.ghsmta_operations_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ghsmta_operations_departments_name_unique
  on public.ghsmta_operations_departments (lower(name));
create index ghsmta_operations_departments_active_idx
  on public.ghsmta_operations_departments (active, sort_order, name);

create table public.ghsmta_operations_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_type text,
  address text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ghsmta_operations_locations_name_unique
  on public.ghsmta_operations_locations (lower(name));
create index ghsmta_operations_locations_active_idx
  on public.ghsmta_operations_locations (active, name);

create table public.ghsmta_operations_schedule_events (
  id uuid primary key default gen_random_uuid(),
  production_id uuid references public.ghsmta_operations_productions(id) on delete cascade,
  department_id uuid references public.ghsmta_operations_departments(id) on delete set null,
  location_id uuid references public.ghsmta_operations_locations(id) on delete set null,
  title text not null,
  event_type text not null default 'general' check (
    event_type in (
      'general', 'meeting', 'deadline', 'rehearsal', 'load_in', 'load_out',
      'tech', 'dress_rehearsal', 'performance', 'maintenance', 'strike',
      'announcement'
    )
  ),
  status text not null default 'scheduled' check (
    status in ('draft', 'scheduled', 'confirmed', 'complete', 'cancelled')
  ),
  event_date date not null,
  start_time time,
  end_time time,
  all_day boolean not null default false,
  timezone text not null default 'America/New_York',
  visibility text not null default 'owners' check (
    visibility in ('owners', 'internal', 'public')
  ),
  is_deadline boolean not null default false,
  is_announcement boolean not null default false,
  description text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time)
);

create index ghsmta_operations_schedule_events_date_idx
  on public.ghsmta_operations_schedule_events (event_date, start_time);
create index ghsmta_operations_schedule_events_production_idx
  on public.ghsmta_operations_schedule_events (production_id, event_date);
create index ghsmta_operations_schedule_events_department_idx
  on public.ghsmta_operations_schedule_events (department_id);
create index ghsmta_operations_schedule_events_location_idx
  on public.ghsmta_operations_schedule_events (location_id);
create index ghsmta_operations_schedule_events_status_idx
  on public.ghsmta_operations_schedule_events (status, event_date);

create table public.ghsmta_operations_calls (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.ghsmta_operations_productions(id) on delete cascade,
  schedule_event_id uuid references public.ghsmta_operations_schedule_events(id) on delete set null,
  location_id uuid references public.ghsmta_operations_locations(id) on delete set null,
  call_date date not null,
  start_time time,
  end_time time,
  meal_1_start time,
  meal_1_end time,
  meal_2_start time,
  meal_2_end time,
  call_type text not null default 'general' check (
    call_type in (
      'load_in', 'load_out', 'shop_build', 'rehearsal', 'tech',
      'dress_rehearsal', 'performance', 'maintenance', 'strike', 'general'
    )
  ),
  status text not null default 'draft' check (
    status in ('draft', 'scheduled', 'final', 'cancelled', 'archived')
  ),
  description text not null,
  notes text,
  original_budget numeric(12,2) not null default 0,
  is_final boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time),
  check (meal_1_end is null or meal_1_start is null or meal_1_end > meal_1_start),
  check (meal_2_end is null or meal_2_start is null or meal_2_end > meal_2_start)
);

create index ghsmta_operations_calls_production_idx
  on public.ghsmta_operations_calls (production_id, call_date);
create index ghsmta_operations_calls_schedule_event_idx
  on public.ghsmta_operations_calls (schedule_event_id);
create index ghsmta_operations_calls_location_idx
  on public.ghsmta_operations_calls (location_id);
create index ghsmta_operations_calls_status_idx
  on public.ghsmta_operations_calls (status, call_date);

create table public.ghsmta_operations_call_assignments (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.ghsmta_operations_calls(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  department_id uuid references public.ghsmta_operations_departments(id) on delete set null,
  crew_name text,
  job_title text,
  employment_type text,
  assignment_status text not null default 'scheduled' check (
    assignment_status in ('scheduled', 'confirmed', 'declined', 'complete', 'cancelled')
  ),
  time_1_start time,
  time_1_end time,
  time_2_start time,
  time_2_end time,
  time_3_start time,
  time_3_end time,
  hourly_rate numeric(10,2),
  flat_rate numeric(10,2),
  estimated_hours numeric(8,2),
  actual_hours numeric(8,2),
  estimated_pay numeric(12,2),
  actual_pay numeric(12,2),
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile_id is not null or nullif(btrim(crew_name), '') is not null),
  check (time_1_end is null or time_1_start is null or time_1_end > time_1_start),
  check (time_2_end is null or time_2_start is null or time_2_end > time_2_start),
  check (time_3_end is null or time_3_start is null or time_3_end > time_3_start)
);

create index ghsmta_operations_call_assignments_call_idx
  on public.ghsmta_operations_call_assignments (call_id);
create index ghsmta_operations_call_assignments_profile_idx
  on public.ghsmta_operations_call_assignments (profile_id);
create index ghsmta_operations_call_assignments_department_idx
  on public.ghsmta_operations_call_assignments (department_id);

create table public.ghsmta_operations_budget_lines (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.ghsmta_operations_productions(id) on delete cascade,
  gl_code text not null,
  department text,
  original_budget numeric(12,2) not null default 0,
  approved_changes numeric(12,2) not null default 0,
  current_budget numeric(12,2) generated always as (original_budget + approved_changes) stored,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_id, gl_code)
);

create index ghsmta_operations_budget_lines_production_idx
  on public.ghsmta_operations_budget_lines (production_id, gl_code);

create table public.ghsmta_operations_budget_transactions (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.ghsmta_operations_productions(id) on delete cascade,
  budget_line_id uuid references public.ghsmta_operations_budget_lines(id) on delete set null,
  gl_code text not null,
  department text,
  amount numeric(12,2) not null,
  status text not null default 'requested' check (
    status in ('requested', 'approved', 'committed', 'invoiced', 'estimated', 'paid', 'cancelled')
  ),
  description text not null,
  vendor_name text,
  invoice_received boolean not null default false,
  receipt_uploaded boolean not null default false,
  document_link text,
  transaction_date date not null default current_date,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ghsmta_operations_budget_transactions_production_idx
  on public.ghsmta_operations_budget_transactions (production_id, transaction_date desc);
create index ghsmta_operations_budget_transactions_line_idx
  on public.ghsmta_operations_budget_transactions (budget_line_id);
create index ghsmta_operations_budget_transactions_status_idx
  on public.ghsmta_operations_budget_transactions (status, transaction_date desc);

create trigger ghsmta_operations_productions_set_updated_at
before update on public.ghsmta_operations_productions
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_departments_set_updated_at
before update on public.ghsmta_operations_departments
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_locations_set_updated_at
before update on public.ghsmta_operations_locations
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_schedule_events_set_updated_at
before update on public.ghsmta_operations_schedule_events
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_calls_set_updated_at
before update on public.ghsmta_operations_calls
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_call_assignments_set_updated_at
before update on public.ghsmta_operations_call_assignments
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_budget_lines_set_updated_at
before update on public.ghsmta_operations_budget_lines
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_budget_transactions_set_updated_at
before update on public.ghsmta_operations_budget_transactions
for each row execute function public.set_updated_at();

alter table public.ghsmta_operations_productions enable row level security;
alter table public.ghsmta_operations_departments enable row level security;
alter table public.ghsmta_operations_locations enable row level security;
alter table public.ghsmta_operations_schedule_events enable row level security;
alter table public.ghsmta_operations_calls enable row level security;
alter table public.ghsmta_operations_call_assignments enable row level security;
alter table public.ghsmta_operations_budget_lines enable row level security;
alter table public.ghsmta_operations_budget_transactions enable row level security;

create policy "owners manage GHSMTA operations productions"
on public.ghsmta_operations_productions for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage GHSMTA operations departments"
on public.ghsmta_operations_departments for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage GHSMTA operations locations"
on public.ghsmta_operations_locations for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage GHSMTA operations schedule events"
on public.ghsmta_operations_schedule_events for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage GHSMTA operations calls"
on public.ghsmta_operations_calls for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage GHSMTA operations call assignments"
on public.ghsmta_operations_call_assignments for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage GHSMTA operations budget lines"
on public.ghsmta_operations_budget_lines for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
create policy "owners manage GHSMTA operations budget transactions"
on public.ghsmta_operations_budget_transactions for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

insert into public.ghsmta_operations_departments (name, sort_order)
values
  ('Administration', 10),
  ('Adjudication', 20),
  ('Awards Ceremony', 30),
  ('Education & Community', 40),
  ('Marketing & Communications', 50),
  ('Production', 60),
  ('Technical', 70),
  ('Venue Operations', 80)
on conflict do nothing;

comment on table public.ghsmta_operations_productions is
  'Owner-managed GHSMTA internal productions used by Schedule, Calls, and Budgets.';
comment on table public.ghsmta_operations_schedule_events is
  'GHSMTA internal production calendar; separate from awards adjudication schedule slots.';

commit;

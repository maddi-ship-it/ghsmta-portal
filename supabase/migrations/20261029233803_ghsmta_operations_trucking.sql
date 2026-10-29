-- GHSMTA Production Operations: Trucking
--
-- Adds owner-managed vehicles, moves, and route stops to the internal
-- Production workspace. These records are separate from school adjudication.

begin;

create table public.ghsmta_operations_truck_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_name text not null,
  vehicle_type text,
  plate_number text,
  current_location text,
  door_type text,
  capacity_notes text,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ghsmta_operations_truck_vehicles_name_unique
  on public.ghsmta_operations_truck_vehicles (lower(vehicle_name));
create index ghsmta_operations_truck_vehicles_active_idx
  on public.ghsmta_operations_truck_vehicles (active, sort_order, vehicle_name);

create table public.ghsmta_operations_truck_moves (
  id uuid primary key default gen_random_uuid(),
  production_id uuid references public.ghsmta_operations_productions(id) on delete set null,
  move_title text not null,
  move_type text not null default 'delivery' check (
    move_type in (
      'pickup', 'delivery', 'transfer', 'return', 'strike', 'shop_run',
      'vendor_run', 'storage_run', 'rental_pickup', 'rental_return', 'other'
    )
  ),
  move_status text not null default 'draft' check (
    move_status in (
      'draft', 'requested', 'approved', 'scheduled', 'loading', 'in_transit',
      'delivered', 'completed', 'cancelled'
    )
  ),
  priority text not null default 'normal' check (
    priority in ('low', 'normal', 'high', 'urgent')
  ),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  truck_vehicle_id uuid references public.ghsmta_operations_truck_vehicles(id) on delete set null,
  driver_profile_id uuid references public.profiles(id) on delete set null,
  driver_name text,
  internal_notes text,
  public_notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);

create index ghsmta_operations_truck_moves_production_idx
  on public.ghsmta_operations_truck_moves (production_id, scheduled_start);
create index ghsmta_operations_truck_moves_vehicle_idx
  on public.ghsmta_operations_truck_moves (truck_vehicle_id, scheduled_start);
create index ghsmta_operations_truck_moves_driver_idx
  on public.ghsmta_operations_truck_moves (driver_profile_id, scheduled_start);
create index ghsmta_operations_truck_moves_status_idx
  on public.ghsmta_operations_truck_moves (move_status, scheduled_start);

create table public.ghsmta_operations_truck_stops (
  id uuid primary key default gen_random_uuid(),
  truck_move_id uuid not null references public.ghsmta_operations_truck_moves(id) on delete cascade,
  stop_order integer not null default 0,
  stop_type text not null default 'stop' check (
    stop_type in ('pickup', 'delivery', 'stop', 'return', 'storage', 'vendor', 'shop', 'other')
  ),
  action_label text,
  location_id uuid references public.ghsmta_operations_locations(id) on delete set null,
  custom_location_name text,
  custom_address text,
  scheduled_arrival timestamptz,
  scheduled_departure timestamptz,
  contact_name text,
  contact_phone text,
  contact_email text,
  stop_notes text,
  trailer_label text,
  show_on_schedule boolean not null default true,
  is_complete boolean not null default false,
  driver_profile_id uuid references public.profiles(id) on delete set null,
  driver_name text,
  truck_vehicle_id uuid references public.ghsmta_operations_truck_vehicles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    scheduled_departure is null
    or scheduled_arrival is null
    or scheduled_departure >= scheduled_arrival
  )
);

create index ghsmta_operations_truck_stops_move_idx
  on public.ghsmta_operations_truck_stops (truck_move_id, stop_order, scheduled_arrival);
create index ghsmta_operations_truck_stops_location_idx
  on public.ghsmta_operations_truck_stops (location_id);
create index ghsmta_operations_truck_stops_vehicle_idx
  on public.ghsmta_operations_truck_stops (truck_vehicle_id);
create index ghsmta_operations_truck_stops_driver_idx
  on public.ghsmta_operations_truck_stops (driver_profile_id);

create trigger ghsmta_operations_truck_vehicles_set_updated_at
before update on public.ghsmta_operations_truck_vehicles
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_truck_moves_set_updated_at
before update on public.ghsmta_operations_truck_moves
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_truck_stops_set_updated_at
before update on public.ghsmta_operations_truck_stops
for each row execute function public.set_updated_at();

alter table public.ghsmta_operations_truck_vehicles enable row level security;
alter table public.ghsmta_operations_truck_moves enable row level security;
alter table public.ghsmta_operations_truck_stops enable row level security;

grant select, insert, update, delete on public.ghsmta_operations_truck_vehicles to authenticated;
grant select, insert, update, delete on public.ghsmta_operations_truck_moves to authenticated;
grant select, insert, update, delete on public.ghsmta_operations_truck_stops to authenticated;

create policy "owners manage GHSMTA operations truck vehicles"
on public.ghsmta_operations_truck_vehicles for all to authenticated
using ((select public.current_user_role()) = 'owner')
with check ((select public.current_user_role()) = 'owner');
create policy "owners manage GHSMTA operations truck moves"
on public.ghsmta_operations_truck_moves for all to authenticated
using ((select public.current_user_role()) = 'owner')
with check ((select public.current_user_role()) = 'owner');
create policy "owners manage GHSMTA operations truck stops"
on public.ghsmta_operations_truck_stops for all to authenticated
using ((select public.current_user_role()) = 'owner')
with check ((select public.current_user_role()) = 'owner');

comment on table public.ghsmta_operations_truck_moves is
  'Owner-managed GHSMTA production truck movements and logistics.';
comment on table public.ghsmta_operations_truck_stops is
  'Ordered pickup, delivery, and route stops for GHSMTA truck movements.';

commit;

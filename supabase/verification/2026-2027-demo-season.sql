-- GHSMTA 2026-2027 demo-season verification

select
  id,
  cycle_key,
  name,
  season_year,
  program_type,
  status,
  is_active,
  opens_at,
  closes_at
from public.award_cycles
order by is_active desc, season_year desc, created_at desc;

select
  count(*) filter (where is_archived = false) as live_applications,
  count(*) filter (
    where is_archived = false
      and source_system = 'ghsmta-demo-2026-2027'
  ) as live_demo_applications,
  count(*) filter (where is_archived = true) as archived_applications
from public.applications;

select
  application.school_name,
  application.production_title,
  profile.email,
  application.status,
  application.is_archived
from public.applications application
left join public.profiles profile
  on profile.id = application.applicant_user_id
where application.source_system = 'ghsmta-demo-2026-2027'
order by application.school_name;

select
  slot.title,
  slot.starts_at,
  slot.ends_at,
  slot.status,
  booking.application_id is not null as booked
from public.schedule_slots slot
left join public.schedule_school_bookings booking
  on booking.slot_id = slot.id
join public.award_cycles cycle
  on cycle.id = slot.cycle_id
where cycle.cycle_key = '2026-2027-directors'
order by slot.starts_at;

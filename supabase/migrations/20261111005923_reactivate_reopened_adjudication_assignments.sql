-- Completing adjudication removes the assignment from the active panel. If an
-- Owner later reopens that scorecard, the assignment must become active again.
-- Repair records reopened before the application action cleared removed_at.
update public.adjudicator_assignments
set removed_at = null
where status = 'reopened'
  and removed_at is not null;

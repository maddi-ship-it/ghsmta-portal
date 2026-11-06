-- Run after 20261106020051_allow_schedule_observers_to_read_booked_applications.sql.

do $$
declare
  observer_policy_expression text;
begin
  if exists (
    select 1
    from pg_policy
    where polrelid = 'public.applications'::regclass
      and polname = 'scheduled shadows read booked applications'
  ) then
    raise exception 'The shadow-only application access policy still exists.';
  end if;

  select pg_get_expr(policy.polqual, policy.polrelid)
  into observer_policy_expression
  from pg_policy policy
  where policy.polrelid = 'public.applications'::regclass
    and policy.polname = 'scheduled observers read booked applications';

  if observer_policy_expression is null then
    raise exception 'The schedule observer application access policy is missing.';
  end if;

  if observer_policy_expression not like '%understudy%'
     or observer_policy_expression not like '%shadow%'
     or observer_policy_expression not like '%schedule_school_bookings%'
     or observer_policy_expression not like '%schedule_slot_staff%'
  then
    raise exception 'The schedule observer policy does not cover both observer modes and booked shows.';
  end if;
end $$;

select
  'schedule observer application access verification passed' as result,
  now() as verified_at;

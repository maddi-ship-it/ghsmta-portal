-- GHSMTA unified rollout verification
-- Run after migration 022 succeeds.

select
  to_regclass('public.schedule_slot_waitlist') as schedule_slot_waitlist,
  to_regprocedure('public.save_all_adjudication_category_proposals(uuid,jsonb)')
    as save_all_category_proposals,
  to_regprocedure('public.submit_eligibility_appeal(uuid,uuid,text,boolean,text,text,text,boolean)')
    as submit_eligibility_appeal,
  to_regprocedure('public.book_schedule_slot(uuid,uuid)')
    as concurrency_safe_booking;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in (
    'preferred_name',
    'phone_e164',
    'phone_verified_at',
    'phone_required_at',
    'pronouns',
    'organization',
    'notification_preferences',
    'mfa_required',
    'mfa_grace_until'
  )
order by column_name;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'portal_files'
  and column_name in (
    'display_name',
    'person_name',
    'award_category',
    'role_or_character',
    'designer_name',
    'phonetic_spelling',
    'file_notes',
    'production_name'
  )
order by column_name;

select
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'appeals'
  and column_name = 'appeal_type';

select
  pubname,
  schemaname,
  tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
    'schedule_slots',
    'schedule_school_bookings',
    'schedule_slot_waitlist'
  )
order by tablename;

select
  role,
  count(*) as users,
  count(*) filter (where mfa_required) as mfa_required_users,
  count(*) filter (
    where phone_verified_at is not null
  ) as verified_phone_users
from public.profiles
group by role
order by role;

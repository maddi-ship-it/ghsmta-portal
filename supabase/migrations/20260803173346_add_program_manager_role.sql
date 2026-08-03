-- Add the Program Manager authorization tier in its own committed migration.
-- PostgreSQL requires a newly added enum value to be committed before later
-- migrations can safely reference it in policies and functions.

alter type public.app_role
  add value if not exists 'program_manager' after 'advisory_member';

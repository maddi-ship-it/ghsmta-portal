-- Add the Production authorization tier in its own committed migration.
-- PostgreSQL requires a newly added enum value to be committed before later
-- migrations can safely reference it.

alter type public.app_role
  add value if not exists 'production' after 'program_manager';

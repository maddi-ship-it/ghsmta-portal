-- Run after 20260802231950_production_release_billing_chat_schedule_theme.sql.
-- Every failed assertion aborts the check with a descriptive error.

do $$
declare
  missing_tables text[];
  reference_limit bigint;
  chat_limit bigint;
  option_count integer;
begin
  select array_agg(expected.name)
  into missing_tables
  from (
    values
      ('cycle_invoice_options'),
      ('school_invoices'),
      ('invoice_delivery_log'),
      ('chat_reactions'),
      ('chat_attachments')
  ) expected(name)
  where to_regclass('public.' || expected.name) is null;

  if missing_tables is not null then
    raise exception 'Missing release tables: %', missing_tables;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'theme_preference'
  ) then
    raise exception 'profiles.theme_preference is missing.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schedule_slot_staff'
      and column_name = 'participation_mode'
  ) then
    raise exception 'schedule_slot_staff.participation_mode is missing.';
  end if;

  select file_size_limit into reference_limit
  from storage.buckets where id = 'reference-documents';
  select file_size_limit into chat_limit
  from storage.buckets where id = 'chat-files';

  if reference_limit is distinct from 524288000 then
    raise exception 'Reference document limit is %, expected 524288000.', reference_limit;
  end if;
  if chat_limit is distinct from 26214400 then
    raise exception 'Chat file limit is %, expected 26214400.', chat_limit;
  end if;

  select count(*) into option_count
  from public.award_cycles cycle
  where (
    select count(*) from public.cycle_invoice_options option_record
    where option_record.cycle_id = cycle.id
  ) < 4;
  if option_count > 0 then
    raise exception '% cycle(s) do not have all four billing options.', option_count;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'school_invoices'
      and policyname = 'school teams read delivered invoices'
  ) then
    raise exception 'School invoice read policy is missing.';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'set_my_theme_preference'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'Theme preference RPC is missing.';
  end if;

  raise notice 'Production release schema verification passed.';
end;
$$;

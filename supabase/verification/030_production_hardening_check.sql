-- Run after 20260803011303_production_hardening_release.sql.
do $$
declare
  missing_columns text[];
begin
  select array_agg(required.column_name)
  into missing_columns
  from (
    values
      ('delivery_status'), ('last_delivery_at'),
      ('reminder_claimed_at'), ('reminder_claim_token'),
      ('voided_at'), ('voided_by'), ('void_reason')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'school_invoices'
      and column_info.column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'Missing school_invoices columns: %', missing_columns;
  end if;

  if to_regclass('public.api_usage_windows') is null then
    raise exception 'api_usage_windows was not created.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.api_usage_windows'::regclass and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on api_usage_windows.';
  end if;

  if to_regprocedure('public.consume_api_quota(text,integer,integer)') is null then
    raise exception 'consume_api_quota RPC is missing.';
  end if;

  if to_regprocedure('public.claim_due_invoice_reminders(uuid,integer)') is null then
    raise exception 'claim_due_invoice_reminders RPC is missing.';
  end if;

  if exists (
    select 1 from public.profiles
    where active = true
      and (mfa_required is not true or mfa_grace_until <= now())
  ) then
    raise exception 'One or more active profiles did not receive the MFA grace reset.';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'chat-files'
      and file_size_limit = 26214400
      and allowed_mime_types is not null
  ) then
    raise exception 'chat-files bucket policy is incomplete.';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'reference-documents'
      and file_size_limit = 209715200
      and allowed_mime_types is not null
  ) then
    raise exception 'reference-documents bucket policy is incomplete.';
  end if;
end $$;

select
  'production hardening verification passed' as result,
  now() as verified_at;

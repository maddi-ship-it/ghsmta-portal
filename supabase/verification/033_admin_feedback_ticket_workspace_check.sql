-- Run after 20260803142145_admin_feedback_ticket_workspace.sql.
do $$
declare
  missing_columns text[];
  notify_function text;
begin
  select array_agg(required.name)
  into missing_columns
  from (
    values ('status_changed_at'), ('status_changed_by'), ('closed_at'), ('closed_by')
  ) required(name)
  where not exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'public'
      and column_record.table_name = 'portal_feedback_requests'
      and column_record.column_name = required.name
  );

  if missing_columns is not null then
    raise exception 'Missing feedback audit columns: %', missing_columns;
  end if;

  if to_regclass('public.portal_feedback_events') is null then
    raise exception 'portal_feedback_events was not created.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.portal_feedback_events'::regclass
      and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on portal_feedback_events.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'portal_feedback_ticket_audit'
      and not tgisinternal
  ) then
    raise exception 'Feedback audit trigger is missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'portal_feedback_ticket_created'
      and not tgisinternal
  ) then
    raise exception 'Feedback ticket creation audit trigger is missing.';
  end if;

  select pg_get_functiondef('public.notify_feedback_submitted()'::regprocedure)
  into notify_function;
  if position('/portal/admin/feedback/' in notify_function) = 0 then
    raise exception 'New-ticket notifications do not point to the Admin ticket detail page.';
  end if;
end $$;

select
  'admin feedback ticket workspace verification passed' as result,
  now() as verified_at;

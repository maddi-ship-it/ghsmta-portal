do $$
declare
  missing_columns text[];
begin
  select array_agg(expected.column_name order by expected.column_name)
  into missing_columns
  from (
    values
      ('message_body_snapshot'),
      ('message_subject_snapshot')
  ) expected(column_name)
  where not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'school_invoices'
      and column_info.column_name = expected.column_name
  );

  if missing_columns is not null then
    raise exception 'Missing school invoice message columns: %', missing_columns;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'school_invoices_message_subject_length_check'
      and conrelid = 'public.school_invoices'::regclass
  ) then
    raise exception 'Missing school invoice subject length constraint.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'school_invoices_message_body_length_check'
      and conrelid = 'public.school_invoices'::regclass
  ) then
    raise exception 'Missing school invoice body length constraint.';
  end if;
end $$;

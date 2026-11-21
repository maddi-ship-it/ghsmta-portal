-- Run after 20261121235031_raise_school_file_upload_limit_to_200mb.sql.
do $$
declare
  file_constraint text;
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'portal-files'
      and file_size_limit = 209715200
  ) then
    raise exception 'The School Files bucket does not have the 200 MiB limit.';
  end if;

  select pg_get_constraintdef(constraint_record.oid)
  into file_constraint
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.portal_files'::regclass
    and constraint_record.conname = 'portal_files_file_size_check';

  if file_constraint is null
    or position('209715200' in file_constraint) = 0
    or position('52428800' in file_constraint) = 0 then
    raise exception 'The School Files metadata constraint does not enforce the 200 MiB application and 50 MiB general limits.';
  end if;
end $$;

select
  'school file upload 200 MiB verification passed' as result,
  now() as verified_at;

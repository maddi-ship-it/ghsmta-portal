-- Run after 20260803141257_owner_reference_upload_500mb.sql.
do $$
declare
  file_constraint text;
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'reference-documents'
      and file_size_limit = 524288000
      and allowed_mime_types is not null
  ) then
    raise exception 'The reference document bucket does not have the complete 500 MiB policy.';
  end if;

  select pg_get_constraintdef(constraint_record.oid)
  into file_constraint
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.reference_documents'::regclass
    and constraint_record.conname = 'reference_documents_file_size_check';

  if file_constraint is null
    or position('524288000' in file_constraint) = 0 then
    raise exception 'The reference document metadata constraint does not enforce 500 MiB.';
  end if;
end $$;

select
  'owner reference upload verification passed' as result,
  now() as verified_at;

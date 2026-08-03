-- Allow Owners to store reference documents up to 500 MiB. Existing storage
-- object policies continue to restrict uploads to the Owner role.

begin;

alter table public.reference_documents
  drop constraint if exists reference_documents_file_size_check;
alter table public.reference_documents
  add constraint reference_documents_file_size_check check (
    file_size is null or (file_size > 0 and file_size <= 524288000)
  );

update storage.buckets
set file_size_limit = 524288000
where id = 'reference-documents';

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'reference-documents'
      and file_size_limit = 524288000
  ) then
    raise exception 'reference-documents bucket is missing or its 500 MiB limit was not applied.';
  end if;
end $$;

commit;

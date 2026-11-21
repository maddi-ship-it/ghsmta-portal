-- School Files use the portal-files bucket. Allow application uploads up to
-- 200 MiB while keeping every other portal upload type capped at 50 MiB.

begin;

update storage.buckets
set file_size_limit = 209715200
where id = 'portal-files';

alter table public.portal_files
  drop constraint if exists portal_files_file_size_check;
alter table public.portal_files
  add constraint portal_files_file_size_check check (
    file_size is null
    or (
      file_size > 0
      and (
        (context_type = 'application' and file_size <= 209715200)
        or (context_type <> 'application' and file_size <= 52428800)
      )
    )
  ) not valid;

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'portal-files'
      and file_size_limit = 209715200
  ) then
    raise exception 'portal-files bucket is missing or its 200 MiB limit was not applied.';
  end if;
end $$;

commit;

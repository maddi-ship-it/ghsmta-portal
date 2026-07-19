-- GHSMTA owner admin consolidation and role-based reference document library.

create table if not exists public.reference_documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint,
  description text,
  visible_to_applicants boolean not null default false,
  visible_to_adjudicators boolean not null default false,
  visible_to_advisory boolean not null default false,
  uploaded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_documents_audience_check check (
    visible_to_applicants
    or visible_to_adjudicators
    or visible_to_advisory
  ),
  constraint reference_documents_file_size_check check (
    file_size is null or (file_size > 0 and file_size <= 52428800)
  )
);

create index if not exists reference_documents_created_at_idx
  on public.reference_documents (created_at desc);

create index if not exists reference_documents_audience_idx
  on public.reference_documents (
    visible_to_applicants,
    visible_to_adjudicators,
    visible_to_advisory
  );

alter table public.reference_documents enable row level security;

drop policy if exists "reference documents visible by role" on public.reference_documents;
create policy "reference documents visible by role"
on public.reference_documents
for select
to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'applicant'
    and visible_to_applicants
  )
  or (
    public.current_user_role() = 'adjudicator'
    and visible_to_adjudicators
  )
  or (
    public.current_user_role() = 'advisory_member'
    and visible_to_advisory
  )
);

drop policy if exists "owners insert reference documents" on public.reference_documents;
create policy "owners insert reference documents"
on public.reference_documents
for insert
to authenticated
with check (
  public.current_user_role() = 'owner'
  and uploaded_by = auth.uid()
);

drop policy if exists "owners update reference documents" on public.reference_documents;
create policy "owners update reference documents"
on public.reference_documents
for update
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "owners delete reference documents" on public.reference_documents;
create policy "owners delete reference documents"
on public.reference_documents
for delete
to authenticated
using (public.current_user_role() = 'owner');

grant select on public.reference_documents to authenticated;
grant insert, update, delete on public.reference_documents to authenticated;

drop trigger if exists set_reference_documents_updated_at on public.reference_documents;
create trigger set_reference_documents_updated_at
before update on public.reference_documents
for each row execute function public.set_updated_at();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'reference-documents',
  'reference-documents',
  false,
  52428800,
  null
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "reference document objects visible by audience" on storage.objects;
create policy "reference document objects visible by audience"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'reference-documents'
  and (
    public.current_user_role() = 'owner'
    or exists (
      select 1
      from public.reference_documents document
      where document.storage_path = name
        and (
          (
            public.current_user_role() = 'applicant'
            and document.visible_to_applicants
          )
          or (
            public.current_user_role() = 'adjudicator'
            and document.visible_to_adjudicators
          )
          or (
            public.current_user_role() = 'advisory_member'
            and document.visible_to_advisory
          )
        )
    )
  )
);

drop policy if exists "owners upload reference document objects" on storage.objects;
create policy "owners upload reference document objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'reference-documents'
  and public.current_user_role() = 'owner'
);

drop policy if exists "owners update reference document objects" on storage.objects;
create policy "owners update reference document objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'reference-documents'
  and public.current_user_role() = 'owner'
)
with check (
  bucket_id = 'reference-documents'
  and public.current_user_role() = 'owner'
);

drop policy if exists "owners delete reference document objects" on storage.objects;
create policy "owners delete reference document objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'reference-documents'
  and public.current_user_role() = 'owner'
);

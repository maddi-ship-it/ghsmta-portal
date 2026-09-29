-- SharePoint-style folder metadata for the reference document library.
-- Storage objects keep their stable keys; moving a document only changes its
-- folder metadata, avoiding expensive object copies for large uploads.
create table if not exists public.reference_document_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.reference_document_folders(id) on delete restrict,
  name text not null,
  visible_to_applicants boolean not null default false,
  visible_to_adjudicators boolean not null default false,
  visible_to_advisory boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_document_folders_name_check check (
    btrim(name) <> '' and char_length(btrim(name)) <= 120
  ),
  constraint reference_document_folders_audience_check check (
    visible_to_applicants
    or visible_to_adjudicators
    or visible_to_advisory
  )
);

create unique index if not exists reference_document_folders_sibling_name_idx
  on public.reference_document_folders (
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );

create index if not exists reference_document_folders_parent_idx
  on public.reference_document_folders (parent_id, name);

alter table public.reference_document_folders enable row level security;

drop policy if exists "reference folders visible by role"
on public.reference_document_folders;
create policy "reference folders visible by role"
on public.reference_document_folders
for select
to authenticated
using (
  (select public.current_user_role()) = 'owner'
  or (
    (select public.current_user_role()) = 'applicant'
    and visible_to_applicants
  )
  or (
    (select public.current_user_role()) = 'adjudicator'
    and visible_to_adjudicators
  )
  or (
    (select public.current_user_role()) = 'advisory_member'
    and visible_to_advisory
  )
);

drop policy if exists "owners insert reference folders"
on public.reference_document_folders;
create policy "owners insert reference folders"
on public.reference_document_folders
for insert
to authenticated
with check (
  (select public.current_user_role()) = 'owner'
  and created_by = (select auth.uid())
);

drop policy if exists "owners update reference folders"
on public.reference_document_folders;
create policy "owners update reference folders"
on public.reference_document_folders
for update
to authenticated
using ((select public.current_user_role()) = 'owner')
with check ((select public.current_user_role()) = 'owner');

drop policy if exists "owners delete reference folders"
on public.reference_document_folders;
create policy "owners delete reference folders"
on public.reference_document_folders
for delete
to authenticated
using ((select public.current_user_role()) = 'owner');

grant select, insert, update, delete
on public.reference_document_folders to authenticated;

drop trigger if exists set_reference_document_folders_updated_at
on public.reference_document_folders;
create trigger set_reference_document_folders_updated_at
before update on public.reference_document_folders
for each row execute function public.set_updated_at();

alter table public.reference_documents
  add column if not exists folder_id uuid
  references public.reference_document_folders(id) on delete restrict;

create index if not exists reference_documents_folder_idx
  on public.reference_documents (folder_id, created_at desc);

create or replace function public.enforce_reference_folder_hierarchy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_folder public.reference_document_folders%rowtype;
begin
  new.name := btrim(new.name);

  if new.parent_id = new.id then
    raise exception 'A folder cannot contain itself.';
  end if;

  if new.parent_id is not null then
    if exists (
      with recursive ancestors as (
        select folder.id, folder.parent_id
        from public.reference_document_folders folder
        where folder.id = new.parent_id
        union all
        select folder.id, folder.parent_id
        from public.reference_document_folders folder
        join ancestors on folder.id = ancestors.parent_id
      )
      select 1 from ancestors where id = new.id
    ) then
      raise exception 'A folder cannot be moved inside one of its descendants.';
    end if;

    select * into parent_folder
    from public.reference_document_folders
    where id = new.parent_id;

    if parent_folder.id is null then
      raise exception 'Parent folder not found.';
    end if;

    if (new.visible_to_applicants and not parent_folder.visible_to_applicants)
      or (new.visible_to_adjudicators and not parent_folder.visible_to_adjudicators)
      or (new.visible_to_advisory and not parent_folder.visible_to_advisory)
    then
      raise exception 'A subfolder cannot have broader audience access than its parent folder.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if exists (
      select 1
      from public.reference_document_folders child
      where child.parent_id = new.id
        and (
          (child.visible_to_applicants and not new.visible_to_applicants)
          or (child.visible_to_adjudicators and not new.visible_to_adjudicators)
          or (child.visible_to_advisory and not new.visible_to_advisory)
        )
    ) then
      raise exception 'Update the audience access of this folder''s subfolders first.';
    end if;

    if exists (
      select 1
      from public.reference_documents document
      where document.folder_id = new.id
        and (
          (document.visible_to_applicants and not new.visible_to_applicants)
          or (document.visible_to_adjudicators and not new.visible_to_adjudicators)
          or (document.visible_to_advisory and not new.visible_to_advisory)
        )
    ) then
      raise exception 'Update or move this folder''s documents before narrowing its audience access.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_reference_folder_hierarchy()
from public, anon, authenticated;

drop trigger if exists enforce_reference_folder_hierarchy
on public.reference_document_folders;
create trigger enforce_reference_folder_hierarchy
before insert or update of parent_id, name, visible_to_applicants,
  visible_to_adjudicators, visible_to_advisory
on public.reference_document_folders
for each row execute function public.enforce_reference_folder_hierarchy();

create or replace function public.enforce_reference_document_folder_audience()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  selected_folder public.reference_document_folders%rowtype;
begin
  if new.folder_id is null then
    return new;
  end if;

  select * into selected_folder
  from public.reference_document_folders
  where id = new.folder_id;

  if selected_folder.id is null then
    raise exception 'Reference document folder not found.';
  end if;

  if (new.visible_to_applicants and not selected_folder.visible_to_applicants)
    or (new.visible_to_adjudicators and not selected_folder.visible_to_adjudicators)
    or (new.visible_to_advisory and not selected_folder.visible_to_advisory)
  then
    raise exception 'The selected folder does not include every audience for this document.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_reference_document_folder_audience()
from public, anon, authenticated;

drop trigger if exists enforce_reference_document_folder_audience
on public.reference_documents;
create trigger enforce_reference_document_folder_audience
before insert or update of folder_id, visible_to_applicants,
  visible_to_adjudicators, visible_to_advisory
on public.reference_documents
for each row execute function public.enforce_reference_document_folder_audience();

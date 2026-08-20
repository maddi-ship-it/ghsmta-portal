create or replace function public.enforce_acceptd_invoice_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.acceptd_application_snapshots snapshot
    where snapshot.portal_application_id = new.application_id
      and snapshot.mapping_status = 'synced'
  ) then
    raise exception using
      errcode = '23514',
      message = 'This school must be synced to an Acceptd application before it can be invoiced.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_acceptd_invoice_eligibility() from public, anon, authenticated;

create index if not exists acceptd_snapshots_portal_application_status_idx
on public.acceptd_application_snapshots(portal_application_id, mapping_status)
where portal_application_id is not null;

drop trigger if exists school_invoices_require_synced_acceptd_application
on public.school_invoices;

create trigger school_invoices_require_synced_acceptd_application
before insert or update of application_id
on public.school_invoices
for each row execute function public.enforce_acceptd_invoice_eligibility();

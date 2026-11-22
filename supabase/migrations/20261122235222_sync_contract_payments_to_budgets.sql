-- Keep contract payment installments synchronized with Production budgets.

begin;

alter table public.ghsmta_operations_contract_payments
  add column budget_line_id uuid
  references public.ghsmta_operations_budget_lines(id) on delete set null;

alter table public.ghsmta_operations_budget_transactions
  add column contract_payment_id uuid
  references public.ghsmta_operations_contract_payments(id) on delete cascade;

create index ghsmta_operations_contract_payments_budget_line_idx
  on public.ghsmta_operations_contract_payments (budget_line_id)
  where budget_line_id is not null;

create unique index ghsmta_operations_budget_transactions_contract_payment_unique
  on public.ghsmta_operations_budget_transactions (contract_payment_id)
  where contract_payment_id is not null;

create or replace function public.sync_contract_payment_to_budget()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  contract_row public.ghsmta_operations_contracts%rowtype;
  budget_line_row public.ghsmta_operations_budget_lines%rowtype;
  budget_status text;
begin
  if new.budget_line_id is null then
    delete from public.ghsmta_operations_budget_transactions
    where contract_payment_id = new.id;
    return new;
  end if;

  select *
  into contract_row
  from public.ghsmta_operations_contracts
  where id = new.contract_id;

  if contract_row.production_id is null then
    raise exception 'Link the contract to a production before adding its payments to a budget.';
  end if;

  select *
  into budget_line_row
  from public.ghsmta_operations_budget_lines
  where id = new.budget_line_id;

  if not found then
    raise exception 'The selected budget line no longer exists.';
  end if;

  if budget_line_row.production_id <> contract_row.production_id then
    raise exception 'The selected budget line belongs to a different production.';
  end if;

  budget_status := case new.status
    when 'scheduled' then 'committed'
    when 'invoice_requested' then 'committed'
    when 'invoiced' then 'invoiced'
    when 'approved' then 'approved'
    when 'paid' then 'paid'
    when 'held' then 'committed'
    when 'cancelled' then 'cancelled'
    else 'committed'
  end;

  insert into public.ghsmta_operations_budget_transactions (
    production_id,
    budget_line_id,
    contract_payment_id,
    gl_code,
    department,
    amount,
    status,
    description,
    vendor_name,
    invoice_received,
    transaction_date,
    created_by,
    updated_by
  ) values (
    contract_row.production_id,
    new.budget_line_id,
    new.id,
    budget_line_row.gl_code,
    budget_line_row.department,
    new.amount,
    budget_status,
    'Contract payment: ' || contract_row.contractor_name || ' — ' || new.label,
    contract_row.contractor_name,
    new.invoice_received_at is not null or new.status in ('invoiced', 'approved', 'paid'),
    coalesce(new.paid_at::date, new.invoice_received_at::date, new.due_date, current_date),
    new.created_by,
    new.updated_by
  )
  on conflict (contract_payment_id) where contract_payment_id is not null
  do update set
    production_id = excluded.production_id,
    budget_line_id = excluded.budget_line_id,
    gl_code = excluded.gl_code,
    department = excluded.department,
    amount = excluded.amount,
    status = excluded.status,
    description = excluded.description,
    vendor_name = excluded.vendor_name,
    invoice_received = excluded.invoice_received,
    transaction_date = excluded.transaction_date,
    updated_by = excluded.updated_by;

  return new;
end;
$$;

revoke execute on function public.sync_contract_payment_to_budget()
from public, anon, authenticated;

create trigger ghsmta_contract_payment_sync_budget
after insert or update of
  contract_id,
  budget_line_id,
  label,
  amount,
  due_date,
  status,
  invoice_received_at,
  paid_at,
  updated_by
on public.ghsmta_operations_contract_payments
for each row
execute function public.sync_contract_payment_to_budget();

create or replace function public.resync_contract_payments_after_production_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.production_id is distinct from old.production_id
    or new.contractor_name is distinct from old.contractor_name then
    update public.ghsmta_operations_contract_payments
    set contract_id = contract_id
    where contract_id = new.id
      and budget_line_id is not null;
  end if;
  return new;
end;
$$;

revoke execute on function public.resync_contract_payments_after_production_change()
from public, anon, authenticated;

create trigger ghsmta_contract_resync_budget_payments
after update of production_id, contractor_name
on public.ghsmta_operations_contracts
for each row
execute function public.resync_contract_payments_after_production_change();

create or replace function public.resync_contract_payments_after_budget_line_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.ghsmta_operations_contract_payments
  set budget_line_id = budget_line_id
  where budget_line_id = new.id;
  return new;
end;
$$;

revoke execute on function public.resync_contract_payments_after_budget_line_change()
from public, anon, authenticated;

create trigger ghsmta_budget_line_resync_contract_payments
after update of production_id, gl_code, department
on public.ghsmta_operations_budget_lines
for each row
execute function public.resync_contract_payments_after_budget_line_change();

comment on column public.ghsmta_operations_contract_payments.budget_line_id is
  'Production budget line that receives this contract installment automatically.';

comment on column public.ghsmta_operations_budget_transactions.contract_payment_id is
  'Contract installment that owns and synchronizes this budget transaction.';

commit;

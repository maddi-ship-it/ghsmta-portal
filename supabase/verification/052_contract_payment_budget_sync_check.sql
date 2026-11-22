-- Contract installment to Production budget synchronization verification.

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'ghsmta_operations_contract_payments' and column_name = 'budget_line_id')
    or
    (table_name = 'ghsmta_operations_budget_transactions' and column_name = 'contract_payment_id')
  )
order by table_name, column_name;

select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'ghsmta_contract_payment_sync_budget',
    'ghsmta_contract_resync_budget_payments',
    'ghsmta_budget_line_resync_contract_payments'
  )
order by trigger_name, event_manipulation;

begin;

do $$
declare
  v_production_id uuid := gen_random_uuid();
  v_budget_line_id uuid := gen_random_uuid();
  v_contract_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  transaction_count integer;
  transaction_row public.ghsmta_operations_budget_transactions%rowtype;
begin
  insert into public.ghsmta_operations_productions (id, name, code)
  values (v_production_id, 'Contract budget sync verification', 'VERIFY-' || left(v_production_id::text, 8));

  insert into public.ghsmta_operations_budget_lines (
    id,
    production_id,
    gl_code,
    department,
    original_budget
  ) values (
    v_budget_line_id,
    v_production_id,
    '5000-VERIFY',
    'Production',
    1000
  );

  insert into public.ghsmta_operations_contracts (
    id,
    production_id,
    contractor_name,
    contractor_email,
    role_title,
    total_consideration
  ) values (
    v_contract_id,
    v_production_id,
    'Verification Contractor',
    'verification@example.com',
    'Verification Role',
    500
  );

  insert into public.ghsmta_operations_contract_payments (
    id,
    contract_id,
    budget_line_id,
    installment_order,
    label,
    amount,
    due_date,
    status
  ) values (
    v_payment_id,
    v_contract_id,
    v_budget_line_id,
    1,
    'Verification installment',
    500,
    current_date + 7,
    'scheduled'
  );

  select *
  into transaction_row
  from public.ghsmta_operations_budget_transactions
  where contract_payment_id = v_payment_id;

  if not found
    or transaction_row.production_id <> v_production_id
    or transaction_row.budget_line_id <> v_budget_line_id
    or transaction_row.amount <> 500
    or transaction_row.status <> 'committed'
    or transaction_row.vendor_name <> 'Verification Contractor' then
    raise exception 'Contract payment insert did not create the expected budget transaction.';
  end if;

  update public.ghsmta_operations_contract_payments
  set amount = 575,
      status = 'paid',
      paid_at = now()
  where id = v_payment_id;

  select *
  into transaction_row
  from public.ghsmta_operations_budget_transactions
  where contract_payment_id = v_payment_id;

  if transaction_row.amount <> 575
    or transaction_row.status <> 'paid'
    or transaction_row.transaction_date <> current_date then
    raise exception 'Contract payment update did not refresh the budget transaction.';
  end if;

  update public.ghsmta_operations_contracts
  set contractor_name = 'Updated Verification Contractor'
  where id = v_contract_id;

  update public.ghsmta_operations_budget_lines
  set gl_code = '5001-VERIFY',
      department = 'Administration'
  where id = v_budget_line_id;

  select *
  into transaction_row
  from public.ghsmta_operations_budget_transactions
  where contract_payment_id = v_payment_id;

  if transaction_row.vendor_name <> 'Updated Verification Contractor'
    or transaction_row.gl_code <> '5001-VERIFY'
    or transaction_row.department <> 'Administration' then
    raise exception 'Contract or budget-line changes did not refresh the linked transaction.';
  end if;

  update public.ghsmta_operations_contract_payments
  set budget_line_id = null
  where id = v_payment_id;

  select count(*)
  into transaction_count
  from public.ghsmta_operations_budget_transactions
  where contract_payment_id = v_payment_id;

  if transaction_count <> 0 then
    raise exception 'Unlinking a payment did not remove its budget transaction.';
  end if;

  update public.ghsmta_operations_contract_payments
  set budget_line_id = v_budget_line_id
  where id = v_payment_id;

  select count(*)
  into transaction_count
  from public.ghsmta_operations_budget_transactions
  where contract_payment_id = v_payment_id;

  if transaction_count <> 1 then
    raise exception 'Relinking a payment did not recreate exactly one budget transaction.';
  end if;

  delete from public.ghsmta_operations_contract_payments
  where id = v_payment_id;

  select count(*)
  into transaction_count
  from public.ghsmta_operations_budget_transactions
  where contract_payment_id = v_payment_id;

  if transaction_count <> 0 then
    raise exception 'Deleting a payment did not remove its budget transaction.';
  end if;
end;
$$;

rollback;

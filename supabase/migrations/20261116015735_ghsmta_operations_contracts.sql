-- GHSMTA Production Operations: Contracts
--
-- Tracks contractor agreements, signatures, W-9s, and payment milestones.
-- Contract administration remains Owner-only; linked contractor accounts use
-- the separate Production portal role and communicate in a private group chat.

begin;

create table public.ghsmta_operations_contracts (
  id uuid primary key default gen_random_uuid(),
  production_id uuid references public.ghsmta_operations_productions(id) on delete set null,
  contractor_profile_id uuid references public.profiles(id) on delete set null,
  contract_number text,
  contract_type text not null default 'work_for_hire',
  status text not null default 'draft' check (
    status in (
      'draft', 'preparing', 'sent', 'partially_signed', 'executed', 'active',
      'complete', 'terminated', 'cancelled', 'archived'
    )
  ),
  contractor_name text not null,
  contractor_email text not null,
  contractor_phone text,
  contractor_address text,
  role_title text not null,
  foundation_signer_name text,
  agreement_date date,
  starts_on date,
  ends_on date,
  event_date date,
  total_consideration numeric(12,2) not null default 0,
  responsibilities text,
  transportation text,
  lodging text,
  meals text,
  out_of_pocket_expenses text,
  communication_credit text,
  contract_document_url text,
  signed_document_url text,
  w9_document_url text,
  w9_received boolean not null default false,
  contractor_signed_at timestamptz,
  foundation_signed_at timestamptz,
  internal_notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ghsmta_operations_contracts_number_unique
  on public.ghsmta_operations_contracts (lower(contract_number))
  where nullif(btrim(contract_number), '') is not null;
create index ghsmta_operations_contracts_production_idx
  on public.ghsmta_operations_contracts (production_id, status);
create index ghsmta_operations_contracts_contractor_idx
  on public.ghsmta_operations_contracts (contractor_profile_id);
create index ghsmta_operations_contracts_status_idx
  on public.ghsmta_operations_contracts (status, starts_on, ends_on);
create index ghsmta_operations_contracts_email_idx
  on public.ghsmta_operations_contracts (lower(contractor_email));

create table public.ghsmta_operations_contract_payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.ghsmta_operations_contracts(id) on delete cascade,
  installment_order integer not null default 0,
  label text not null,
  deliverable text,
  amount numeric(12,2) not null default 0,
  due_date date,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'invoice_requested', 'invoiced', 'approved', 'paid', 'held', 'cancelled')
  ),
  invoice_received_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ghsmta_operations_contract_payments_contract_idx
  on public.ghsmta_operations_contract_payments (contract_id, installment_order, due_date);
create index ghsmta_operations_contract_payments_status_idx
  on public.ghsmta_operations_contract_payments (status, due_date);

create trigger ghsmta_operations_contracts_set_updated_at
before update on public.ghsmta_operations_contracts
for each row execute function public.set_updated_at();
create trigger ghsmta_operations_contract_payments_set_updated_at
before update on public.ghsmta_operations_contract_payments
for each row execute function public.set_updated_at();

alter table public.ghsmta_operations_contracts enable row level security;
alter table public.ghsmta_operations_contract_payments enable row level security;

grant select, insert, update, delete on public.ghsmta_operations_contracts to authenticated;
grant select, insert, update, delete on public.ghsmta_operations_contract_payments to authenticated;

create policy "owners manage GHSMTA operations contracts"
on public.ghsmta_operations_contracts for all to authenticated
using ((select public.current_user_role()) = 'owner')
with check ((select public.current_user_role()) = 'owner');

create policy "owners manage GHSMTA operations contract payments"
on public.ghsmta_operations_contract_payments for all to authenticated
using ((select public.current_user_role()) = 'owner')
with check ((select public.current_user_role()) = 'owner');

comment on table public.ghsmta_operations_contracts is
  'Owner-managed GHSMTA contractor agreements and execution tracking.';
comment on table public.ghsmta_operations_contract_payments is
  'Payment installments, invoices, approvals, and payment status for GHSMTA contracts.';

commit;

alter table public.cycle_invoice_options
  add column if not exists payment_url text,
  add column if not exists promo_code text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

alter table public.school_invoices
  add column if not exists payment_promo_code text,
  add column if not exists billing_contact_name text,
  add column if not exists billing_contact_phone text,
  add column if not exists school_address_snapshot text,
  add column if not exists school_phone_snapshot text,
  add column if not exists school_type_snapshot text;

alter table public.cycle_invoice_options
  drop constraint if exists cycle_invoice_options_key_check;

alter table public.cycle_invoice_options
  add constraint cycle_invoice_options_key_check
  check (option_key ~ '^[a-z0-9_]{3,80}$');

alter table public.cycle_invoice_options
  drop constraint if exists cycle_invoice_options_payment_link_check;

alter table public.cycle_invoice_options
  add constraint cycle_invoice_options_payment_link_check
  check (payment_url is null or payment_url ~ '^https://');

alter table public.cycle_invoice_options
  drop constraint if exists cycle_invoice_options_promo_code_check;

alter table public.cycle_invoice_options
  add constraint cycle_invoice_options_promo_code_check
  check (
    promo_code is null
    or (
      char_length(trim(promo_code)) between 1 and 64
      and promo_code = upper(trim(promo_code))
    )
  );

alter table public.school_invoices
  drop constraint if exists school_invoices_option_key_check;

alter table public.school_invoices
  add constraint school_invoices_option_key_check
  check (option_key ~ '^[a-z0-9_]{3,80}$');

alter table public.school_invoices
  drop constraint if exists school_invoices_payment_promo_code_check;

alter table public.school_invoices
  add constraint school_invoices_payment_promo_code_check
  check (
    payment_promo_code is null
    or char_length(trim(payment_promo_code)) between 1 and 64
  );

create index if not exists cycle_invoice_options_visible_idx
  on public.cycle_invoice_options(cycle_id, active, sort_order)
  where archived_at is null;

update public.cycle_invoice_options
set
  payment_url = coalesce(payment_url, 'https://secure.qgiv.com/for/gapr2/event/shureg27/'),
  promo_code = case
    when option_key = 'competition_title_1' then 'SHUSUB'
    when option_key = 'competition_scholarship' then 'SHUWAIVER'
    when option_key = 'mentorship' then 'MENTOR27'
    else promo_code
  end,
  amount_cents = case
    when option_key = 'competition_title_1' then 30000
    when option_key = 'mentorship' then 15000
    when option_key = 'competition_scholarship' then 0
    else amount_cents
  end,
  label = case
    when option_key = 'competition_title_1' then 'Competition Track — Title I School'
    when option_key = 'competition_scholarship' then 'Full Fee Waived'
    when option_key = 'mentorship' then 'Mentor Track'
    else label
  end
where option_key in (
  'competition_full',
  'competition_title_1',
  'competition_scholarship',
  'mentorship'
);

insert into public.cycle_invoice_options (
  cycle_id,
  option_key,
  label,
  amount_cents,
  active,
  sort_order,
  payment_url,
  promo_code
)
select
  cycle.id,
  'mailing_check',
  'Mailing a Check',
  coalesce(full_option.amount_cents, 60000),
  true,
  50,
  'https://secure.qgiv.com/for/gapr2/event/shureg27/',
  'CHECK'
from public.award_cycles cycle
left join public.cycle_invoice_options full_option
  on full_option.cycle_id = cycle.id
  and full_option.option_key = 'competition_full'
on conflict (cycle_id, option_key) do update
set
  payment_url = excluded.payment_url,
  promo_code = excluded.promo_code,
  active = true,
  archived_at = null,
  archived_by = null;

create or replace function public.seed_cycle_invoice_options()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cycle_invoice_options (
    cycle_id, option_key, label, amount_cents, sort_order, payment_url, promo_code
  ) values
    (new.id, 'competition_full', 'Competition Track — Full Payment', 60000, 10, 'https://secure.qgiv.com/for/gapr2/event/shureg27/', null),
    (new.id, 'competition_title_1', 'Competition Track — Title I School', 30000, 20, 'https://secure.qgiv.com/for/gapr2/event/shureg27/', 'SHUSUB'),
    (new.id, 'competition_scholarship', 'Full Fee Waived', 0, 30, 'https://secure.qgiv.com/for/gapr2/event/shureg27/', 'SHUWAIVER'),
    (new.id, 'mentorship', 'Mentor Track', 15000, 40, 'https://secure.qgiv.com/for/gapr2/event/shureg27/', 'MENTOR27'),
    (new.id, 'mailing_check', 'Mailing a Check', 60000, 50, 'https://secure.qgiv.com/for/gapr2/event/shureg27/', 'CHECK')
  on conflict (cycle_id, option_key) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_cycle_invoice_options()
from public, anon, authenticated;

-- Production hardening release
-- Billing delivery auditability, concurrency-safe reminder processing,
-- authenticated AI request quotas, upload policy enforcement, and MFA reset.

-- Stop before changing production data if the previous release allowed more
-- than one active invoice for the same school and cycle. Owners can void the
-- superseded invoice, preserving the audit trail, and rerun this migration.
do $$
declare
  duplicate_group_count integer;
begin
  select count(*)
  into duplicate_group_count
  from (
    select application_id, cycle_id
    from public.school_invoices
    where status in ('draft', 'sent')
    group by application_id, cycle_id
    having count(*) > 1
  ) duplicate_groups;

  if duplicate_group_count > 0 then
    raise exception
      'Found % school/cycle group(s) with duplicate open invoices. Void each superseded invoice, then rerun this migration.',
      duplicate_group_count;
  end if;
end $$;

-- Give every active account, including Owners, a fresh fourteen-day MFA window.
update public.profiles
set
  mfa_required = true,
  mfa_grace_until = now() + interval '14 days',
  updated_at = now()
where active = true;

-- Billing delivery state and audit trail -----------------------------------

alter table public.school_invoices
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists last_delivery_at timestamptz,
  add column if not exists reminder_claimed_at timestamptz,
  add column if not exists reminder_claim_token uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table public.school_invoices
  drop constraint if exists school_invoices_delivery_status_check;
alter table public.school_invoices
  add constraint school_invoices_delivery_status_check
  check (delivery_status in ('pending', 'delivered', 'partial', 'failed'));

alter table public.school_invoices
  drop constraint if exists school_invoices_void_audit_check;
alter table public.school_invoices
  add constraint school_invoices_void_audit_check
  check (
    status <> 'void'
    or (
      voided_at is not null
      and voided_by is not null
      and char_length(trim(coalesce(void_reason, ''))) between 3 and 500
    )
  ) not valid;

-- Existing void rows predate audit fields, so preserve them with a clear
-- migration reason before validating the new invariant.
update public.school_invoices
set
  voided_at = coalesce(voided_at, updated_at, now()),
  voided_by = coalesce(voided_by, created_by),
  void_reason = coalesce(nullif(trim(void_reason), ''), 'Voided before billing audit tracking was enabled.')
where status = 'void';

alter table public.school_invoices
  validate constraint school_invoices_void_audit_check;

-- One open invoice per school application and cycle. Voiding an invoice
-- intentionally releases the slot for a corrected replacement.
create unique index if not exists school_invoices_one_open_per_application_cycle_idx
  on public.school_invoices(application_id, cycle_id)
  where status in ('draft', 'sent');

create index if not exists school_invoices_delivery_attention_idx
  on public.school_invoices(delivery_status, last_delivery_at desc)
  where delivery_status in ('pending', 'partial', 'failed');

create index if not exists school_invoices_reminder_claim_idx
  on public.school_invoices(next_reminder_at, reminder_claimed_at)
  where status = 'sent' and amount_cents > 0;

-- Preserve the state of historical delivery attempts instead of presenting
-- every pre-release invoice as newly pending.
with latest_delivery as (
  select distinct on (delivery.invoice_id)
    delivery.invoice_id,
    delivery.email_status,
    delivery.chat_status,
    delivery.created_at
  from public.invoice_delivery_log delivery
  order by delivery.invoice_id, delivery.created_at desc
)
update public.school_invoices invoice
set
  delivery_status = case
    when latest.email_status = 'sent' and latest.chat_status = 'sent' then 'delivered'
    when latest.email_status = 'sent' or latest.chat_status = 'sent' then 'partial'
    else 'failed'
  end,
  last_delivery_at = latest.created_at
from latest_delivery latest
where invoice.id = latest.invoice_id;

alter table public.invoice_delivery_log
  add column if not exists attempt_key uuid not null default gen_random_uuid();

create unique index if not exists invoice_delivery_log_attempt_key_idx
  on public.invoice_delivery_log(attempt_key);

-- Atomically reserve due reminders. SKIP LOCKED lets concurrent workers
-- claim different invoices without blocking or sending duplicates.
create or replace function public.claim_due_invoice_reminders(
  p_claim_token uuid,
  p_limit integer default 100
)
returns table(id uuid, reminder_count integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_claim_token is null then
    raise exception 'A reminder claim token is required.';
  end if;

  return query
  with due as (
    select invoice.id
    from public.school_invoices invoice
    where invoice.status = 'sent'
      and invoice.amount_cents > 0
      and invoice.next_reminder_at is not null
      and invoice.next_reminder_at <= now()
      and (
        invoice.reminder_claimed_at is null
        or invoice.reminder_claimed_at < now() - interval '20 minutes'
      )
    order by invoice.next_reminder_at, invoice.id
    limit greatest(1, least(coalesce(p_limit, 100), 100))
    for update skip locked
  )
  update public.school_invoices invoice
  set
    reminder_claimed_at = now(),
    reminder_claim_token = p_claim_token
  from due
  where invoice.id = due.id
  returning invoice.id, invoice.reminder_count;
end;
$$;

revoke all on function public.claim_due_invoice_reminders(uuid, integer)
from public, anon, authenticated;
grant execute on function public.claim_due_invoice_reminders(uuid, integer)
to service_role;

-- Authenticated AI request quotas ------------------------------------------

create table if not exists public.api_usage_windows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, window_start),
  constraint api_usage_windows_scope_check
    check (scope ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint api_usage_windows_count_check
    check (request_count between 1 and 10000)
);

create index if not exists api_usage_windows_cleanup_idx
  on public.api_usage_windows(window_start);

alter table public.api_usage_windows enable row level security;

-- No direct authenticated table grant is intentional. Requests go through
-- this narrow RPC, which always derives the user id from the verified JWT.
revoke all on table public.api_usage_windows from public, anon, authenticated;
grant select, insert, update, delete on public.api_usage_windows to service_role;

create or replace function public.consume_api_quota(
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_window timestamptz;
  accepted_count integer;
begin
  if caller_id is null then
    raise exception 'Authentication required.';
  end if;
  if p_scope is null or p_scope !~ '^[a-z][a-z0-9_-]{1,63}$' then
    raise exception 'Invalid quota scope.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Invalid quota limit.';
  end if;
  if p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid quota window.';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds)
    * p_window_seconds
  );

  insert into public.api_usage_windows (
    user_id, scope, window_start, request_count, updated_at
  ) values (
    caller_id, p_scope, current_window, 1, now()
  )
  on conflict (user_id, scope, window_start) do update
  set
    request_count = public.api_usage_windows.request_count + 1,
    updated_at = now()
  where public.api_usage_windows.request_count < p_limit
  returning request_count into accepted_count;

  return accepted_count is not null;
end;
$$;

revoke all on function public.consume_api_quota(text, integer, integer)
from public, anon;
grant execute on function public.consume_api_quota(text, integer, integer)
to authenticated, service_role;

-- Storage policies: keep the requested limits and reject unknown content
-- types before objects are accepted into the managed buckets.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/x-wav', 'audio/x-m4a',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/zip', 'application/x-zip-compressed'
]::text[]
where id = 'chat-files';

update storage.buckets
set
  file_size_limit = 209715200,
  allowed_mime_types = array[
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/x-wav', 'audio/x-m4a',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/zip', 'application/x-zip-compressed'
  ]::text[]
where id = 'reference-documents';

-- Explicit Data API grants are required by current Supabase defaults. RLS
-- remains the row-authorization layer for the exposed billing tables.
grant select, insert, update, delete on public.cycle_invoice_options to authenticated;
grant select, insert, update, delete on public.school_invoices to authenticated;
grant select on public.invoice_delivery_log to authenticated;
grant select, insert, update, delete on public.chat_reactions to authenticated;
grant select, insert, delete on public.chat_attachments to authenticated;
grant all on public.api_usage_windows to service_role;

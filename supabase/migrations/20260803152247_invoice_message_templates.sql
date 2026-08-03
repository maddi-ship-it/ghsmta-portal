-- Preserve the Owner-edited message used for the initial invoice or
-- scholarship-confirmation delivery. Retries render the same snapshot.
alter table public.school_invoices
  add column if not exists message_subject_snapshot text,
  add column if not exists message_body_snapshot text;

alter table public.school_invoices
  drop constraint if exists school_invoices_message_subject_length_check;
alter table public.school_invoices
  add constraint school_invoices_message_subject_length_check
  check (
    message_subject_snapshot is null
    or char_length(trim(message_subject_snapshot)) between 3 and 200
  );

alter table public.school_invoices
  drop constraint if exists school_invoices_message_body_length_check;
alter table public.school_invoices
  add constraint school_invoices_message_body_length_check
  check (
    message_body_snapshot is null
    or char_length(trim(message_body_snapshot)) between 3 and 5000
  );

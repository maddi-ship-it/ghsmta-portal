begin;

create table if not exists public.chat_urgent_sms_deliveries (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  message_kind text not null check (message_kind in ('post', 'reply')),
  message_id uuid not null,
  author_id uuid references public.profiles(id) on delete set null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'failed')),
  provider_message_id text,
  provider_status text,
  error_detail text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_kind, message_id, recipient_user_id)
);

create index if not exists chat_urgent_sms_deliveries_channel_idx
  on public.chat_urgent_sms_deliveries(channel_id, created_at desc);

create index if not exists chat_urgent_sms_deliveries_recipient_idx
  on public.chat_urgent_sms_deliveries(recipient_user_id, created_at desc);

alter table public.chat_urgent_sms_deliveries enable row level security;

revoke all on table public.chat_urgent_sms_deliveries
from public, anon, authenticated;

grant select, insert, update on table public.chat_urgent_sms_deliveries
to service_role;

comment on table public.chat_urgent_sms_deliveries is
  'Server-only idempotency and delivery audit records for @URGENT chat SMS alerts. Phone numbers are intentionally not stored here.';

commit;

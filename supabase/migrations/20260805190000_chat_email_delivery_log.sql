create table if not exists public.chat_email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.chat_channels(id) on delete set null,
  message_kind text not null check (message_kind in ('post', 'reply')),
  message_id uuid,
  author_id uuid references public.profiles(id) on delete set null,
  status text not null check (status in ('sent', 'skipped_no_recipients', 'failed')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists chat_email_delivery_log_recent_idx
  on public.chat_email_delivery_log(created_at desc);

create index if not exists chat_email_delivery_log_channel_idx
  on public.chat_email_delivery_log(channel_id, created_at desc);

alter table public.chat_email_delivery_log enable row level security;

grant select on public.chat_email_delivery_log to authenticated;
grant insert on public.chat_email_delivery_log to service_role;

drop policy if exists "owners read chat email delivery log"
on public.chat_email_delivery_log;

create policy "owners read chat email delivery log"
on public.chat_email_delivery_log for select to authenticated
using (public.current_user_role() = 'owner');

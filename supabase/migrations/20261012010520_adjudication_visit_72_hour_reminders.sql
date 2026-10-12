create table if not exists public.adjudication_visit_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.schedule_slots(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  delivery_kind text not null default 'scheduled'
    check (delivery_kind in ('scheduled', 'demo')),
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'partial', 'sent', 'failed')),
  email_sent_at timestamptz,
  panel_posted_at timestamptz,
  panel_post_id uuid references public.chat_posts(id) on delete set null,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  attachment_count integer not null default 0 check (attachment_count >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  recipient_override text,
  suppress_panel_post boolean not null default false,
  subject_prefix text not null default '',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, delivery_kind)
);

create index if not exists adjudication_visit_reminders_due_idx
  on public.adjudication_visit_reminder_deliveries(status, next_attempt_at);

drop trigger if exists adjudication_visit_reminders_set_updated_at
on public.adjudication_visit_reminder_deliveries;
create trigger adjudication_visit_reminders_set_updated_at
before update on public.adjudication_visit_reminder_deliveries
for each row execute function public.set_updated_at();

alter table public.adjudication_visit_reminder_deliveries enable row level security;
revoke all on table public.adjudication_visit_reminder_deliveries
from public, anon, authenticated;
grant all on table public.adjudication_visit_reminder_deliveries to service_role;

create or replace function public.claim_due_adjudication_visit_reminders(
  p_claim_token uuid,
  p_limit integer default 25
)
returns setof public.adjudication_visit_reminder_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.adjudication_visit_reminder_deliveries (
    slot_id,
    application_id,
    scheduled_for
  )
  select
    slot.id,
    booking.application_id,
    slot.starts_at - interval '72 hours'
  from public.schedule_slots slot
  join public.schedule_school_bookings booking on booking.slot_id = slot.id
  where booking.approval_status = 'confirmed'
    and slot.status in ('open', 'closed')
    and slot.starts_at > now()
    and slot.starts_at - interval '72 hours' <= now()
  on conflict (slot_id, delivery_kind) do nothing;

  return query
  with claimable as (
    select delivery.id
    from public.adjudication_visit_reminder_deliveries delivery
    join public.schedule_slots slot on slot.id = delivery.slot_id
    where slot.starts_at > now()
      and delivery.next_attempt_at <= now()
      and (
        delivery.status in ('pending', 'partial', 'failed')
        or (
          delivery.status = 'processing'
          and delivery.claimed_at < now() - interval '20 minutes'
        )
      )
    order by delivery.scheduled_for
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update of delivery skip locked
  )
  update public.adjudication_visit_reminder_deliveries delivery
  set
    status = 'processing',
    claim_token = p_claim_token,
    claimed_at = now(),
    attempt_count = delivery.attempt_count + 1,
    last_error = null
  from claimable
  where delivery.id = claimable.id
  returning delivery.*;
end;
$$;

revoke all on function public.claim_due_adjudication_visit_reminders(uuid, integer)
from public, anon, authenticated;
grant execute on function public.claim_due_adjudication_visit_reminders(uuid, integer)
to service_role;

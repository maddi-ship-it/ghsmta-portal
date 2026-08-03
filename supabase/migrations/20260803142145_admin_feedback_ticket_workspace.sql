-- Dedicated Owner ticket workspace with closure audit and durable history.

begin;

alter table public.portal_feedback_requests
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.profiles(id) on delete set null,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null;

update public.portal_feedback_requests
set
  status_changed_at = coalesce(status_changed_at, updated_at, created_at),
  status_changed_by = coalesce(status_changed_by, submitted_by),
  closed_at = case
    when status = 'closed' then coalesce(closed_at, updated_at, created_at)
    else closed_at
  end;

create index if not exists portal_feedback_queue_idx
  on public.portal_feedback_requests(status, priority, updated_at desc);

create table if not exists public.portal_feedback_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.portal_feedback_requests(id) on delete cascade,
  event_type text not null,
  previous_status text,
  new_status text,
  note text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint portal_feedback_events_type_check check (
    event_type in ('created', 'status_changed', 'note_updated', 'closed', 'reopened')
  )
);

create index if not exists portal_feedback_events_request_idx
  on public.portal_feedback_events(request_id, created_at desc);

alter table public.portal_feedback_events enable row level security;

drop policy if exists "owners read feedback ticket events"
on public.portal_feedback_events;
create policy "owners read feedback ticket events"
on public.portal_feedback_events for select to authenticated
using (public.current_user_role() = 'owner');

revoke all on table public.portal_feedback_events from public, anon, authenticated;
grant select on table public.portal_feedback_events to authenticated;
grant select, insert, update, delete on table public.portal_feedback_events to service_role;

insert into public.portal_feedback_events (
  request_id, event_type, new_status, note, changed_by, created_at
)
select
  request.id,
  'created',
  request.status,
  request.owner_notes,
  request.submitted_by,
  request.created_at
from public.portal_feedback_requests request
where not exists (
  select 1
  from public.portal_feedback_events event
  where event.request_id = request.id
);

create or replace function public.audit_feedback_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
begin
  if tg_op = 'INSERT' then
    insert into public.portal_feedback_events (
      request_id,
      event_type,
      new_status,
      note,
      changed_by
    ) values (
      new.id,
      'created',
      new.status,
      new.owner_notes,
      coalesce(auth.uid(), new.submitted_by)
    );

    return new;
  end if;

  if old.status is distinct from new.status then
    event_name := case
      when new.status = 'closed' then 'closed'
      when old.status = 'closed' then 'reopened'
      else 'status_changed'
    end;
  elsif old.owner_notes is distinct from new.owner_notes then
    event_name := 'note_updated';
  else
    return new;
  end if;

  insert into public.portal_feedback_events (
    request_id,
    event_type,
    previous_status,
    new_status,
    note,
    changed_by
  ) values (
    new.id,
    event_name,
    old.status,
    new.status,
    new.owner_notes,
    auth.uid()
  );

  return new;
end;
$$;

revoke all on function public.audit_feedback_ticket_change()
from public, anon, authenticated;

drop trigger if exists portal_feedback_ticket_created
on public.portal_feedback_requests;
create trigger portal_feedback_ticket_created
after insert on public.portal_feedback_requests
for each row execute function public.audit_feedback_ticket_change();

drop trigger if exists portal_feedback_ticket_audit
on public.portal_feedback_requests;
create trigger portal_feedback_ticket_audit
after update of status, owner_notes on public.portal_feedback_requests
for each row execute function public.audit_feedback_ticket_change();

create or replace function public.notify_feedback_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_notifications (
    user_id,
    notification_type,
    title,
    body,
    href
  )
  select
    profile.id,
    'portal_feedback',
    case
      when new.request_type = 'bug_report' then 'New bug report'
      else 'New feature request'
    end,
    new.reference_code || ': ' || new.title,
    '/portal/admin/feedback/' || new.id::text
  from public.profiles profile
  where profile.role = 'owner'
    and profile.active = true;

  return new;
end;
$$;

revoke all on function public.notify_feedback_submitted()
from public, anon, authenticated;

update public.user_notifications notification
set href = '/portal/admin/feedback/' || request.id::text
from public.portal_feedback_requests request
where notification.notification_type = 'portal_feedback'
  and notification.body like coalesce(request.reference_code, '') || ':%'
  and notification.href = '/portal/admin/workflows';

commit;

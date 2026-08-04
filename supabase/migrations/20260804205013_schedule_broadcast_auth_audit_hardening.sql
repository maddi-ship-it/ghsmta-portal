begin;

-- Booking availability is a high-fanout, identity-free signal. Broadcast it
-- once instead of making Postgres Changes authorize the same row separately
-- for every connected applicant.
drop policy if exists "applicants receive schedule availability broadcasts"
on realtime.messages;
create policy "applicants receive schedule availability broadcasts"
on realtime.messages
for select
to authenticated
using (
  (select public.current_user_role()) = 'applicant'
  and (select realtime.topic()) = 'schedule:availability'
  and realtime.messages.extension = 'broadcast'
);

create or replace function public.broadcast_schedule_booking_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform realtime.send(
      jsonb_build_object(
        'slot_id', new.slot_id,
        'is_booked', true
      ),
      'availability_changed',
      'schedule:availability',
      true
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform realtime.send(
      jsonb_build_object(
        'slot_id', old.slot_id,
        'is_booked', false
      ),
      'availability_changed',
      'schedule:availability',
      true
    );
    return old;
  end if;

  if old.slot_id is distinct from new.slot_id then
    perform realtime.send(
      jsonb_build_object(
        'slot_id', old.slot_id,
        'is_booked', false
      ),
      'availability_changed',
      'schedule:availability',
      true
    );
    perform realtime.send(
      jsonb_build_object(
        'slot_id', new.slot_id,
        'is_booked', true
      ),
      'availability_changed',
      'schedule:availability',
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function public.broadcast_schedule_booking_availability()
from public, anon, authenticated;

drop trigger if exists schedule_bookings_touch_slot_realtime
on public.schedule_school_bookings;
drop trigger if exists schedule_bookings_broadcast_availability
on public.schedule_school_bookings;
create trigger schedule_bookings_broadcast_availability
after insert or update of slot_id or delete
on public.schedule_school_bookings
for each row execute function public.broadcast_schedule_booking_availability();

drop function if exists public.touch_schedule_slot_for_realtime();

-- Preserve a stable application identifier in the audit trail while allowing
-- an application to be physically removed. The live foreign key is nulled on
-- delete and the DELETE snapshot retains the original ID and full old record.
alter table public.application_audit_log
  add column if not exists subject_application_id uuid;

update public.application_audit_log
set subject_application_id = application_id
where subject_application_id is null;

alter table public.application_audit_log
  alter column subject_application_id set not null,
  alter column application_id drop not null;

alter table public.application_audit_log
  drop constraint if exists application_audit_log_application_id_fkey;
alter table public.application_audit_log
  add constraint application_audit_log_application_id_fkey
  foreign key (application_id)
  references public.applications(id)
  on delete set null;

create index if not exists application_audit_log_subject_idx
  on public.application_audit_log(subject_application_id, created_at desc);

create or replace function public.log_application_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.application_audit_log (
    application_id,
    subject_application_id,
    actor_user_id,
    action,
    old_record,
    new_record
  ) values (
    case when tg_op = 'DELETE' then null else new.id end,
    coalesce(new.id, old.id),
    auth.uid(),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.log_application_change()
from public, anon, authenticated;

comment on column public.application_audit_log.subject_application_id is
  'Stable application ID retained after the live application row is deleted.';

commit;

-- GHSMTA Portal: Owner scheduling console, booking approval, message templates,
-- exact-timeslot alternate dates, and manual daily digest.
-- Run after migrations 001-022.

alter table public.schedule_school_bookings
  add column if not exists approval_status text not null default 'confirmed'
    check (approval_status in ('pending','confirmed','declined')),
  add column if not exists selected_at timestamptz not null default now(),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approval_notes text;

alter table public.schedule_slot_waitlist
  add column if not exists alternate_date_1 date,
  add column if not exists alternate_date_2 date,
  add column if not exists alternate_date_3 date,
  add column if not exists applicant_reason text;

create table if not exists public.portal_message_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique check (template_key in (
    'timeslot_selected','timeslot_confirmed','waitlist_offer','daily_digest'
  )),
  name text not null,
  subject_template text not null,
  body_template text not null,
  send_in_app boolean not null default true,
  send_school_messaging boolean not null default true,
  send_email boolean not null default true,
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.portal_message_templates enable row level security;
grant select, insert, update on public.portal_message_templates to authenticated;
drop policy if exists "owners manage portal message templates" on public.portal_message_templates;
create policy "owners manage portal message templates"
on public.portal_message_templates for all to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop trigger if exists portal_message_templates_set_updated_at on public.portal_message_templates;
create trigger portal_message_templates_set_updated_at
before update on public.portal_message_templates
for each row execute function public.set_updated_at();

insert into public.portal_message_templates
(template_key,name,subject_template,body_template,send_in_app,send_school_messaging,send_email)
values
('timeslot_selected','Timeslot selected','Timeslot selected — {{school_name}}','{{school_name}} selected {{slot_date}} at {{slot_time}}. This reservation is pending final Owner approval. You will receive another message when it is confirmed.',true,true,true),
('timeslot_confirmed','Final timeslot confirmation','Timeslot confirmed — {{school_name}}','Your GHSMTA timeslot is confirmed for {{slot_date}} at {{slot_time}}. {{location_line}} {{school_instructions}}',true,true,true),
('waitlist_offer','Waitlist offer','A GHSMTA timeslot is available','A timeslot is available for {{slot_date}} at {{slot_time}}. Open Scheduling to accept before {{offer_expires}}.',true,true,true),
('daily_digest','Owner daily digest','GHSMTA Owner daily review — {{digest_date}}','Your GHSMTA Owner daily review is ready.',false,false,true)
on conflict (template_key) do nothing;

create or replace function public.owner_confirm_schedule_booking(p_booking_id uuid,p_notes text default null)
returns table (booking_id uuid,slot_id uuid,application_id uuid)
language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() <> 'owner' then raise exception 'Owner access required.'; end if;
  return query update public.schedule_school_bookings b
    set approval_status='confirmed',approved_at=now(),approved_by=auth.uid(),approval_notes=nullif(trim(p_notes),'')
    where b.id=p_booking_id returning b.id,b.slot_id,b.application_id;
  if not found then raise exception 'Schedule reservation not found.'; end if;
end; $$;
grant execute on function public.owner_confirm_schedule_booking(uuid,text) to authenticated;

create or replace function public.owner_decline_schedule_booking(p_booking_id uuid,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare selected_slot_id uuid;
begin
  if public.current_user_role() <> 'owner' then raise exception 'Owner access required.'; end if;
  select slot_id into selected_slot_id from public.schedule_school_bookings where id=p_booking_id for update;
  if selected_slot_id is null then raise exception 'Schedule reservation not found.'; end if;
  delete from public.schedule_school_bookings where id=p_booking_id;
  return selected_slot_id;
end; $$;
grant execute on function public.owner_decline_schedule_booking(uuid,text) to authenticated;

-- Replace the old 3-argument function with an optional-argument version.
drop function if exists public.join_schedule_slot_waitlist(uuid,uuid,text);
create function public.join_schedule_slot_waitlist(
  p_application_id uuid,
  p_slot_id uuid,
  p_notes text default null,
  p_alternate_date_1 date default null,
  p_alternate_date_2 date default null,
  p_alternate_date_3 date default null,
  p_reason text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  selected_application public.applications%rowtype;
  selected_slot public.schedule_slots%rowtype;
  next_rank integer;
  result_id uuid;
begin
  if not public.is_application_member(p_application_id,auth.uid()) then raise exception 'You do not have access to this application.'; end if;
  select * into selected_application from public.applications where id=p_application_id and coalesce(is_archived,false)=false;
  select * into selected_slot from public.schedule_slots where id=p_slot_id for update;
  if selected_application.id is null or selected_slot.id is null then raise exception 'Application or schedule slot not found.'; end if;
  if selected_application.cycle_id <> selected_slot.cycle_id then raise exception 'This slot belongs to a different program.'; end if;
  if selected_slot.status <> 'open' or selected_slot.starts_at <= now() then raise exception 'This timeslot is not eligible for a waitlist.'; end if;
  if exists (select 1 from public.schedule_school_bookings b where public.is_application_member(b.application_id,auth.uid())) then raise exception 'Your school already has a schedule reservation.'; end if;
  if not exists (select 1 from public.schedule_school_bookings b where b.slot_id=p_slot_id)
     and not exists (select 1 from public.schedule_slot_waitlist w where w.slot_id=p_slot_id and w.status='offered' and w.offer_expires_at>now())
  then raise exception 'This timeslot is open now. Reserve it instead of joining the waitlist.'; end if;
  select coalesce(max(queue_rank),0)+1 into next_rank from public.schedule_slot_waitlist where slot_id=p_slot_id;
  insert into public.schedule_slot_waitlist
    (slot_id,cycle_id,application_id,status,queue_rank,applicant_notes,alternate_date_1,alternate_date_2,alternate_date_3,applicant_reason,joined_by)
  values
    (p_slot_id,selected_slot.cycle_id,p_application_id,'waiting',next_rank,nullif(trim(p_notes),''),p_alternate_date_1,p_alternate_date_2,p_alternate_date_3,nullif(trim(p_reason),''),auth.uid())
  on conflict (application_id,slot_id) where status in ('waiting','offered')
  do update set applicant_notes=excluded.applicant_notes,alternate_date_1=excluded.alternate_date_1,alternate_date_2=excluded.alternate_date_2,alternate_date_3=excluded.alternate_date_3,applicant_reason=excluded.applicant_reason,status='waiting',offer_expires_at=null,offered_by=null,updated_at=now()
  returning id into result_id;
  return result_id;
end; $$;
grant execute on function public.join_schedule_slot_waitlist(uuid,uuid,text,date,date,date,text) to authenticated;

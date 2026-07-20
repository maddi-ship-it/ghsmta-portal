-- Verify migration 023.
select
  to_regclass('public.portal_message_templates') as portal_message_templates,
  to_regprocedure('public.owner_confirm_schedule_booking(uuid,text)') as confirm_booking,
  to_regprocedure('public.owner_decline_schedule_booking(uuid,text)') as decline_booking,
  to_regprocedure('public.join_schedule_slot_waitlist(uuid,uuid,text,date,date,date,text)') as join_waitlist;

select column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='schedule_school_bookings'
  and column_name in ('approval_status','selected_at','approved_at','approved_by','approval_notes')
order by column_name;

select column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='schedule_slot_waitlist'
  and column_name in ('alternate_date_1','alternate_date_2','alternate_date_3','applicant_reason')
order by column_name;

select template_key,name,active,send_in_app,send_school_messaging,send_email
from public.portal_message_templates
order by template_key;

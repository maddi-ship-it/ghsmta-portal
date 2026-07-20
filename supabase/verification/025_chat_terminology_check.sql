-- Migration 025 verification

select
  to_regprocedure('public.get_my_chat_channels_v3()')
    as chat_navigation_v3,
  to_regprocedure('public.normalize_application_chat_display_names()')
    as chat_name_trigger_function;

select
  channel_type,
  count(*) as channels,
  min(name) as sample_name
from public.chat_channels
where channel_type in ('school_dm', 'school')
group by channel_type
order by channel_type;

select
  trigger_name,
  event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name = 'applications_normalize_chat_display_names';

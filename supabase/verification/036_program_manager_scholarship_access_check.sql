-- Run after 20260803173350_program_manager_scholarship_access.sql.

do $$
declare
  access_function_definition text;
  member_function_definition text;
  channel_list_function_definition text;
  security_function_definition text;
  channel_type_definition text;
  application_type_definition text;
begin
  select pg_get_functiondef(
    'public.can_access_chat_channel(uuid,uuid)'::regprocedure
  ) into access_function_definition;

  if access_function_definition not ilike '%program_manager%'
     or access_function_definition not ilike '%scholarship_dm%'
     or access_function_definition not ilike '%channel.channel_type = ''general''%'
     or access_function_definition not ilike '%channel.channel_type = ''networking''%' then
    raise exception 'Chat authorization does not contain the Program Manager boundary.';
  end if;

  select pg_get_functiondef(
    'public.get_chat_channel_members(uuid)'::regprocedure
  ) into member_function_definition;

  if member_function_definition not ilike '%program_manager%'
     or member_function_definition not ilike '%scholarship_dm%' then
    raise exception 'Scholarship chat member resolution is incomplete.';
  end if;

  select pg_get_functiondef(
    'public.get_my_chat_channels_v3()'::regprocedure
  ) into channel_list_function_definition;

  if channel_list_function_definition not ilike '%scholarship_applicants%'
     or channel_list_function_definition not ilike '%Scholarship Applicants%' then
    raise exception 'Scholarship chat grouping is incomplete.';
  end if;

  select pg_get_functiondef(
    'public.apply_profile_security_defaults()'::regprocedure
  ) into security_function_definition;

  if security_function_definition not ilike '%program_manager%' then
    raise exception 'Program Managers are missing from MFA defaults.';
  end if;

  select pg_get_constraintdef(constraint_record.oid)
  into channel_type_definition
  from pg_constraint constraint_record
  join pg_class table_record
    on table_record.oid = constraint_record.conrelid
  join pg_namespace namespace_record
    on namespace_record.oid = table_record.relnamespace
  where namespace_record.nspname = 'public'
    and table_record.relname = 'chat_channels'
    and constraint_record.conname = 'chat_channels_channel_type_check';

  if channel_type_definition not ilike '%scholarship_dm%' then
    raise exception 'chat_channels type constraint excludes scholarship_dm.';
  end if;

  select pg_get_constraintdef(constraint_record.oid)
  into application_type_definition
  from pg_constraint constraint_record
  join pg_class table_record
    on table_record.oid = constraint_record.conrelid
  join pg_namespace namespace_record
    on namespace_record.oid = table_record.relnamespace
  where namespace_record.nspname = 'public'
    and table_record.relname = 'chat_channels'
    and constraint_record.conname = 'chat_channels_application_type_check';

  if application_type_definition not ilike '%scholarship_dm%'
     or application_type_definition not ilike '%application_id IS NOT NULL%' then
    raise exception 'Scholarship channels are not application-scoped.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_record
    join pg_class table_record
      on table_record.oid = trigger_record.tgrelid
    join pg_namespace namespace_record
      on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'applications'
      and trigger_record.tgname = 'applications_sync_scholarship_chat'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Scholarship chat synchronization trigger is missing.';
  end if;

  if not exists (
    select 1
    from pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'applications'
      and policy_record.policyname = 'program managers read submitted applications'
      and policy_record.cmd = 'SELECT'
      and policy_record.qual ilike '%program_manager%'
  ) then
    raise exception 'Program Manager submitted-application read policy is missing.';
  end if;

  if exists (
    select 1
    from pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'applications'
      and policy_record.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (
        coalesce(policy_record.qual, '') || ' ' ||
        coalesce(policy_record.with_check, '')
      ) ilike '%program_manager%'
  ) then
    raise exception 'Program Managers were granted application mutation access.';
  end if;

  if not exists (
    select 1
    from pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'adjudication_releases'
      and policy_record.policyname =
        'elevated read releases applicants read own released snapshot'
      and policy_record.qual ilike '%program_manager%'
      and policy_record.qual ilike '%scores_released_at IS NOT NULL%'
  ) then
    raise exception 'Released-results policy is missing Program Manager access.';
  end if;

  if exists (
    select 1
    from pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename in (
        'adjudication_scorecards',
        'adjudication_scores',
        'adjudication_category_comments',
        'adjudication_panel_feedback',
        'adjudication_reviews'
      )
      and (
        coalesce(policy_record.qual, '') || ' ' ||
        coalesce(policy_record.with_check, '')
      ) ilike '%program_manager%'
  ) then
    raise exception 'Program Managers were granted unreleased adjudication access.';
  end if;

  if exists (
    select 1
    from public.applications application
    join public.award_cycles cycle
      on cycle.id = application.cycle_id
    where cycle.program_type = 'scholarship'
      and application.status in ('submitted', 'under_review', 'complete')
      and not exists (
        select 1
        from public.chat_channels channel
        where channel.application_id = application.id
          and channel.channel_type = 'scholarship_dm'
          and channel.active = true
      )
  ) then
    raise exception 'A submitted scholarship application is missing its chat.';
  end if;
end;
$$;

select 'program manager scholarship access verification passed' as result;

-- Run after 20261101222009_notify_feedback_submitter_on_close.sql.
do $$
declare
  notification_function text;
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'portal_feedback_notify_submitter_on_close'
      and not tgisinternal
  ) then
    raise exception 'Feedback closure notification trigger is missing.';
  end if;

  select pg_get_functiondef(
    'public.notify_feedback_submitter_on_close()'::regprocedure
  )
  into notification_function;

  if position('portal_feedback_closed' in notification_function) = 0 then
    raise exception 'Feedback closure notification type is missing.';
  end if;

  if position('/portal/feedback#feedback-' in notification_function) = 0 then
    raise exception 'Feedback closure notifications do not link to the requester ticket.';
  end if;
end $$;

begin;

do $$
declare
  test_user_id uuid;
  test_ticket_id uuid;
  notification_count integer;
begin
  select id
  into test_user_id
  from public.profiles
  where active = true
  order by created_at
  limit 1;

  if test_user_id is null then
    raise exception 'An active profile is required to verify feedback notifications.';
  end if;

  insert into public.portal_feedback_requests (
    request_type,
    title,
    description,
    priority,
    status,
    submitted_by
  ) values (
    'bug_report',
    'Closure notification verification',
    'Temporary feedback ticket used to verify the closure notification trigger.',
    'low',
    'new',
    test_user_id
  )
  returning id into test_ticket_id;

  update public.portal_feedback_requests
  set
    status = 'closed',
    owner_notes = 'This is a temporary verification response.',
    closed_at = now()
  where id = test_ticket_id;

  select count(*)
  into notification_count
  from public.user_notifications
  where user_id = test_user_id
    and notification_type = 'portal_feedback_closed'
    and href = '/portal/feedback#feedback-' || test_ticket_id::text;

  if notification_count <> 1 then
    raise exception 'Expected one feedback closure notification; found %.', notification_count;
  end if;
end $$;

rollback;

select
  'feedback closure notification verification passed' as result,
  now() as verified_at;

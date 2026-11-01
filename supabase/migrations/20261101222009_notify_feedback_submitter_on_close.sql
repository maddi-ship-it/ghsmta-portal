begin;

create or replace function public.notify_feedback_submitter_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'closed'
  then
    insert into public.user_notifications (
      user_id,
      notification_type,
      title,
      body,
      href
    ) values (
      new.submitted_by,
      'portal_feedback_closed',
      'Your ticket has been closed',
      concat_ws(
        ' — ',
        concat_ws(': ', new.reference_code, new.title),
        nullif(left(new.owner_notes, 500), '')
      ),
      '/portal/feedback#feedback-' || new.id::text
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_feedback_submitter_on_close()
from public, anon, authenticated;

drop trigger if exists portal_feedback_notify_submitter_on_close
on public.portal_feedback_requests;
create trigger portal_feedback_notify_submitter_on_close
after update of status on public.portal_feedback_requests
for each row execute function public.notify_feedback_submitter_on_close();

commit;

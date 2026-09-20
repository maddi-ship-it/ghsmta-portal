-- Assigned advisory members use the same scorecard workflow as adjudicators.
-- Keep the update scoped to the caller's own assignment and to the two
-- participant-controlled workflow states.
create or replace function public.update_own_assignment_status(
  p_assignment_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('adjudicator', 'advisory_member') then
    raise exception 'Only adjudicators and advisory members can update their own assignment workflow.';
  end if;

  if p_status not in ('in_progress', 'submitted') then
    raise exception 'Invalid assignment status.';
  end if;

  update public.adjudicator_assignments
  set status = p_status
  where id = p_assignment_id
    and adjudicator_user_id = auth.uid()
    and removed_at is null;

  if not found then
    raise exception 'Assignment not found.';
  end if;
end;
$$;

revoke execute on function public.update_own_assignment_status(uuid, text)
from public, anon;

grant execute on function public.update_own_assignment_status(uuid, text)
to authenticated;

drop policy if exists "advisory and owners read panel feedback"
on public.adjudication_panel_feedback;

drop policy if exists "owners and assigned panel read shared feedback"
on public.adjudication_panel_feedback;

create policy "owners and assigned panel read shared feedback"
on public.adjudication_panel_feedback for select
to authenticated
using (
  (select public.current_user_role()) = 'owner'
  or (
    (select public.current_user_role()) in ('adjudicator', 'advisory_member')
    and status = 'approved'
    and application_id in (
      select assignment.application_id
      from public.adjudicator_assignments assignment
      where assignment.adjudicator_user_id = (select auth.uid())
        and assignment.can_comment = true
        and assignment.removed_at is null
    )
  )
);

create index if not exists adjudicator_assignments_comment_access_idx
on public.adjudicator_assignments(adjudicator_user_id, application_id)
where can_comment = true and removed_at is null;

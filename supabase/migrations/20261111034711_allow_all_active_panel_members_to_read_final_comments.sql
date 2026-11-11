drop policy if exists "owners and assigned panel read shared feedback"
on public.adjudication_panel_feedback;

drop policy if exists "assigned adjudicators read final comments"
on public.adjudication_panel_feedback;

create policy "owners and active panel read shared feedback"
on public.adjudication_panel_feedback for select
to authenticated
using (
  (select public.current_user_role()) = 'owner'
  or (
    (select public.current_user_role()) in ('adjudicator', 'advisory_member')
    and status = 'approved'
    and exists (
      select 1
      from public.adjudicator_assignments assignment
      where assignment.application_id = adjudication_panel_feedback.application_id
        and assignment.adjudicator_user_id = (select auth.uid())
        and (assignment.can_score = true or assignment.can_comment = true)
        and assignment.removed_at is null
    )
  )
);

create index if not exists adjudicator_assignments_active_panel_access_idx
on public.adjudicator_assignments(adjudicator_user_id, application_id)
where removed_at is null and (can_score = true or can_comment = true);

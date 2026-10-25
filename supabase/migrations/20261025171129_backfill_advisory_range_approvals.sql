-- Advisory members author and send category decisions to the panel. Their act
-- of sending is also their approval of those decisions. Backfill proposals
-- that predate that behavior so existing scorecards are not left waiting on
-- an approval the advisory author should never have to enter separately.

insert into public.adjudication_category_approvals (
  proposal_id,
  adjudicator_user_id,
  eligibility_approved,
  range_approved,
  response,
  comment,
  responded_at
)
select
  proposal.id,
  proposal.proposed_by,
  true,
  true,
  'approved',
  null,
  now()
from public.adjudication_category_proposals proposal
join public.profiles author
  on author.id = proposal.proposed_by
where author.role = 'advisory_member'::public.app_role
  and proposal.status <> 'draft'
  and proposal.range_min is not null
  and proposal.range_max is not null
  and proposal.range_max - proposal.range_min = 2.00
  and exists (
    select 1
    from public.adjudicator_assignments assignment
    where assignment.application_id = proposal.application_id
      and assignment.adjudicator_user_id = proposal.proposed_by
      and assignment.can_score = true
      and assignment.removed_at is null
  )
on conflict (proposal_id, adjudicator_user_id)
do update set
  eligibility_approved = true,
  range_approved = true,
  response = 'approved',
  comment = null,
  responded_at = now(),
  updated_at = now();

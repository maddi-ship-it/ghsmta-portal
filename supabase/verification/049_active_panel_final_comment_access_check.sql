-- Run after 20261111034711_allow_all_active_panel_members_to_read_final_comments.sql.

do $$
declare
  policy_expression text;
begin
  select pg_get_expr(policy.qual, policy.polrelid)
  into policy_expression
  from pg_policy policy
  where policy.polrelid = 'public.adjudication_panel_feedback'::regclass
    and policy.polname = 'owners and active panel read shared feedback';

  if policy_expression is null then
    raise exception 'The active-panel final-comment read policy is missing.';
  end if;

  if policy_expression not ilike '%can_score%'
     or policy_expression not ilike '%can_comment%'
     or policy_expression not ilike '%status%approved%'
     or policy_expression not ilike '%removed_at%is null%' then
    raise exception 'The active-panel final-comment read policy is incomplete: %', policy_expression;
  end if;

  if exists (
    select 1
    from pg_policy policy
    where policy.polrelid = 'public.adjudication_panel_feedback'::regclass
      and policy.polname in (
        'owners and assigned panel read shared feedback',
        'assigned adjudicators read final comments'
      )
  ) then
    raise exception 'A superseded assigned-writer-only final-comment policy remains.';
  end if;
end;
$$;

select 'active panel final comment access verification passed' as result;

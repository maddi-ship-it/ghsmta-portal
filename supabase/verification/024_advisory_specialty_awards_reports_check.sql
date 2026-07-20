-- Migration 024 verification

select
  to_regclass('public.advisory_specialty_award_recommendations')
    as specialty_award_table,
  to_regprocedure('public.can_advisory_review_application(uuid,uuid)')
    as advisory_review_gate,
  to_regprocedure('public.get_advisory_review_application_ids()')
    as advisory_review_ids,
  to_regprocedure(
    'public.save_specialty_award_recommendations(uuid,jsonb,boolean)'
  ) as specialty_award_save;

select
  to_regclass('public.owner_report_missing_comments')
    as missing_comments_report,
  to_regclass('public.owner_report_missing_scores')
    as missing_scores_report,
  to_regclass('public.owner_report_specialty_awards')
    as specialty_awards_report;

select
  award_type,
  recommendation_status,
  status,
  count(*) as recommendations
from public.advisory_specialty_award_recommendations
group by award_type, recommendation_status, status
order by award_type, recommendation_status, status;

select count(*) as comments_missing
from public.owner_report_missing_comments;

select count(*) as scores_missing
from public.owner_report_missing_scores;

select count(*) as specialty_award_responses
from public.owner_report_specialty_awards;

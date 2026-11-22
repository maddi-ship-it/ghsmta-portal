import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import { isPanelNarrativeApprovalComplete } from "@/lib/panel-narrative";
import { richTextHasContent } from "@/lib/rich-text";

type WorkflowApplication = {
  id: string;
  form_version_id: string | null;
};

type WorkflowFormVersion = {
  id: string;
  scoring_rubric_id: string | null;
};

type WorkflowCategory = {
  id: string;
  rubric_id: string;
  category_key: string;
  active?: boolean;
};

type WorkflowScoreability = {
  application_id: string;
  category_id: string;
  is_scoreable: boolean;
};

type WorkflowFeedback = {
  application_id: string;
  category_id: string;
  status: string;
  final_comment: string | null;
  assigned_to: string | null;
  approved_by: string | null;
};

type WorkflowAssignment = {
  application_id: string;
  adjudicator_user_id: string;
  can_comment: boolean;
  removed_at?: string | null;
};

export type ScheduleCommentWorkflowMilestones = {
  commentsSentToAdjudicators: boolean;
  allCommentsReviewedAndApproved: boolean;
};

export function buildScheduleCommentWorkflowMilestones({
  applications,
  formVersions,
  categories,
  scoreability,
  feedback,
  assignments,
}: {
  applications: WorkflowApplication[];
  formVersions: WorkflowFormVersion[];
  categories: WorkflowCategory[];
  scoreability: WorkflowScoreability[];
  feedback: WorkflowFeedback[];
  assignments: WorkflowAssignment[];
}) {
  const rubricByFormVersion = new Map(
    formVersions.map((formVersion) => [
      formVersion.id,
      formVersion.scoring_rubric_id,
    ]),
  );
  const categoriesByRubric = new Map<string, WorkflowCategory[]>();
  for (const category of categories) {
    if (category.active === false) continue;
    const collection = categoriesByRubric.get(category.rubric_id) ?? [];
    collection.push(category);
    categoriesByRubric.set(category.rubric_id, collection);
  }

  const unscoreableByApplication = new Map<string, Set<string>>();
  for (const decision of scoreability) {
    if (decision.is_scoreable !== false) continue;
    const collection =
      unscoreableByApplication.get(decision.application_id) ?? new Set();
    collection.add(decision.category_id);
    unscoreableByApplication.set(decision.application_id, collection);
  }

  const feedbackByApplicationAndCategory = new Map(
    feedback.map((item) => [
      `${item.application_id}:${item.category_id}`,
      item,
    ]),
  );
  const panelReviewersByApplication = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!assignment.can_comment || assignment.removed_at != null) continue;
    const collection =
      panelReviewersByApplication.get(assignment.application_id) ?? new Set();
    collection.add(assignment.adjudicator_user_id);
    panelReviewersByApplication.set(assignment.application_id, collection);
  }

  return new Map(
    applications.map((application) => {
      const rubricId = application.form_version_id
        ? rubricByFormVersion.get(application.form_version_id)
        : null;
      const unscoreable =
        unscoreableByApplication.get(application.id) ?? new Set<string>();
      const requiredCategoryIds = rubricId
        ? (categoriesByRubric.get(rubricId) ?? [])
            .filter(
              (category) =>
                category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY &&
                !unscoreable.has(category.id),
            )
            .map((category) => category.id)
        : [];
      const panelReviewerIds =
        panelReviewersByApplication.get(application.id) ?? new Set<string>();
      const commentsSentToAdjudicators =
        requiredCategoryIds.length > 0 &&
        requiredCategoryIds.every((categoryId) => {
          const item = feedbackByApplicationAndCategory.get(
            `${application.id}:${categoryId}`,
          );
          return (
            item?.status === "approved" &&
            richTextHasContent(item.final_comment)
          );
        });
      const allCommentsReviewedAndApproved =
        commentsSentToAdjudicators &&
        requiredCategoryIds.every((categoryId) => {
          const item = feedbackByApplicationAndCategory.get(
            `${application.id}:${categoryId}`,
          );
          return Boolean(
            item &&
              isPanelNarrativeApprovalComplete({
                assignedTo: item.assigned_to,
                approvedBy: item.approved_by,
                panelReviewerIds,
              }),
          );
        });

      return [
        application.id,
        {
          commentsSentToAdjudicators,
          allCommentsReviewedAndApproved,
        },
      ] as const;
    }),
  );
}

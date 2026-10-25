import type { ReleasedFeedbackSummary } from "@/lib/types";

export const ADJUDICATION_SCHOOL_CHAT_CHANNEL_TYPE = "school_dm" as const;

export const PICK_SIX_RELEASE_MESSAGE = `Hi Director,

I’m excited to share your Pick 6 Report from this season’s Georgia High School Musical Theatre Awards! This report provides initial feedback on the six categories you selected in your application.

As you review the comments, I want to emphasize the intention behind our adjudication process. You are the expert of your troupe, your students, and the artistic vision guiding your production. Our adjudicators approach their work as informed audience members, using the context and intentions you shared in your application, along with our established criteria, to assess how that vision translates to the audience.

Their comments are not intended to prescribe how you should direct or develop your program, but rather to offer another perspective. Our goal is to provide feedback that affirms your successes, inspires new ideas, encourages artistic growth, and supports the incredible work you and your students are doing.

Above all, we are in your corner! We want our adjudicators to be advocates for your program and students, and we hope their insights serve as a meaningful resource in your ongoing arts education journey.

To view your Pick 6 report, go to School/Released Results. Your full, comprehensive narrative comments for all adjudicated categories will be available in May.

If you have questions about your feedback or would like to explore ways to turn these insights into future opportunities for your students, I’m always happy to help.

Warm regards,
Beth`;

export function buildAdjudicationReleaseAnnouncement({
  schoolName,
  productionTitle,
  releaseScores,
  releaseComments,
  releasedCommentTitles = [],
}: {
  schoolName: string;
  productionTitle: string | null;
  releaseScores: boolean;
  releaseComments: boolean;
  releasedCommentTitles?: string[];
}) {
  const isPickSixRelease =
    releaseComments &&
    !releaseScores &&
    releasedCommentTitles.length === 6;
  if (isPickSixRelease) {
    return {
      subject: "Your Pick 6 Report is ready",
      body: PICK_SIX_RELEASE_MESSAGE,
    };
  }

  const production = productionTitle?.trim() || "Untitled production";
  const releasedItems = releaseScores && releaseComments
    ? "scores and comments"
    : releaseScores
      ? "scores"
      : "comments";
  const categorySummary = releasedCommentTitles.length > 0
    ? `\n\nReleased comments: ${releasedCommentTitles.join(", ")}.`
    : "";

  return {
    subject:
      releaseScores && releaseComments
        ? "Adjudication scores and comments released"
        : releaseScores
          ? "Adjudication scores released"
          : "Adjudication comments released",
    body: `GHSMTA has released adjudication ${releasedItems} for ${schoolName} — ${production}.${categorySummary}\n\nOpen Results in the portal to review what is now available.`,
  };
}

export function mergeReleasedFeedback(
  current: ReleasedFeedbackSummary[],
  selected: ReleasedFeedbackSummary[],
) {
  const selectedCategoryIds = new Set(
    selected.map((item) => item.category_id),
  );

  return [
    ...current.filter(
      (item) => !selectedCategoryIds.has(item.category_id),
    ),
    ...selected,
  ].sort(
    (left, right) =>
      left.sort_order - right.sort_order ||
      left.title.localeCompare(right.title),
  );
}

export function updateSelectedCategoryIds(
  current: Set<string>,
  categoryId: string,
  checked: boolean,
) {
  const next = new Set(current);
  if (checked) {
    next.add(categoryId);
  } else {
    next.delete(categoryId);
  }
  return next;
}

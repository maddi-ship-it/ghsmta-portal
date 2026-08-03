export const FEEDBACK_STATUSES = [
  "new",
  "needs_information",
  "reviewing",
  "planned",
  "in_progress",
  "resolved",
  "closed",
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  needs_information: "Needs information",
  reviewing: "Reviewing",
  planned: "Planned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return FEEDBACK_STATUSES.includes(value as FeedbackStatus);
}

import type { ApplicationReferencePanel } from "@/lib/application-reference-panels";

export const ACTING_CANDIDATE_REVIEW_ACTIONS = [
  "acting_candidates_submitted",
  "acting_candidates_revised",
  "acting_candidates_response",
  "acting_candidates_approved",
] as const;

export type ActingCandidateSlot =
  | "leading_actress"
  | "leading_actor"
  | "supporting_performer_a"
  | "supporting_performer_b"
  | "featured_performer";

export type ActingCandidate = {
  slot: ActingCandidateSlot;
  label: string;
  name: string;
  pronouns: string;
  role: string;
  gradeLevel: string;
};

export type ActingCandidateApproval = {
  userId: string;
  response: "approved" | "changes_requested";
  comment: string | null;
  respondedAt: string;
};

export type ActingCandidateReviewState = {
  schemaVersion: 1;
  applicationId: string;
  revision: number;
  status: "draft" | "pending" | "changes_requested" | "approved";
  originalCandidates: ActingCandidate[];
  candidates: ActingCandidate[];
  changedSlots: ActingCandidateSlot[];
  requiredApproverIds: string[];
  approvals: ActingCandidateApproval[];
  coordinatorId: string | null;
  coordinatorName: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  schoolMessageId: string | null;
  sectionOpened: boolean;
  pronunciationReuploadRequired: boolean;
};

export type ActingCandidateReviewer = {
  id: string;
  name: string;
  role: "adjudicator" | "advisory_member";
};

const SLOT_DEFINITIONS: Array<{
  slot: ActingCandidateSlot;
  label: string;
}> = [
  { slot: "leading_actress", label: "Leading Actress" },
  { slot: "leading_actor", label: "Leading Actor" },
  { slot: "supporting_performer_a", label: "Supporting Performer (A)" },
  { slot: "supporting_performer_b", label: "Supporting Performer (B)" },
  { slot: "featured_performer", label: "Featured Performer" },
];

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function itemValue(
  items: Array<{ label: string; value: string }>,
  matches: string[],
  excludes: string[] = [],
) {
  const item = items.find((candidate) => {
    const label = normalize(candidate.label);
    return (
      matches.some((match) => label.includes(normalize(match))) &&
      !excludes.some((exclude) => label.includes(normalize(exclude)))
    );
  });
  return item?.value?.trim() ?? "";
}

export function extractActingCandidates(
  panels: ApplicationReferencePanel[],
): ActingCandidate[] {
  const actingPanel = panels.find((panel) => panel.key === "acting-candidates");

  return SLOT_DEFINITIONS.map(({ slot, label }) => {
    const group = actingPanel?.groups.find(
      (candidateGroup) =>
        normalize(candidateGroup.title) === normalize(label) ||
        (slot === "supporting_performer_a" &&
          normalize(candidateGroup.title) === "supporting_performer_a") ||
        (slot === "supporting_performer_b" &&
          normalize(candidateGroup.title) === "supporting_performer_b"),
    );
    const items = group?.items ?? [];
    const selectedPronouns = itemValue(items, ["pronouns"], ["other"]);
    const otherPronouns = itemValue(items, ["pronouns other", "other pronouns"]);

    return {
      slot,
      label,
      name: itemValue(items, ["name"]),
      pronouns:
        normalize(selectedPronouns) === "other" && otherPronouns
          ? otherPronouns
          : selectedPronouns || otherPronouns,
      role: itemValue(items, ["role", "character"]),
      gradeLevel: itemValue(items, ["grade"]),
    };
  });
}

export function changedActingCandidateSlots(
  originalCandidates: ActingCandidate[],
  candidates: ActingCandidate[],
) {
  const originalBySlot = new Map(
    originalCandidates.map((candidate) => [candidate.slot, candidate]),
  );

  return candidates.flatMap((candidate) => {
    const original = originalBySlot.get(candidate.slot);
    const changed = ["name", "pronouns", "role", "gradeLevel"].some(
      (field) =>
        normalize(
          String(candidate[field as keyof ActingCandidate] ?? ""),
        ) !==
        normalize(String(original?.[field as keyof ActingCandidate] ?? "")),
    );
    return changed ? [candidate.slot] : [];
  });
}

export function createInitialActingCandidateReviewState({
  applicationId,
  candidates,
  requiredApproverIds,
}: {
  applicationId: string;
  candidates: ActingCandidate[];
  requiredApproverIds: string[];
}): ActingCandidateReviewState {
  return {
    schemaVersion: 1,
    applicationId,
    revision: 0,
    status: "draft",
    originalCandidates: candidates,
    candidates,
    changedSlots: [],
    requiredApproverIds,
    approvals: [],
    coordinatorId: null,
    coordinatorName: null,
    submittedAt: null,
    approvedAt: null,
    schoolMessageId: null,
    sectionOpened: false,
    pronunciationReuploadRequired: false,
  };
}

export function parseActingCandidateReviewState(
  value: unknown,
): ActingCandidateReviewState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Partial<ActingCandidateReviewState>;
  if (
    state.schemaVersion !== 1 ||
    typeof state.applicationId !== "string" ||
    !Array.isArray(state.candidates) ||
    !Array.isArray(state.originalCandidates) ||
    !Array.isArray(state.requiredApproverIds) ||
    !Array.isArray(state.approvals)
  ) {
    return null;
  }
  return state as ActingCandidateReviewState;
}

export function actingCandidateReviewIsComplete(
  state: ActingCandidateReviewState,
  currentUserId?: string,
) {
  if (state.status === "approved") return true;
  if (!currentUserId || state.status !== "pending") return false;
  return state.approvals.some(
    (approval) =>
      approval.userId === currentUserId && approval.response === "approved",
  );
}

function candidateLine(candidate: ActingCandidate) {
  const name = candidate.name || "Not provided";
  return `${candidate.label}: ${name}${candidate.role ? ` (${candidate.role})` : ""}`;
}

function changedCandidateLine(candidate: ActingCandidate) {
  const name = candidate.name || "Not provided";
  return `${candidate.label}: ${name}${candidate.role ? ` as ${candidate.role}` : ""}`;
}

export function buildActingCandidateSchoolMessage({
  contactName,
  coordinatorName,
  candidates,
  changedSlots,
  sectionDeadline,
  sectionOpened = true,
  referenceFilesUrl,
  schoolFilesUrl,
}: {
  contactName: string | null;
  coordinatorName: string;
  candidates: ActingCandidate[];
  changedSlots: ActingCandidateSlot[];
  sectionDeadline: string | null;
  sectionOpened?: boolean;
  referenceFilesUrl: string;
  schoolFilesUrl: string;
}) {
  const hasChanges = changedSlots.length > 0;
  const greeting = contactName?.trim()
    ? `Hi ${contactName.trim().split(/\s+/)[0]}!`
    : "Hello!";
  const deadline = sectionDeadline
    ? `Please remember that Section C is due on ${sectionDeadline}.`
    : "Please complete Section C by the deadline shown in the portal.";
  const changedCandidates = candidates.filter((candidate) =>
    changedSlots.includes(candidate.slot),
  );

  return [
    greeting,
    "",
    "Congratulations on a successful run of your production! We are so proud to have your program and students as part of the Shulers. You and your students have a lot to be proud of!",
    "",
    hasChanges
      ? sectionOpened
        ? "I have moved you to Section C. There have been changes to your acting candidates. The full adjudication panel approved the following substitutions:"
        : "The full adjudication panel confirmed your acting candidates for Section C. There have been changes to your acting candidates, and the panel approved the following substitutions:"
      : sectionOpened
        ? "I have moved you to Section C. There are no changes to your acting candidates."
        : "The full adjudication panel confirmed your acting candidates for Section C. There are no changes to your acting candidates.",
    ...(hasChanges
      ? ["", ...changedCandidates.map(changedCandidateLine)]
      : []),
    "",
    deadline,
    ...(!sectionOpened
      ? ["Section C will appear in the portal when GHSMTA opens it for this application cycle."]
      : []),
    "This includes the Leading Actress and Leading Actor Virtual Audition Packets.",
    `Instructions, supporting materials, and the solo song library are available in Reference Files: ${referenceFilesUrl}`,
    ...(hasChanges
      ? [
          "",
          `Because candidate information changed, please re-upload the affected candidate name pronunciation recording(s) in School Files: ${schoolFilesUrl}`,
        ]
      : []),
    "",
    "Here is the confirmed list of all your acting candidates:",
    ...candidates.map(candidateLine),
    "",
    "If you have any issues or questions regarding any of this, please let me know and I’m happy to help.",
    "",
    "Warm regards,",
    coordinatorName,
  ].join("\n");
}

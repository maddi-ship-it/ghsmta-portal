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
  directorName: string | null;
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

export function extractDirectorName(
  panels: ApplicationReferencePanel[],
): string | null {
  const fullApplication = panels.find(
    (panel) => panel.key === "full-application",
  );
  const directorItem = fullApplication?.groups
    .flatMap((group) => group.items)
    .find((item) => {
      const label = normalize(item.label);
      return (
        ["director_name", "name_of_director"].includes(label) &&
        !label.includes("music") &&
        !label.includes("technical") &&
        !label.includes("phonetic")
      );
    });
  return directorItem?.value?.trim() || null;
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
  directorName = null,
}: {
  applicationId: string;
  candidates: ActingCandidate[];
  requiredApproverIds: string[];
  directorName?: string | null;
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
    directorName,
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
  return {
    ...(state as ActingCandidateReviewState),
    directorName:
      typeof state.directorName === "string" ? state.directorName : null,
    sectionOpened: state.sectionOpened === true,
  };
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

function candidateSubject(candidate: ActingCandidate) {
  if (!candidate.name && !candidate.pronouns && !candidate.role) return "";

  return [candidate.name, candidate.pronouns, candidate.role]
    .map((value) => value || "Not provided")
    .join(" | ");
}

export function actingCandidateSubjectDefaults(
  candidates: ActingCandidate[],
): Record<ActingCandidateSlot, string> {
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.slot,
      candidateSubject(candidate),
    ]),
  ) as Record<ActingCandidateSlot, string>;
}

export function applyActingCandidatesToReferencePanels(
  panels: ApplicationReferencePanel[],
  candidates: ActingCandidate[],
): ApplicationReferencePanel[] {
  return panels.map((panel) => {
    if (panel.key !== "acting-candidates") return panel;

    return {
      ...panel,
      description:
        "Current acting candidates, roles, pronouns, and grade levels from the adjudication review.",
      groups: candidates
        .filter((candidate) =>
          [
            candidate.name,
            candidate.pronouns,
            candidate.role,
            candidate.gradeLevel,
          ].some(Boolean),
        )
        .map((candidate) => ({
          title: candidate.label,
          items: [
            { label: "Name", value: candidate.name },
            { label: "Pronouns", value: candidate.pronouns },
            { label: "Role", value: candidate.role },
            { label: "Grade level", value: candidate.gradeLevel },
          ],
        })),
    };
  });
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
  directorName,
  coordinatorName,
  candidates,
  changedSlots,
  sectionDeadline,
  referenceFilesUrl,
  schoolFilesUrl,
}: {
  directorName: string | null;
  coordinatorName: string;
  candidates: ActingCandidate[];
  changedSlots: ActingCandidateSlot[];
  sectionDeadline: string | null;
  referenceFilesUrl: string;
  schoolFilesUrl: string;
}) {
  const hasChanges = changedSlots.length > 0;
  const greeting = directorName?.trim()
    ? `Hi ${directorName.trim().split(/\s+/)[0]}!`
    : "Hello!";
  const deadline = sectionDeadline
    ? `Please remember that the required post-production materials are due on ${sectionDeadline}.`
    : "Please complete the required post-production materials by the deadline shown in the portal.";
  const changedCandidates = candidates.filter((candidate) =>
    changedSlots.includes(candidate.slot),
  );

  return [
    greeting,
    "",
    "Congratulations on a successful run of your production! We are so proud to have your program and students as part of the Shulers. You and your students have a lot to be proud of!",
    "",
    hasChanges
      ? "There have been changes to your acting candidates. The full adjudication panel approved the following substitutions:"
      : "The full adjudication panel confirmed your acting candidates. There are no changes to your acting candidates.",
    ...(hasChanges
      ? ["", ...changedCandidates.map(changedCandidateLine)]
      : []),
    "",
    deadline,
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

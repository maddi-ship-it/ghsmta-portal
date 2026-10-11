export const APPLY_ADJUDICATION_BRAIN_DUMP_EVENT =
  "ghsmta:apply-adjudication-brain-dump";

export const RESTORE_ADJUDICATION_BRAIN_DUMP_EVENT =
  "ghsmta:offline-draft-restore";

const BULLET_OR_NUMBERED_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const SENTENCE_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "sentence",
});

export type AdjudicationBrainDumpSourceNote = {
  id: string;
  number: number;
  text: string;
};

export type AdjudicationBrainDumpConfidence = "high" | "medium" | "low";

export type AdjudicationBrainDumpReviewStatus =
  | "placed"
  | "needs_review"
  | "unsorted";

export type AdjudicationBrainDumpReviewNote =
  AdjudicationBrainDumpSourceNote & {
    criterionId: string | null;
    confidence: AdjudicationBrainDumpConfidence;
    status: AdjudicationBrainDumpReviewStatus;
    rationale: string;
    duplicateOfNoteId: string | null;
  };

export type AdjudicationBrainDumpTarget = {
  categoryId: string;
  categoryTitle: string;
  categoryOrder: number;
  criterionId: string;
  criterionTitle: string;
  criterionOrder: number;
  subject: string;
};

export type AdjudicationBrainDumpAssignment = {
  criterionId: string;
  sourceNoteId?: string;
  text: string;
};

export type ApplyAdjudicationBrainDumpDetail = {
  assignments: AdjudicationBrainDumpAssignment[];
};

function sentenceParts(value: string) {
  return [...SENTENCE_SEGMENTER.segment(value)]
    .map((part) => part.segment.trim())
    .filter(Boolean);
}

export function segmentAdjudicationBrainDump(
  value: string,
): AdjudicationBrainDumpSourceNote[] {
  const sourceNotes: string[] = [];
  const blocks = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (BULLET_OR_NUMBERED_LINE.test(line)) {
        sourceNotes.push(line.replace(BULLET_OR_NUMBERED_LINE, "").trim());
        continue;
      }

      sourceNotes.push(...sentenceParts(line));
    }
  }

  return sourceNotes.map((text, index) => ({
    id: `note-${index + 1}`,
    number: index + 1,
    text,
  }));
}

export function groupAdjudicationBrainDumpAssignments(
  notes: Array<
    Pick<AdjudicationBrainDumpReviewNote, "criterionId" | "id" | "text">
  >,
) {
  return notes.flatMap((note) =>
    note.criterionId
      ? [
          {
            criterionId: note.criterionId,
            sourceNoteId: note.id,
            text: note.text,
          },
        ]
      : [],
  );
}

export function selectAutomaticallyApplicableBrainDumpNotes<
  T extends Pick<
    AdjudicationBrainDumpReviewNote,
    "criterionId" | "duplicateOfNoteId"
  >,
>(notes: T[]) {
  return notes.filter(
    (note) => Boolean(note.criterionId) && !note.duplicateOfNoteId,
  );
}

export function findExactBrainDumpDuplicates(
  notes: AdjudicationBrainDumpSourceNote[],
) {
  const firstMatchingNoteId = new Map<string, string>();
  const duplicateByNoteId = new Map<string, string>();

  for (const note of notes) {
    const normalized = note.text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const firstNoteId = firstMatchingNoteId.get(normalized);

    if (firstNoteId) {
      duplicateByNoteId.set(note.id, firstNoteId);
    } else {
      firstMatchingNoteId.set(normalized, note.id);
    }
  }

  return duplicateByNoteId;
}

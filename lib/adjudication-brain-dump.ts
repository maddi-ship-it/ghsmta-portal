export const APPLY_ADJUDICATION_BRAIN_DUMP_EVENT =
  "ghsmta:apply-adjudication-brain-dump";

export const RESTORE_ADJUDICATION_BRAIN_DUMP_EVENT =
  "ghsmta:offline-draft-restore";

const BULLET_OR_NUMBERED_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const LEDGER_HEADER_LINE = /^ledger\s*:?\s*$/i;
const ACT_NOTES_HEADER_LINE =
  /^act\s+(?:\d+|[ivxlcdm]+)\s*(?:notes?)?\s*:?\s*$/i;
const ADJUDICATION_NOTE_PREFIX =
  /^(?:md|o|ch|c|e|te|ld|sd|sc|s|co|actress|actor|lactress|lactor|spa|spb|fp|d)(?:\s*(?:\/|&|\+)\s*(?:md|o|ch|c|e|te|ld|sd|sc|s|co|actress|actor|lactress|lactor|spa|spb|fp|d))*$/i;
const SENTENCE_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "sentence",
});

export type AdjudicationBrainDumpField =
  | "scorecard_internal_notes"
  | "scorecard_post_show_notes";

export const ADJUDICATION_BRAIN_DUMP_LEDGER = [
  "Ledger:",
  "MD- Music Direction",
  "O- Orchestra",
  "CH- Choreography",
  "E- Ensemble",
  "TE- Technical Execution",
  "LD- Lighting Design",
  "SD- Sound Design",
  "SC- Scenic",
  "CO- Costumes",
  "Actress- Leading Actress",
  "Actor- Leading Actor",
  "SPA- Supporting Performer A",
  "SPB- Supporting Performer B",
  "FP - Featured Performer",
  "D- Direction",
].join("\n");

function brainDumpActHeading(fieldName: AdjudicationBrainDumpField) {
  return fieldName === "scorecard_internal_notes"
    ? "ACT I NOTES:"
    : "ACT II NOTES:";
}

export function buildAdjudicationBrainDumpTemplate(
  fieldName: AdjudicationBrainDumpField,
) {
  return `${ADJUDICATION_BRAIN_DUMP_LEDGER}\n\n${brainDumpActHeading(fieldName)}\n\n`;
}

export function ensureAdjudicationBrainDumpTemplate(
  value: string,
  fieldName: AdjudicationBrainDumpField,
) {
  const normalizedValue = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trimStart();
  const template = buildAdjudicationBrainDumpTemplate(fieldName);
  if (!normalizedValue) return template;

  const lines = normalizedValue.split("\n");
  const ledgerIndex = lines.findIndex((line) =>
    LEDGER_HEADER_LINE.test(line.trim()),
  );
  const actHeadingIndex = lines.findIndex((line) =>
    ACT_NOTES_HEADER_LINE.test(line.trim()),
  );

  if (ledgerIndex >= 0 && actHeadingIndex > ledgerIndex) {
    return `${template}${lines.slice(actHeadingIndex + 1).join("\n").trimStart()}`;
  }

  if (ledgerIndex < 0 && actHeadingIndex === 0) {
    return `${ADJUDICATION_BRAIN_DUMP_LEDGER}\n\n${normalizedValue}`;
  }

  return `${template}${normalizedValue}`;
}

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

function songTitleFromHeading(value: string) {
  const quotedHeading = value.match(
    /^[“"]\s*(.+?)\s*[”"]\s*(?:[-–—]\s*.*)?$/u,
  );
  if (quotedHeading?.[1]) return quotedHeading[1].trim();

  const unquotedHeading = value.match(/^(.+?)\s*[-–—]\s*(.+)$/u);
  if (!unquotedHeading) return null;

  const title = unquotedHeading[1]?.trim() ?? "";
  const performers = unquotedHeading[2]?.trim() ?? "";
  if (
    !title ||
    !performers ||
    title.length > 120 ||
    performers.length > 160 ||
    ADJUDICATION_NOTE_PREFIX.test(title) ||
    /[.!?]/.test(performers)
  ) {
    return null;
  }

  const looksLikePerformerList =
    /,|\band\b|\bensemble\b|\bpirates?\b/i.test(performers) ||
    /^[\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}$/u.test(
      performers,
    );
  return looksLikePerformerList ? title : null;
}

function withSongContext(text: string, songTitle: string | null) {
  return songTitle ? `Song: “${songTitle}” — ${text}` : text;
}

export function segmentAdjudicationBrainDump(
  value: string,
): AdjudicationBrainDumpSourceNote[] {
  const sourceNotes: string[] = [];
  const lines = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const hasLedger = lines.some((line) => LEDGER_HEADER_LINE.test(line));
  let acceptingObservations = !hasLedger;
  let insideLedger = false;
  let currentSongTitle: string | null = null;

  for (const line of lines) {
    if (LEDGER_HEADER_LINE.test(line)) {
      insideLedger = true;
      acceptingObservations = false;
      currentSongTitle = null;
      continue;
    }

    if (ACT_NOTES_HEADER_LINE.test(line)) {
      insideLedger = false;
      acceptingObservations = true;
      currentSongTitle = null;
      continue;
    }

    if (insideLedger || !acceptingObservations) continue;

    const songTitle = songTitleFromHeading(line);
    if (songTitle) {
      currentSongTitle = songTitle;
      continue;
    }

    if (BULLET_OR_NUMBERED_LINE.test(line)) {
      sourceNotes.push(
        withSongContext(
          line.replace(BULLET_OR_NUMBERED_LINE, "").trim(),
          currentSongTitle,
        ),
      );
      continue;
    }

    for (const sentence of sentenceParts(line)) {
      sourceNotes.push(withSongContext(sentence, currentSongTitle));
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

export function chunkAdjudicationBrainDumpNotes<T>(
  notes: T[],
  batchSize: number,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError("Brain-dump batch size must be a positive integer.");
  }

  const batches: T[][] = [];
  for (let index = 0; index < notes.length; index += batchSize) {
    batches.push(notes.slice(index, index + batchSize));
  }
  return batches;
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

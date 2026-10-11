import { describe, expect, it } from "vitest";

import {
  chunkAdjudicationBrainDumpNotes,
  findExactBrainDumpDuplicates,
  groupAdjudicationBrainDumpAssignments,
  selectAutomaticallyApplicableBrainDumpNotes,
  segmentAdjudicationBrainDump,
} from "./adjudication-brain-dump";

describe("adjudication brain-dump review", () => {
  it("numbers every sentence in chronological prose from the training example", () => {
    const notes = segmentAdjudicationBrainDump(
      "Opening/prologue: village-to-woods world is immediately clear (warm/cool lighting, illustrated moveable trees). Full company has lively energy and mostly clean counterpoint; two inner harmonies get blurry. Baker/Wife dialogue and 'It Takes Two' connected, natural.\n\nAct II: Stakes rise effectively. Tree wagon catches briefly; crew calmly resets.",
    );

    expect(notes).toEqual([
      {
        id: "note-1",
        number: 1,
        text: "Opening/prologue: village-to-woods world is immediately clear (warm/cool lighting, illustrated moveable trees).",
      },
      {
        id: "note-2",
        number: 2,
        text: "Full company has lively energy and mostly clean counterpoint; two inner harmonies get blurry.",
      },
      {
        id: "note-3",
        number: 3,
        text: "Baker/Wife dialogue and 'It Takes Two' connected, natural.",
      },
      {
        id: "note-4",
        number: 4,
        text: "Act II: Stakes rise effectively.",
      },
      {
        id: "note-5",
        number: 5,
        text: "Tree wagon catches briefly; crew calmly resets.",
      },
    ]);
  });

  it("keeps each bullet as one source observation", () => {
    const notes = segmentAdjudicationBrainDump(
      "• Lighting created a clear wooded world. It stayed cohesive.\n- Sound balance changed when performers turned.\n1. Crew recovered calmly.",
    );

    expect(notes.map((note) => note.text)).toEqual([
      "Lighting created a clear wooded world. It stayed cohesive.",
      "Sound balance changed when performers turned.",
      "Crew recovered calmly.",
    ]);
  });

  it("builds one traceable assignment per selected source note", () => {
    expect(
      groupAdjudicationBrainDumpAssignments([
        { id: "note-1", criterionId: "lighting-1", text: "Warm village light." },
        { id: "note-2", criterionId: null, text: "Unclear note." },
        { id: "note-3", criterionId: "sound-2", text: "Mic level dropped." },
      ]),
    ).toEqual([
      {
        criterionId: "lighting-1",
        sourceNoteId: "note-1",
        text: "Warm village light.",
      },
      {
        criterionId: "sound-2",
        sourceNoteId: "note-3",
        text: "Mic level dropped.",
      },
    ]);
  });

  it("flags repeated source observations without removing either one", () => {
    const notes = segmentAdjudicationBrainDump(
      "Memorable, concise character work. Memorable, concise character work.",
    );

    expect([...findExactBrainDumpDuplicates(notes)]).toEqual([
      ["note-2", "note-1"],
    ]);
    expect(notes).toHaveLength(2);
  });

  it("auto-applies every categorized observation except duplicates", () => {
    const notes = [
      {
        id: "note-1",
        number: 1,
        text: "A clear lighting observation.",
        criterionId: "lighting-1",
        confidence: "high" as const,
        status: "placed" as const,
        rationale: "Clear match.",
        duplicateOfNoteId: null,
      },
      {
        id: "note-2",
        number: 2,
        text: "A lower-confidence sound observation.",
        criterionId: "sound-2",
        confidence: "medium" as const,
        status: "needs_review" as const,
        rationale: "Best available match.",
        duplicateOfNoteId: null,
      },
      {
        id: "note-3",
        number: 3,
        text: "A repeated lighting observation.",
        criterionId: "lighting-1",
        confidence: "high" as const,
        status: "needs_review" as const,
        rationale: "Duplicate.",
        duplicateOfNoteId: "note-1",
      },
      {
        id: "note-4",
        number: 4,
        text: "No destination found.",
        criterionId: null,
        confidence: "low" as const,
        status: "unsorted" as const,
        rationale: "No reliable match.",
        duplicateOfNoteId: null,
      },
    ];

    expect(
      selectAutomaticallyApplicableBrainDumpNotes(notes).map(
        (note) => note.id,
      ),
    ).toEqual(["note-1", "note-2"]);
  });

  it("breaks a large brain dump into bounded model requests", () => {
    const notes = Array.from({ length: 211 }, (_, index) => index + 1);
    const batches = chunkAdjudicationBrainDumpNotes(notes, 40);

    expect(batches.map((batch) => batch.length)).toEqual([
      40, 40, 40, 40, 40, 11,
    ]);
    expect(batches.flat()).toEqual(notes);
  });

  it("rejects an invalid model batch size", () => {
    expect(() => chunkAdjudicationBrainDumpNotes([1], 0)).toThrow(RangeError);
  });
});

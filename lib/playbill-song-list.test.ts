import { describe, expect, it } from "vitest";

import { segmentAdjudicationBrainDump } from "./adjudication-brain-dump";
import {
  buildPlaybillBrainDumpOutline,
  buildPlaybillSongListSections,
  parsePlaybillSongList,
  PLAYBILL_SONG_LIST_EXTRACTOR_VERSION,
  PLAYBILL_SONG_LIST_INSTRUCTIONS,
  PLAYBILL_SONG_LIST_REQUEST,
  resolvePlaybillInputKind,
} from "./playbill-song-list";

describe("Playbill song-list extraction", () => {
  it("recognizes act-only lists that use dotted leaders", () => {
    expect(PLAYBILL_SONG_LIST_EXTRACTOR_VERSION).toBe(2);
    expect(PLAYBILL_SONG_LIST_INSTRUCTIONS).toContain(
      "Act I, Act II",
    );
    expect(PLAYBILL_SONG_LIST_INSTRUCTIONS).toContain("dotted leaders");
    expect(PLAYBILL_SONG_LIST_INSTRUCTIONS).toContain(
      "Do not require an overall song-list heading",
    );
    expect(PLAYBILL_SONG_LIST_REQUEST).toContain("Search every page");
  });

  it("sanitizes structured output and drops entries without a title", () => {
    expect(
      parsePlaybillSongList({
        songs: [
          { section: " Act I\n", title: " Opening Number ", performers: "Company" },
          { section: "Act I", title: "", performers: "Lead" },
          { section: "Act II", title: "Finale", performers: null },
        ],
      }),
    ).toEqual([
      { section: "Act I", title: "Opening Number", performers: "Company" },
      { section: "Act II", title: "Finale", performers: "" },
    ]);
  });

  it("rejects output without a songs array", () => {
    expect(parsePlaybillSongList({ entries: [] })).toBeNull();
  });

  it("preserves printed order while grouping consecutive act headings", () => {
    expect(
      buildPlaybillSongListSections([
        { section: "Act I", title: "One", performers: "" },
        { section: "Act I", title: "Two", performers: "" },
        { section: "Act II", title: "Three", performers: "" },
      ]),
    ).toEqual([
      {
        heading: "Act I",
        songs: [
          { section: "Act I", title: "One", performers: "" },
          { section: "Act I", title: "Two", performers: "" },
        ],
      },
      {
        heading: "Act II",
        songs: [{ section: "Act II", title: "Three", performers: "" }],
      },
    ]);
  });

  it("accepts Playbill PDFs and supported image uploads", () => {
    expect(resolvePlaybillInputKind({ fileName: "show.pdf", mimeType: "application/pdf" })).toEqual({
      kind: "pdf",
      mimeType: "application/pdf",
    });
    expect(resolvePlaybillInputKind({ fileName: "show.jpg", mimeType: null })).toEqual({
      kind: "image",
      mimeType: "image/jpeg",
    });
    expect(resolvePlaybillInputKind({ fileName: "show.docx", mimeType: null })).toBeNull();
  });

  it("builds editable act-aware brain-dump outlines with characters", () => {
    const songs = [
      { section: "Act I", title: "Opening", performers: "Company" },
      { section: "Act I", title: "Solo", performers: "Alice" },
      { section: "Act II", title: "Finale", performers: "Alice and Company" },
    ];

    expect(
      buildPlaybillBrainDumpOutline(songs, "scorecard_internal_notes"),
    ).toContain("ACT I NOTES:\n\n“Opening” — Company\n\n“Solo” — Alice");
    expect(
      buildPlaybillBrainDumpOutline(songs, "scorecard_internal_notes"),
    ).not.toContain("Finale");
    expect(
      buildPlaybillBrainDumpOutline(songs, "scorecard_post_show_notes"),
    ).toContain("ACT II NOTES:\n\n“Finale” — Alice and Company");
  });

  it("keeps notes typed beneath an auto-placed song tied to that song", () => {
    const outline = buildPlaybillBrainDumpOutline(
      [{ section: "Act I", title: "Believe", performers: "Sylvia" }],
      "scorecard_internal_notes",
    );
    const withObservation = outline.replace(
      "“Believe” — Sylvia\n",
      "“Believe” — Sylvia\nStrong character work throughout the number.\n",
    );

    expect(segmentAdjudicationBrainDump(withObservation)).toEqual([
      {
        id: "note-1",
        number: 1,
        text: "Song: “Believe” — Strong character work throughout the number.",
      },
    ]);
  });
});

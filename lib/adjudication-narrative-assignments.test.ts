import { describe, expect, it } from "vitest";

import {
  completedNarrativeAssignmentsNow,
  narrativeAssignmentAnnouncement,
} from "@/lib/adjudication-narrative-assignments";

describe("completedNarrativeAssignmentsNow", () => {
  it("returns true only when the final missing assignment is filled", () => {
    expect(
      completedNarrativeAssignmentsNow({
        categoryIds: ["music", "acting"],
        previousAssignments: [
          { categoryId: "music", assignedTo: "beth" },
          { categoryId: "acting", assignedTo: null },
        ],
        nextAssignments: [
          { categoryId: "music", assignedTo: "beth" },
          { categoryId: "acting", assignedTo: "paige" },
        ],
      }),
    ).toBe(true);
  });

  it("does not announce later edits to an already-complete set", () => {
    expect(
      completedNarrativeAssignmentsNow({
        categoryIds: ["music", "acting"],
        previousAssignments: [
          { categoryId: "music", assignedTo: "beth" },
          { categoryId: "acting", assignedTo: "paige" },
        ],
        nextAssignments: [
          { categoryId: "music", assignedTo: "paige" },
          { categoryId: "acting", assignedTo: "paige" },
        ],
      }),
    ).toBe(false);
  });
});

describe("narrativeAssignmentAnnouncement", () => {
  it("lists every category and writer in one panel-channel message", () => {
    expect(
      narrativeAssignmentAnnouncement({
        schoolName: "Demo School 10",
        productionTitle: "Newsies",
        assignments: [
          { categoryTitle: "Music Direction", reviewerName: "Beth Lenhart" },
          { categoryTitle: "Acting", reviewerName: "Paige Laine" },
        ],
      }),
    ).toBe(
      "Final comment writers have been assigned for Demo School 10 — Newsies.\n\n" +
        "• Music Direction — Beth Lenhart\n" +
        "• Acting — Paige Laine",
    );
  });
});

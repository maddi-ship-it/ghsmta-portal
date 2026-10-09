import { describe, expect, it } from "vitest";

import { compareReferenceNames } from "./reference-document-sort";

describe("compareReferenceNames", () => {
  it("sorts numeric names naturally before continuing alphabetically", () => {
    const names = [
      "[10] Wrap-up.mp4",
      "Beta.pdf",
      "[2] Portal tour.mp4",
      "alpha.pdf",
      "[1] Welcome.mp4",
    ];

    expect(names.sort(compareReferenceNames)).toEqual([
      "[1] Welcome.mp4",
      "[2] Portal tour.mp4",
      "[10] Wrap-up.mp4",
      "alpha.pdf",
      "Beta.pdf",
    ]);
  });
});

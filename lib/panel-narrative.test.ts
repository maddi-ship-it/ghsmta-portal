import { describe, expect, it } from "vitest";

import {
  resolveGeneratedNarrativeFinal,
  shouldRefreshGeneratedNarrative,
} from "./panel-narrative";

describe("Owner panel narrative generation", () => {
  it("updates an untouched Owner draft automatically", () => {
    expect(
      resolveGeneratedNarrativeFinal({
        currentGeneratedComment: "Earlier generated draft",
        currentFinalComment: "Earlier generated draft",
        nextGeneratedComment: "Updated generated draft",
      }),
    ).toEqual({
      finalComment: "Updated generated draft",
      preservedOwnerDraft: false,
    });
  });

  it("refreshes the generated suggestion without overwriting an Owner edit", () => {
    expect(
      resolveGeneratedNarrativeFinal({
        currentGeneratedComment: "Earlier generated draft",
        currentFinalComment: "Owner edited draft",
        nextGeneratedComment: "Updated generated draft",
      }),
    ).toEqual({
      finalComment: "Owner edited draft",
      preservedOwnerDraft: true,
    });
  });

  it("lets the manual button replace an Owner edit", () => {
    expect(
      resolveGeneratedNarrativeFinal({
        currentGeneratedComment: "Earlier generated draft",
        currentFinalComment: "Owner edited draft",
        nextGeneratedComment: "Manually refreshed draft",
        replaceOwnerDraft: true,
      }),
    ).toEqual({
      finalComment: "Manually refreshed draft",
      preservedOwnerDraft: false,
    });
  });

  it("refreshes when live notes are newer even if an Owner draft exists", () => {
    expect(
      shouldRefreshGeneratedNarrative({
        status: "generated",
        generatedAt: "2026-09-20T22:17:51.810Z",
        latestSourceUpdate: Date.parse("2026-09-20T23:33:19.189Z"),
        now: Date.parse("2026-09-20T23:35:00.000Z"),
        cooldownMs: 90_000,
      }),
    ).toBe(true);
  });
});

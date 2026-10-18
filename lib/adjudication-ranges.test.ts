import { describe, expect, it } from "vitest";

import {
  deriveNaturalTwoPointRange,
  formatTwoPointRangeStart,
  isValidTwoPointRange,
  twoPointRangeFromStart,
} from "./adjudication-ranges";

describe("adjudication two-point ranges", () => {
  it("normalizes stored numeric values to the dropdown option format", () => {
    expect(formatTwoPointRangeStart(5)).toBe("5.00");
    expect(formatTwoPointRangeStart("6.25")).toBe("6.25");
    expect(formatTwoPointRangeStart(null)).toBe("");
  });

  it("builds and validates both endpoints of a two-point range", () => {
    expect(twoPointRangeFromStart("5.00")).toEqual({
      rangeMinimum: 5,
      rangeMaximum: 7,
    });
    expect(twoPointRangeFromStart("6.25")).toEqual({
      rangeMinimum: 6.25,
      rangeMaximum: 8.25,
    });
    expect(twoPointRangeFromStart("8.25")).toBeNull();
    expect(twoPointRangeFromStart("5.10")).toBeNull();
  });

  it("requires both endpoints to form an exact two-point range", () => {
    expect(isValidTwoPointRange(5, 7)).toBe(true);
    expect(isValidTwoPointRange("6.25", "8.25")).toBe(true);
    expect(isValidTwoPointRange(5, null)).toBe(false);
    expect(isValidTwoPointRange(5, 7.25)).toBe(false);
    expect(isValidTwoPointRange(8.25, 10.25)).toBe(false);
  });

  it("centers a valid two-point range around panel category averages", () => {
    expect(deriveNaturalTwoPointRange([7.5, 8, 8.5])).toEqual({
      rangeMinimum: 7,
      rangeMaximum: 9,
      scoreMinimum: 7.5,
      scoreMaximum: 8.5,
      spread: 1,
    });
    expect(deriveNaturalTwoPointRange([9, 9.5, 10])).toMatchObject({
      rangeMinimum: 8,
      rangeMaximum: 10,
    });
    expect(deriveNaturalTwoPointRange([7.25, 8.5, 9.25])).toMatchObject({
      rangeMinimum: 7.25,
      rangeMaximum: 9.25,
    });
  });

  it("does not suggest a range when scores cannot fit a selectable interval", () => {
    expect(deriveNaturalTwoPointRange([6.75, 9])).toBeNull();
    expect(deriveNaturalTwoPointRange([7.9, 9.8])).toBeNull();
    expect(deriveNaturalTwoPointRange([8])).toBeNull();
  });
});

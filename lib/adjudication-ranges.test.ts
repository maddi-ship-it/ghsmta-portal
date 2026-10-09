import { describe, expect, it } from "vitest";

import {
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
});

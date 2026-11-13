import { describe, expect, it } from "vitest";

import { autoLinkSegments } from "./auto-link";

describe("automatic hyperlinks", () => {
  it("links secure and www addresses while preserving surrounding text", () => {
    expect(
      autoLinkSegments(
        "Review https://example.com/report, then visit www.artsbridgega.org.",
      ),
    ).toEqual([
      { kind: "text", text: "Review " },
      {
        kind: "link",
        text: "https://example.com/report",
        href: "https://example.com/report",
      },
      { kind: "text", text: ", then visit " },
      {
        kind: "link",
        text: "www.artsbridgega.org",
        href: "https://www.artsbridgega.org/",
      },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps balanced URL parentheses and excludes sentence punctuation", () => {
    expect(
      autoLinkSegments("See https://example.com/wiki/Show_(musical)."),
    ).toEqual([
      { kind: "text", text: "See " },
      {
        kind: "link",
        text: "https://example.com/wiki/Show_(musical)",
        href: "https://example.com/wiki/Show_(musical)",
      },
      { kind: "text", text: "." },
    ]);
  });

  it("does not turn non-web protocols into links", () => {
    const unsafeProtocol = "javascript:";
    const unsafeValue = `${unsafeProtocol}alert${"(1)"} stays text`;

    expect(autoLinkSegments(unsafeValue)).toEqual([
      { kind: "text", text: unsafeValue },
    ]);
  });
});

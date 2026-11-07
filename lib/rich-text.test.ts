import { describe, expect, it } from "vitest";

import { richTextToPlainText, sanitizeRichTextHtml } from "./rich-text";

describe("rich text non-breaking spaces", () => {
  it("normalizes literal HTML entities in plain text", () => {
    expect(sanitizeRichTextHtml("Strong&nbsp;diction")).toBe(
      "<p>Strong diction</p>",
    );
  });

  it("normalizes encoded and numeric entities in saved HTML", () => {
    expect(
      sanitizeRichTextHtml(
        "<p>Strong&amp;nbsp;diction&#160;and&#xA0;clarity</p>",
      ),
    ).toBe("<p>Strong diction and clarity</p>");
  });

  it("normalizes Unicode non-breaking spaces in plain-text previews", () => {
    expect(richTextToPlainText("Clear\u00a0phrasing")).toBe(
      "Clear phrasing",
    );
  });
});

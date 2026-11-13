import { describe, expect, it } from "vitest";

import {
  appendUniquePlainTextToRichText,
  richTextToPlainText,
  sanitizeRichTextHtml,
} from "./rich-text";

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

describe("rich text brain-dump additions", () => {
  it("appends new observations without changing existing formatted comments", () => {
    const existing =
      "<p><strong>Existing observation stays bold.</strong></p><ul><li>Existing list item</li></ul>";

    expect(
      appendUniquePlainTextToRichText(existing, [
        "New choreography observation.",
        "New lighting observation.",
      ]),
    ).toBe(
      `${existing}<p>New choreography observation.</p><p>New lighting observation.</p>`,
    );
  });

  it("does not duplicate a comment already in the field or the same sort batch", () => {
    const existing = "<p>Existing observation.</p>";

    expect(
      appendUniquePlainTextToRichText(existing, [
        "Existing observation.",
        "New observation.",
        "new observation.",
      ]),
    ).toBe(`${existing}<p>New observation.</p>`);
  });

  it("treats sorted observations as plain text instead of replacing field HTML", () => {
    expect(
      appendUniquePlainTextToRichText("<p>Existing.</p>", [
        "<strong>Literal source note</strong>",
      ]),
    ).toBe(
      "<p>Existing.</p><p>&lt;strong&gt;Literal source note&lt;/strong&gt;</p>",
    );
  });
});

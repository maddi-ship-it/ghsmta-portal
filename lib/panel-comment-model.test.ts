import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_COMMENT_MODEL,
  resolvePanelCommentModel,
} from "./panel-comment-model";

describe("resolvePanelCommentModel", () => {
  it("uses the model selected in the active narrative prompt", () => {
    expect(resolvePanelCommentModel("gpt-6.1-sol")).toBe(
      "gpt-6.1-sol",
    );
  });

  it("defaults final comments to GPT-6 Astra", () => {
    expect(resolvePanelCommentModel("  ")).toBe(
      DEFAULT_PANEL_COMMENT_MODEL,
    );
    expect(DEFAULT_PANEL_COMMENT_MODEL).toBe("gpt-6-astra");
    expect(resolvePanelCommentModel()).toBe(DEFAULT_PANEL_COMMENT_MODEL);
  });
});

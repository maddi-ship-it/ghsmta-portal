import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_COMMENT_MODEL,
  resolvePanelCommentModel,
} from "./panel-comment-model";

describe("resolvePanelCommentModel", () => {
  it("uses the model selected in the active narrative prompt", () => {
    expect(resolvePanelCommentModel("gpt-6-sol", "gpt-5-mini")).toBe(
      "gpt-6-sol",
    );
  });

  it("uses the environment fallback when the prompt has no model", () => {
    expect(resolvePanelCommentModel("  ", "gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("defaults final comments to Sol", () => {
    expect(resolvePanelCommentModel()).toBe(DEFAULT_PANEL_COMMENT_MODEL);
  });
});

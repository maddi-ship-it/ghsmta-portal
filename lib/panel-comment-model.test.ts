import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_COMMENT_MODEL,
  resolvePanelCommentModel,
} from "./panel-comment-model";

describe("resolvePanelCommentModel", () => {
  it("uses the model selected in the active narrative prompt", () => {
    expect(resolvePanelCommentModel("gpt-5", "gpt-5-mini")).toBe(
      "gpt-5",
    );
  });

  it("does not send Codex model aliases to the OpenAI API", () => {
    expect(resolvePanelCommentModel("gpt-6-sol", "gpt-5-mini")).toBe(
      "gpt-5-mini",
    );
  });

  it("uses the environment fallback when the prompt has no model", () => {
    expect(resolvePanelCommentModel("  ", "gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("does not use a Codex model alias from the environment fallback", () => {
    expect(resolvePanelCommentModel("", "gpt-5.6-sol")).toBe(
      DEFAULT_PANEL_COMMENT_MODEL,
    );
  });

  it("defaults final comments to an OpenAI API model", () => {
    expect(resolvePanelCommentModel()).toBe(DEFAULT_PANEL_COMMENT_MODEL);
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENAI_TEXT_MODEL,
  OPENAI_REASONING_EFFORT,
  resolveOpenAITextModel,
} from "./openai-model";

describe("OpenAI model configuration", () => {
  it("defaults text and vision generation to GPT-6 Astra", () => {
    expect(DEFAULT_OPENAI_TEXT_MODEL).toBe("gpt-6-astra");
    expect(resolveOpenAITextModel()).toBe("gpt-6-astra");
  });

  it("preserves the effective reasoning effort for each workload", () => {
    expect(OPENAI_REASONING_EFFORT).toEqual({
      adjudicationSort: "low",
      handwriting: "medium",
      panelComment: "high",
      phonetic: "low",
    });
  });

  it("allows a dedicated non-empty workload override", () => {
    expect(resolveOpenAITextModel("  gpt-6.1-sol  ")).toBe("gpt-6.1-sol");
    expect(resolveOpenAITextModel("  ")).toBe("gpt-6-astra");
  });
});

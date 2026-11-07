import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENAI_TEXT_MODEL,
  OPENAI_REASONING_EFFORT,
  PLAYBILL_SONG_LIST_MODEL,
} from "./openai-model";

describe("OpenAI model configuration", () => {
  it("defaults text and vision generation to GPT-6 Astra", () => {
    expect(DEFAULT_OPENAI_TEXT_MODEL).toBe("gpt-6-astra");
  });

  it("uses GPT-6 Luna for Playbill song-list extraction", () => {
    expect(PLAYBILL_SONG_LIST_MODEL).toBe("gpt-6-luna");
  });

  it("preserves the effective reasoning effort for each workload", () => {
    expect(OPENAI_REASONING_EFFORT).toEqual({
      adjudicationSort: "low",
      handwriting: "medium",
      panelComment: "high",
      playbillSongList: "low",
      phonetic: "low",
    });
  });

});

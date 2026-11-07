import { describe, expect, it } from "vitest";

import {
  parseAiSdkUsage,
  parseOpenAIResponseUsage,
  parseOpenAITranscriptionUsage,
} from "./openai-usage";

const commonTokenUsage = {
  usageType: "tokens" as const,
  responseId: null,
  model: null,
  serviceTier: null,
  inputTokens: 1200,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  audioInputTokens: 0,
  textInputTokens: 0,
  outputTokens: 80,
  reasoningTokens: 0,
  totalTokens: 1280,
  audioSeconds: null,
};

describe("AI request usage", () => {
  it("captures the complete Responses API token breakdown", () => {
    expect(
      parseOpenAIResponseUsage({
        id: "resp_123",
        model: "gpt-6-luna-2026-10-01",
        service_tier: "default",
        usage: {
          input_tokens: 1200,
          input_tokens_details: {
            cached_tokens: 300,
            cache_write_tokens: 50,
          },
          output_tokens: 80,
          output_tokens_details: { reasoning_tokens: 20 },
          total_tokens: 1280,
        },
      }),
    ).toEqual({
      ...commonTokenUsage,
      responseId: "resp_123",
      model: "gpt-6-luna-2026-10-01",
      serviceTier: "default",
      cachedInputTokens: 300,
      cacheWriteTokens: 50,
      reasoningTokens: 20,
    });
  });

  it("captures token-billed audio transcription usage", () => {
    expect(
      parseOpenAITranscriptionUsage({
        usage: {
          type: "tokens",
          input_tokens: 1200,
          input_token_details: { audio_tokens: 1100, text_tokens: 100 },
          output_tokens: 80,
          total_tokens: 1280,
        },
      }),
    ).toEqual({
      ...commonTokenUsage,
      audioInputTokens: 1100,
      textInputTokens: 100,
    });
  });

  it("captures duration-billed audio transcription usage", () => {
    expect(
      parseOpenAITranscriptionUsage({
        usage: { type: "duration", seconds: 4.25 },
      }),
    ).toEqual({
      usageType: "duration",
      responseId: null,
      model: null,
      serviceTier: null,
      inputTokens: null,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      audioInputTokens: 0,
      textInputTokens: 0,
      outputTokens: null,
      reasoningTokens: 0,
      totalTokens: null,
      audioSeconds: 4.25,
    });
  });

  it("captures normalized AI SDK usage and response metadata", () => {
    expect(
      parseAiSdkUsage(
        {
          inputTokens: 1200,
          inputTokenDetails: {
            cacheReadTokens: 300,
            cacheWriteTokens: 50,
          },
          outputTokens: 80,
          outputTokenDetails: { reasoningTokens: 20 },
          totalTokens: 1280,
        },
        { id: "resp_sdk", modelId: "gpt-6-astra" },
      ),
    ).toEqual({
      ...commonTokenUsage,
      responseId: "resp_sdk",
      model: "gpt-6-astra",
      cachedInputTokens: 300,
      cacheWriteTokens: 50,
      reasoningTokens: 20,
    });
  });

  it("rejects missing or invalid required usage totals", () => {
    expect(parseOpenAIResponseUsage({ usage: null })).toBeNull();
    expect(
      parseOpenAIResponseUsage({
        usage: { input_tokens: -1, output_tokens: 2, total_tokens: 1 },
      }),
    ).toBeNull();
    expect(
      parseOpenAITranscriptionUsage({
        usage: { type: "duration", seconds: -1 },
      }),
    ).toBeNull();
  });
});

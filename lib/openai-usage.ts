import { createAdminClient } from "./supabase/admin";

export type AiRequestUsage = {
  usageType: "tokens" | "duration";
  responseId: string | null;
  model: string | null;
  serviceTier: string | null;
  inputTokens: number | null;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  audioInputTokens: number;
  textInputTokens: number;
  outputTokens: number | null;
  reasoningTokens: number;
  totalTokens: number | null;
  audioSeconds: number | null;
};

type RecordAiRequestUsageInput = {
  feature: string;
  fallbackModel: string;
  requestedBy: string;
  usage: AiRequestUsage | null;
  applicationId?: string | null;
  portalFileId?: string | null;
  responseId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

type AiSdkUsage = {
  inputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
  totalTokens?: number;
};

type AiSdkResponse = {
  id?: string;
  modelId?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseOpenAIResponseUsage(
  payload: unknown,
): AiRequestUsage | null {
  if (!payload || typeof payload !== "object") return null;

  const response = payload as {
    id?: unknown;
    model?: unknown;
    service_tier?: unknown;
    usage?: {
      input_tokens?: unknown;
      input_tokens_details?: {
        cached_tokens?: unknown;
        cache_write_tokens?: unknown;
      } | null;
      output_tokens?: unknown;
      output_tokens_details?: { reasoning_tokens?: unknown } | null;
      total_tokens?: unknown;
    } | null;
  };
  const usage = response.usage;
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const totalTokens = nonNegativeInteger(usage.total_tokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null;
  }

  return {
    usageType: "tokens",
    responseId: optionalString(response.id),
    model: optionalString(response.model),
    serviceTier: optionalString(response.service_tier),
    inputTokens,
    cachedInputTokens:
      nonNegativeInteger(usage.input_tokens_details?.cached_tokens) ?? 0,
    cacheWriteTokens:
      nonNegativeInteger(usage.input_tokens_details?.cache_write_tokens) ?? 0,
    audioInputTokens: 0,
    textInputTokens: 0,
    outputTokens,
    reasoningTokens:
      nonNegativeInteger(usage.output_tokens_details?.reasoning_tokens) ?? 0,
    totalTokens,
    audioSeconds: null,
  };
}

export function parseOpenAITranscriptionUsage(
  payload: unknown,
): AiRequestUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as {
    usage?: {
      type?: unknown;
      input_tokens?: unknown;
      input_token_details?: {
        audio_tokens?: unknown;
        text_tokens?: unknown;
      } | null;
      output_tokens?: unknown;
      total_tokens?: unknown;
      seconds?: unknown;
    } | null;
  };
  const usage = response.usage;
  if (!usage || typeof usage !== "object") return null;

  if (usage.type === "duration") {
    const audioSeconds = nonNegativeNumber(usage.seconds);
    if (audioSeconds === null) return null;
    return {
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
      audioSeconds,
    };
  }

  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const totalTokens = nonNegativeInteger(usage.total_tokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null;
  }
  return {
    usageType: "tokens",
    responseId: null,
    model: null,
    serviceTier: null,
    inputTokens,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    audioInputTokens:
      nonNegativeInteger(usage.input_token_details?.audio_tokens) ?? 0,
    textInputTokens:
      nonNegativeInteger(usage.input_token_details?.text_tokens) ?? 0,
    outputTokens,
    reasoningTokens: 0,
    totalTokens,
    audioSeconds: null,
  };
}

export function parseAiSdkUsage(
  usage: AiSdkUsage,
  response: AiSdkResponse,
): AiRequestUsage | null {
  const inputTokens = nonNegativeInteger(usage.inputTokens);
  const outputTokens = nonNegativeInteger(usage.outputTokens);
  const totalTokens = nonNegativeInteger(usage.totalTokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null;
  }

  const bodyUsage = parseOpenAIResponseUsage(response.body);
  return {
    usageType: "tokens",
    responseId:
      optionalString(response.id) ||
      optionalString(response.headers?.["x-request-id"]),
    model: optionalString(response.modelId),
    serviceTier: bodyUsage?.serviceTier ?? null,
    inputTokens,
    cachedInputTokens:
      nonNegativeInteger(usage.inputTokenDetails?.cacheReadTokens) ?? 0,
    cacheWriteTokens:
      nonNegativeInteger(usage.inputTokenDetails?.cacheWriteTokens) ?? 0,
    audioInputTokens: 0,
    textInputTokens: 0,
    outputTokens,
    reasoningTokens:
      nonNegativeInteger(usage.outputTokenDetails?.reasoningTokens) ?? 0,
    totalTokens,
    audioSeconds: null,
  };
}

export async function recordAiRequestUsage({
  feature,
  fallbackModel,
  requestedBy,
  usage,
  applicationId = null,
  portalFileId = null,
  responseId = null,
  metadata = {},
}: RecordAiRequestUsageInput) {
  if (!usage) {
    console.warn("AI response did not include usable usage data", { feature });
    return;
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("ai_request_usage").insert({
      feature,
      provider: "openai",
      response_id: usage.responseId || responseId,
      application_id: applicationId,
      portal_file_id: portalFileId,
      requested_by: requestedBy,
      model: usage.model || fallbackModel,
      service_tier: usage.serviceTier,
      usage_type: usage.usageType,
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      cache_write_tokens: usage.cacheWriteTokens,
      audio_input_tokens: usage.audioInputTokens,
      text_input_tokens: usage.textInputTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: usage.reasoningTokens,
      total_tokens: usage.totalTokens,
      audio_seconds: usage.audioSeconds,
      metadata,
    });
    if (error) {
      console.error("AI request usage could not be saved", {
        code: error.code,
        feature,
        message: error.message,
      });
    }
  } catch (error) {
    console.error("AI request usage could not be saved", {
      feature,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

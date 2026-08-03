import { NextResponse } from "next/server";

import { extractOpenAIText } from "@/lib/adjudication";
import { consumeApiQuota } from "@/lib/api-quota";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const TRANSCRIPTION_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_PHONETIC_MODEL = "gpt-4.1-mini";
const PHONETIC_OUTPUT_TOKEN_LIMIT = 400;

function cleanSingleLine(value: unknown) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as {
    error?: { message?: string } | string;
    message?: string;
  };
  if (typeof candidate.error === "string" && candidate.error.trim()) {
    return candidate.error.trim();
  }
  if (candidate.error && typeof candidate.error === "object") {
    if (candidate.error.message?.trim()) return candidate.error.message.trim();
  }
  if (candidate.message?.trim()) return candidate.message.trim();
  return fallback;
}

async function requestPhoneticSuggestion(
  apiKey: string,
  model: string,
  prompt: string,
) {
  try {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        input: prompt,
        max_output_tokens: PHONETIC_OUTPUT_TOKEN_LIMIT,
      }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    const phoneticSpelling = cleanSingleLine(
      extractOpenAIText(payload),
    ).slice(0, 160);

    return {
      error: response.ok
        ? ""
        : errorMessage(
            payload,
            `The phonetic service returned ${response.status}.`,
          ),
      phoneticSpelling,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The phonetic service could not be reached.",
      phoneticSpelling: "",
    };
  }
}

export async function POST(request: Request) {
  await requireProfile(["applicant"]);

  const supabase = await createClient();
  try {
    if (!(await consumeApiQuota(supabase, "pronunciation_phonetic", 20))) {
      return NextResponse.json(
        { error: "Pronunciation analysis limit reached. Try again in about an hour." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
  } catch (error) {
    console.error("Pronunciation quota check failed", error);
    return NextResponse.json(
      { error: "Automatic phonetic spelling is temporarily unavailable." },
      { status: 503 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Automatic phonetic spelling is not configured. Enter the phonetic spelling manually.",
      },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  const personName = cleanSingleLine(formData.get("person_name"));

  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json(
      { error: "A pronunciation recording is required." },
      { status: 400 },
    );
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "The pronunciation recording is too large." },
      { status: 413 },
    );
  }

  if (
    audio.type &&
    !audio.type.startsWith("audio/") &&
    !audio.type.startsWith("video/")
  ) {
    return NextResponse.json(
      { error: "The selected recording is not a supported audio file." },
      { status: 415 },
    );
  }

  const transcriptionBody = new FormData();
  transcriptionBody.set("file", audio, audio.name || "pronunciation.webm");
  transcriptionBody.set(
    "model",
    process.env.OPENAI_TRANSCRIBE_MODEL?.trim() ||
      "gpt-4o-mini-transcribe",
  );
  transcriptionBody.set("response_format", "json");
  transcriptionBody.set(
    "prompt",
    "The speaker is clearly stating a person's name for pronunciation. Transcribe only the spoken name or syllables, without commentary.",
  );

  const transcriptionResponse = await fetch(TRANSCRIPTION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: transcriptionBody,
    cache: "no-store",
  });

  const transcriptionPayload = (await transcriptionResponse
    .json()
    .catch(() => null)) as { text?: string } | null;

  if (!transcriptionResponse.ok) {
    return NextResponse.json(
      {
        error: errorMessage(
          transcriptionPayload,
          "The recording could not be analyzed. Enter the phonetic spelling manually.",
        ),
      },
      { status: 502 },
    );
  }

  const transcript = cleanSingleLine(transcriptionPayload?.text);
  if (!transcript && !personName) {
    return NextResponse.json(
      {
        error:
          "No name could be detected in the recording. Enter the phonetic spelling manually.",
      },
      { status: 422 },
    );
  }

  // Keep this short, deterministic task independent from the adjudication
  // narrative model. Reasoning models can spend a small output allowance on
  // hidden reasoning and return no visible spelling at all.
  const configuredModel =
    process.env.OPENAI_PHONETIC_MODEL?.trim() || DEFAULT_PHONETIC_MODEL;
  const responsePrompt = [
    "Create a clear, school-program-friendly phonetic respelling of a person's name.",
    "Use ordinary English letters only, hyphens between syllables, and CAPITAL letters for the stressed syllable.",
    "Do not use IPA, slashes, parentheses, explanation, quotation marks, or more than one option.",
    "Return only the phonetic respelling.",
    `Name entered on the form: ${personName || "not provided"}`,
    `What the pronunciation recording sounded like: ${transcript || "not available"}`,
  ].join("\n");

  const modelCandidates = Array.from(
    new Set([configuredModel, DEFAULT_PHONETIC_MODEL]),
  );
  let lastError = "";

  for (const model of modelCandidates) {
    const suggestion = await requestPhoneticSuggestion(
      apiKey,
      model,
      responsePrompt,
    );
    if (suggestion.phoneticSpelling) {
      return NextResponse.json(
        {
          phoneticSpelling: suggestion.phoneticSpelling,
          transcript,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
    lastError = suggestion.error || lastError;
  }

  if (lastError) {
    console.error("Phonetic suggestion request failed:", lastError);
  } else {
    console.error("Phonetic suggestion request returned no visible text.");
  }

  return NextResponse.json(
    {
      error:
        "The automatic phonetic suggestion is temporarily unavailable.",
    },
    { status: 502 },
  );
}

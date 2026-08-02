import { NextResponse } from "next/server";

import { extractOpenAIText } from "@/lib/adjudication";
import { requireProfile } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const TRANSCRIPTION_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

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

export async function POST(request: Request) {
  await requireProfile(["applicant"]);

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

  const responseModel =
    process.env.OPENAI_PHONETIC_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5-mini";
  const responsePrompt = [
    "Create a clear, school-program-friendly phonetic respelling of a person's name.",
    "Use ordinary English letters only, hyphens between syllables, and CAPITAL letters for the stressed syllable.",
    "Do not use IPA, slashes, parentheses, explanation, quotation marks, or more than one option.",
    "Return only the phonetic respelling.",
    `Name entered on the form: ${personName || "not provided"}`,
    `What the pronunciation recording sounded like: ${transcript || "not available"}`,
  ].join("\n");

  const response = await fetch(RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: responseModel,
      input: responsePrompt,
      max_output_tokens: 80,
    }),
    cache: "no-store",
  });

  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      {
        error: errorMessage(
          responsePayload,
          "A phonetic suggestion could not be generated. Enter it manually.",
        ),
      },
      { status: 502 },
    );
  }

  const phoneticSpelling = cleanSingleLine(
    extractOpenAIText(responsePayload),
  ).slice(0, 160);

  if (!phoneticSpelling) {
    return NextResponse.json(
      {
        error:
          "A phonetic suggestion could not be generated. Enter it manually.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      phoneticSpelling,
      transcript,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

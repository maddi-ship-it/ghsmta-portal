import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: { message?: string } }).error;
  return error?.message?.trim() || fallback;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "Voice dictation is not configured." }, { status: 503 });

  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "Record or choose an audio clip." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio must be 25 MB or smaller." }, { status: 413 });
  }
  if (audio.type && !audio.type.startsWith("audio/") && !audio.type.startsWith("video/")) {
    return NextResponse.json({ error: "Choose a supported audio recording." }, { status: 415 });
  }

  const body = new FormData();
  body.set("file", audio, audio.name || "dictation.webm");
  body.set("model", process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe");
  body.set("response_format", "json");
  body.set("prompt", "Transcribe the speaker's notes accurately. Preserve sentences, names, punctuation, and paragraph breaks. Return only the transcript.");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { text?: string } | null;
  if (!response.ok) {
    return NextResponse.json({ error: apiError(payload, "The recording could not be transcribed.") }, { status: 502 });
  }
  const transcript = String(payload?.text ?? "").trim();
  if (!transcript) return NextResponse.json({ error: "No speech was detected." }, { status: 422 });
  return NextResponse.json({ text: transcript }, { headers: { "Cache-Control": "no-store" } });
}

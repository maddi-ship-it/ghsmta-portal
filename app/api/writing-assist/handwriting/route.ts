import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { extractOpenAIText } from "@/lib/adjudication";
import { consumeApiQuota } from "@/lib/api-quota";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

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

  try {
    if (!(await consumeApiQuota(supabase, "writing_handwriting", 10))) {
      return NextResponse.json(
        { error: "Handwritten-note scan limit reached. Try again in about an hour." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
  } catch (error) {
    console.error("Handwriting quota check failed", error);
    return NextResponse.json({ error: "Handwritten-note scanning is temporarily unavailable." }, { status: 503 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "Handwritten-note scanning is not configured." }, { status: 503 });

  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Take or choose a photo of the notes." }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "The note image must be 15 MB or smaller." }, { status: 413 });
  }
  if (!image.type.startsWith("image/")) {
    return NextResponse.json({ error: "Choose an image of the handwritten notes." }, { status: 415 });
  }

  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_HANDWRITING_MODEL?.trim() || "gpt-5.6-sol",
      store: false,
      safety_identifier: createHash("sha256").update(user.id).digest("hex").slice(0, 64),
      max_output_tokens: 3000,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Transcribe the handwritten notes exactly enough for the author to review and edit. Preserve headings, bullets, line breaks, names, and punctuation. Do not summarize or add commentary. Mark genuinely unreadable text as [unclear]. Return only the transcription.",
            },
            {
              type: "input_image",
              image_url: `data:${image.type};base64,${base64}`,
              detail: "high",
            },
          ],
        },
      ],
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json({ error: apiError(payload, "The handwritten notes could not be scanned.") }, { status: 502 });
  }
  const transcription = extractOpenAIText(payload).trim();
  if (!transcription) return NextResponse.json({ error: "No readable handwriting was found." }, { status: 422 });
  return NextResponse.json({ text: transcription }, { headers: { "Cache-Control": "no-store" } });
}

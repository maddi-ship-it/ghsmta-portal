import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { extractOpenAIText } from "@/lib/adjudication";
import {
  DEFAULT_OPENAI_TEXT_MODEL,
  OPENAI_REASONING_EFFORT,
} from "@/lib/openai-model";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

function isHeicImage(image: File) {
  const mimeType = image.type.toLowerCase();
  const fileName = image.name.toLowerCase();
  return HEIC_MIME_TYPES.has(mimeType) || /\.(heic|heif)$/.test(fileName);
}

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
  if (!apiKey) return NextResponse.json({ error: "Handwritten-note scanning is not configured." }, { status: 503 });

  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Take or choose a photo of the notes." }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "The note image must be 15 MB or smaller." }, { status: 413 });
  }
  const heicImage = isHeicImage(image);
  if (!image.type.startsWith("image/") && !heicImage) {
    return NextResponse.json({ error: "Choose an image of the handwritten notes." }, { status: 415 });
  }

  let imageBytes = Buffer.from(await image.arrayBuffer());
  let imageMimeType = image.type || "image/jpeg";

  if (heicImage) {
    try {
      imageBytes = await sharp(imageBytes)
        .rotate()
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      imageMimeType = "image/jpeg";
    } catch (error) {
      console.error("HEIC handwriting conversion failed", error);
      return NextResponse.json(
        { error: "This HEIC image could not be prepared for scanning. Try taking a new photo or choosing a different image." },
        { status: 422 },
      );
    }
  }

  const base64 = imageBytes.toString("base64");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_TEXT_MODEL,
      store: false,
      safety_identifier: createHash("sha256").update(user.id).digest("hex").slice(0, 64),
      max_output_tokens: 6000,
      reasoning: { effort: OPENAI_REASONING_EFFORT.handwriting },
      text: {
        format: { type: "text" },
        verbosity: "low",
      },
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
              image_url: `data:${imageMimeType};base64,${base64}`,
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

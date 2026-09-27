import { createHash, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

function isAuthorized(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supplied = request.headers.get("x-internal-signature") ?? "";
  if (!serviceRoleKey || !/^[a-f0-9]{64}$/.test(supplied)) return false;

  const expected = createHash("sha256")
    .update(`${serviceRoleKey}:regenerate-demo-comments:2026-09-27`)
    .digest("hex");
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    model?: unknown;
    input?: unknown;
    text?: unknown;
    reasoning?: unknown;
  };
  if (
    typeof body.model !== "string" ||
    !body.model.startsWith("gpt-") ||
    !Array.isArray(body.input) ||
    body.input.length !== 2
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: body.model,
      store: false,
      input: body.input,
      text: body.text,
      reasoning: body.reasoning,
    }),
  });
  const payload = await response.json();

  return NextResponse.json(payload, {
    status: response.status,
    headers: {
      "X-Request-Id": response.headers.get("x-request-id") ?? "",
      "Cache-Control": "no-store",
    },
  });
}

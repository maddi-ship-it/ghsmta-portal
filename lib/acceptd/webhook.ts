import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function signatureBytes(value: string): Buffer | null {
  const normalized = value
    .trim()
    .replace(/^(?:sha256|hmac-sha256)[= ]/i, "");
  if (/^[0-9a-f]{64}$/i.test(normalized)) return Buffer.from(normalized, "hex");
  try {
    const decoded = Buffer.from(normalized, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

export function verifyAcceptdWebhookSignature(rawBody: string, signature: string, secret: string) {
  if (!rawBody || !signature || !secret) return false;
  const received = signatureBytes(signature);
  if (!received) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function acceptdWebhookDeliveryKey(rawBody: string, signature: string) {
  return createHash("sha256").update(signature).update("\0").update(rawBody).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numericId(...values: unknown[]) {
  for (const value of values) {
    const candidate = record(value)?.id ?? value;
    const parsed = Number(String(candidate ?? ""));
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function acceptdWebhookMetadata(payload: Record<string, unknown>) {
  const data = record(payload.data);
  const application = record(payload.application) ?? record(data?.application);
  const program = record(payload.program) ?? record(data?.program);
  const dataType = typeof data?.type === "string" ? data.type.toLowerCase() : "";
  return {
    eventType:
      (typeof payload.event === "string" && payload.event) ||
      (typeof payload.type === "string" && payload.type) ||
      (typeof data?.type === "string" && data.type) ||
      null,
    applicationId: numericId(
      payload.application_id,
      data?.application_id,
      application,
      dataType.includes("application") ? data?.id : null,
    ),
    programId: numericId(payload.program_id, data?.program_id, program),
  };
}

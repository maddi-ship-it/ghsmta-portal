import { after } from "next/server";

import { syncAcceptdApplicationById, syncAllEnabledAcceptdPrograms } from "@/lib/acceptd/sync";
import {
  acceptdWebhookDeliveryKey,
  acceptdWebhookMetadata,
  verifyAcceptdWebhookSignature,
} from "@/lib/acceptd/webhook";
import { logEvent } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const secret = process.env.ACCEPTD_WEBHOOK_SECRET?.trim();
  const signatureHeaderName = process.env.ACCEPTD_WEBHOOK_SIGNATURE_HEADER?.trim();
  if (!secret || !signatureHeaderName) {
    logEvent("error", "acceptd.webhook.misconfigured");
    return Response.json({ error: "Acceptd webhook verification is not configured." }, { status: 503 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  const signature = request.headers.get(signatureHeaderName) ?? "";
  if (!verifyAcceptdWebhookSignature(rawBody, signature, secret)) {
    logEvent("warn", "acceptd.webhook.invalid_signature");
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Webhook payload must be a JSON object." }, { status: 400 });
  }
  const metadata = acceptdWebhookMetadata(payload);
  const deliveryKey = acceptdWebhookDeliveryKey(rawBody, signature);
  const admin = createAdminClient();
  const { data: delivery, error } = await admin
    .from("acceptd_webhook_deliveries")
    .insert({
      delivery_key: deliveryKey,
      event_type: metadata.eventType,
      acceptd_application_id: metadata.applicationId,
      acceptd_program_id: metadata.programId,
      signature_header: signatureHeaderName.toLowerCase(),
      payload,
      status: "received",
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return Response.json({ accepted: true, duplicate: true });
    }
    logEvent("error", "acceptd.webhook.persist_failed", { message: error.message });
    return Response.json({ error: "Could not accept the webhook." }, { status: 503 });
  }
  if (!delivery) return Response.json({ error: "Could not accept the webhook." }, { status: 503 });

  after(async () => {
    const backgroundAdmin = createAdminClient();
    try {
      await backgroundAdmin
        .from("acceptd_webhook_deliveries")
        .update({ status: "processing", processing_attempts: 1 })
        .eq("id", delivery.id);
      const result = metadata.applicationId
        ? await syncAcceptdApplicationById(metadata.applicationId, metadata.programId)
        : await syncAllEnabledAcceptdPrograms("webhook");
      await backgroundAdmin
        .from("acceptd_webhook_deliveries")
        .update({
          status: result === null ? "ignored" : "processed",
          processed_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", delivery.id);
      logEvent("info", "acceptd.webhook.processed", {
        delivery_id: delivery.id,
        event_type: metadata.eventType,
        application_id: metadata.applicationId,
      });
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "Acceptd sync failed.";
      await backgroundAdmin
        .from("acceptd_webhook_deliveries")
        .update({ status: "failed", error: message.slice(0, 2_000) })
        .eq("id", delivery.id);
      logEvent("error", "acceptd.webhook.processing_failed", {
        delivery_id: delivery.id,
        message,
      });
    }
  });

  return Response.json({ accepted: true }, { status: 202 });
}

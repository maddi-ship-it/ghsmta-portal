import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  acceptdWebhookDeliveryKey,
  acceptdWebhookMetadata,
  verifyAcceptdWebhookSignature,
} from "./webhook";

describe("Acceptd webhook security", () => {
  it("accepts hex, sha256-prefixed hex, and base64 HMAC-SHA256 signatures", () => {
    const body = '{"event":"application.updated","application_id":42}';
    const digest = createHmac("sha256", "secret").update(body).digest();
    expect(verifyAcceptdWebhookSignature(body, digest.toString("hex"), "secret")).toBe(true);
    expect(verifyAcceptdWebhookSignature(body, `sha256=${digest.toString("hex")}`, "secret")).toBe(true);
    expect(verifyAcceptdWebhookSignature(body, `HMAC-SHA256 ${digest.toString("hex")}`, "secret")).toBe(true);
    expect(verifyAcceptdWebhookSignature(body, digest.toString("base64"), "secret")).toBe(true);
    expect(verifyAcceptdWebhookSignature(`${body} `, digest.toString("hex"), "secret")).toBe(false);
  });

  it("extracts common event, application, and program payload shapes", () => {
    expect(
      acceptdWebhookMetadata({
        type: "application.submitted",
        data: { application: { id: "42" }, program_id: 175284 },
      }),
    ).toEqual({ eventType: "application.submitted", applicationId: 42, programId: 175284 });
  });

  it("builds a stable delivery key without retaining the secret", () => {
    expect(acceptdWebhookDeliveryKey("body", "signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(acceptdWebhookDeliveryKey("body", "signature")).toBe(
      acceptdWebhookDeliveryKey("body", "signature"),
    );
  });
});

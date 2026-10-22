import { describe, expect, it } from "vitest";

import {
  parsePortalPageErrors,
  sanitizePortalDiagnosticText,
  sanitizePortalPageUrl,
} from "@/lib/portal-error-diagnostics";

describe("portal error diagnostics", () => {
  it("redacts credentials and token-like values", () => {
    const value = sanitizePortalDiagnosticText(
      "Failed https://portal.test/path?access_token=secret-value with Bearer private-token and aaaabbbbccccddddeeee.ffffgggghhhhiiiijjjj.kkkkllllmmmmnnnnoooo",
    );

    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("private-token");
    expect(value).not.toContain("aaaabbbb");
    expect(value).toContain("access_token=[redacted]");
    expect(value).toContain("Bearer [redacted]");
    expect(value).toContain("[redacted-token]");
  });

  it("redacts sensitive URL parameters while retaining reproduction context", () => {
    const value = sanitizePortalPageUrl(
      "https://portal.test/portal/adjudication/example?error=required&missing=13&code=private-code#notes",
    );

    expect(value).toContain("error=required");
    expect(value).toContain("missing=13");
    expect(value).toContain("code=%5Bredacted%5D");
    expect(value).not.toContain("private-code");
    expect(value).not.toContain("#notes");
  });

  it("accepts only bounded, recognized error records", () => {
    const errors = parsePortalPageErrors([
      {
        kind: "runtime",
        message: "Unable to save the scorecard.",
        source: "https://portal.test/app.js?token=do-not-store",
        pagePath: "/portal/adjudication/example?error=1",
        line: 42,
        occurredAt: "2026-10-21T18:00:00.000Z",
      },
      { kind: "unknown", message: "Do not keep this." },
      { kind: "visible", message: "" },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: "runtime",
      message: "Unable to save the scorecard.",
      source: "https://portal.test/app.js",
      pagePath: "/portal/adjudication/example",
      line: 42,
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  normalizeEmbeddedDocumentUrl,
  safeEmbeddedDocumentUrl,
} from "./embedded-document";

describe("normalizeEmbeddedDocumentUrl", () => {
  it("accepts a complete HTTPS embed URL", () => {
    expect(
      normalizeEmbeddedDocumentUrl(
        "https://docs.example.org/reimbursement/embed?view=portal&role=panel",
      ),
    ).toBe(
      "https://docs.example.org/reimbursement/embed?view=portal&role=panel",
    );
  });

  it("extracts and decodes the source from iframe code", () => {
    expect(
      normalizeEmbeddedDocumentUrl(
        '<iframe src="https://docs.example.org/embed?id=123&amp;mode=fill"></iframe>',
      ),
    ).toBe("https://docs.example.org/embed?id=123&mode=fill");
  });

  it("rejects unsafe and credential-bearing URLs", () => {
    expect(() =>
      normalizeEmbeddedDocumentUrl("javascript:location.reload()"),
    ).toThrow("HTTPS");
    expect(() =>
      normalizeEmbeddedDocumentUrl("https://user:secret@example.org/form"),
    ).toThrow("not valid");
  });
});

describe("safeEmbeddedDocumentUrl", () => {
  it("returns null for missing or invalid configuration", () => {
    expect(safeEmbeddedDocumentUrl(undefined)).toBeNull();
    expect(safeEmbeddedDocumentUrl("http://example.org/form")).toBeNull();
  });
});

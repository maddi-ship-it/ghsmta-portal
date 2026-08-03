import { describe, expect, it } from "vitest";

import { isAllowedPortalFile } from "./file-upload-policy";

describe("portal upload policy", () => {
  it("accepts a matching supported extension and MIME type", () => {
    expect(isAllowedPortalFile({ name: "notes.pdf", type: "application/pdf" })).toBe(true);
    expect(isAllowedPortalFile({ name: "recording.m4a", type: "audio/mp4" })).toBe(true);
  });

  it("allows supported extensions when the browser omits MIME metadata", () => {
    expect(isAllowedPortalFile({ name: "rubric.docx", type: "" })).toBe(true);
  });

  it("rejects executable or mismatched uploads", () => {
    expect(isAllowedPortalFile({ name: "payload.exe", type: "application/octet-stream" })).toBe(false);
    expect(isAllowedPortalFile({ name: "fake.pdf", type: "application/javascript" })).toBe(false);
  });
});

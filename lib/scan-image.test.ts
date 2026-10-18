import { describe, expect, it } from "vitest";

import {
  fitScanDimensions,
  isHeicFile,
  MAX_SCAN_DIMENSION,
  MAX_SCAN_SOURCE_BYTES,
  MAX_SCAN_UPLOAD_BYTES,
} from "./scan-image";

describe("scan image preparation", () => {
  it("recognizes HEIC and HEIF files by MIME type or extension", () => {
    expect(isHeicFile({ name: "notes", type: "image/heic" })).toBe(true);
    expect(isHeicFile({ name: "notes.HEIF", type: "application/octet-stream" })).toBe(true);
    expect(isHeicFile({ name: "notes.jpg", type: "image/jpeg" })).toBe(false);
  });

  it("keeps small images at their original dimensions", () => {
    expect(fitScanDimensions(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it("fits large images within the handwriting scan boundary", () => {
    expect(fitScanDimensions(4032, 3024)).toEqual({ width: 2400, height: 1800 });
    expect(fitScanDimensions(3024, 4032)).toEqual({ width: 1800, height: 2400 });
  });

  it("keeps the prepared upload below the hosting request limit", () => {
    expect(MAX_SCAN_DIMENSION).toBe(2400);
    expect(MAX_SCAN_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(MAX_SCAN_SOURCE_BYTES).toBe(15 * 1024 * 1024);
  });
});

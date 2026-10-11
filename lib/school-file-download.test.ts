import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachmentDisposition,
  createSchoolFileZipStream,
  parseSchoolFileIds,
  safeSchoolFileName,
  uniqueSchoolFileNames,
} from "@/lib/school-file-download";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("school file downloads", () => {
  it("accepts unique UUID file selections", () => {
    const first = "2f4f438e-14f9-4d80-a95a-3b0684de5b73";
    const second = "730eaa1e-3fc0-4fa2-a3ca-35e81262b080";

    expect(parseSchoolFileIds(JSON.stringify([first, first, second]))).toEqual([
      first,
      second,
    ]);
    expect(parseSchoolFileIds(JSON.stringify(["not-a-file-id"]))).toEqual([]);
  });

  it("sanitizes download names and makes duplicate archive names unique", () => {
    expect(safeSchoolFileName('../Poster: "Final".pdf')).toBe(
      "Poster- -Final-.pdf",
    );
    expect(
      uniqueSchoolFileNames(["Poster.pdf", "poster.pdf", "Poster.pdf"]),
    ).toEqual(["Poster.pdf", "poster (2).pdf", "Poster (3).pdf"]);
  });

  it("builds an attachment header with an encoded UTF-8 filename", () => {
    expect(attachmentDisposition("Résumé.pdf")).toContain(
      "filename*=UTF-8''R%C3%A9sum%C3%A9.pdf",
    );
  });

  it("streams multiple source files into one valid ZIP", async () => {
    const sourceFiles = new Map([
      ["https://files.test/poster", "poster contents"],
      ["https://files.test/playbill", "playbill contents"],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const contents = sourceFiles.get(url);
        return contents
          ? new Response(contents)
          : new Response("Missing", { status: 404 });
      }),
    );

    const archive = await new Response(
      createSchoolFileZipStream([
        { name: "Poster.pdf", url: "https://files.test/poster" },
        { name: "Playbill.pdf", url: "https://files.test/playbill" },
      ]),
    ).arrayBuffer();
    const files = unzipSync(new Uint8Array(archive));

    expect(strFromU8(files["Poster.pdf"])).toBe("poster contents");
    expect(strFromU8(files["Playbill.pdf"])).toBe("playbill contents");
  });
});

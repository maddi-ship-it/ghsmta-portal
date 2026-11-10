import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  createPlaybillSongListDocx,
  createPlaybillSongListPdf,
} from "./playbill-song-list-export";

const exportInput = {
  productionTitle: "Finding Neverland",
  schoolName: "Blessed Trinity Catholic High School",
  sourceFileName: "Playbill.pdf",
  songs: [
    { section: "Act I", title: "Believe", performers: "Sylvia and Ensemble" },
    { section: "Act II", title: "Finale", performers: "Company" },
  ],
};

describe("Playbill song-list exports", () => {
  it("creates a readable Word package with song names and characters", () => {
    const archive = unzipSync(createPlaybillSongListDocx(exportInput));
    const documentXml = strFromU8(archive["word/document.xml"]);

    expect(documentXml).toContain("Finding Neverland");
    expect(documentXml).toContain("Believe — Sylvia and Ensemble");
    expect(archive["[Content_Types].xml"]).toBeDefined();
  });

  it("creates a multipurpose PDF document", async () => {
    const bytes = await createPlaybillSongListPdf(exportInput);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
  });
});

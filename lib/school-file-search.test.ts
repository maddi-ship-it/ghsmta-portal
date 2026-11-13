import { describe, expect, it } from "vitest";

import {
  schoolApplicationMatchesSearch,
  schoolFileMatchesSearch,
} from "./school-file-search";

const application = {
  application_id: "application-1",
  school_name: "Rainey-McCullers School of the Arts",
  production_title: "Into the Woods",
  season_year: "2026",
  program_name: "GHSMTA",
};

const file = {
  application_id: "application-1",
  original_name: "company-bow.heic",
  generated_name: "2026-company-bow.heic",
  mime_type: "image/heic",
  document_category: "production_photos",
  created_at: "2026-11-08T19:00:00.000Z",
  display_name: "Full company curtain call",
  person_name: null,
  award_category: null,
  role_or_character: null,
  designer_name: "Alex Photographer",
  phonetic_spelling: null,
  file_notes: "Approved press image",
  production_name: "Into the Woods",
};

describe("school file search", () => {
  it("matches schools and productions with multi-word searches", () => {
    expect(schoolApplicationMatchesSearch(application, "rainey arts")).toBe(
      true,
    );
    expect(schoolApplicationMatchesSearch(application, "woods 2026")).toBe(
      true,
    );
    expect(schoolApplicationMatchesSearch(application, "blessed trinity")).toBe(
      false,
    );
  });

  it("searches file names, folders, credits, notes, and dates", () => {
    const matches = (query: string) =>
      schoolFileMatchesSearch({
        application,
        file,
        query,
        categoryLabel: "Production Photos",
      });

    expect(matches("company bow")).toBe(true);
    expect(matches("production photos")).toBe(true);
    expect(matches("rainey production photos")).toBe(true);
    expect(matches("alex photographer")).toBe(true);
    expect(matches("press image")).toBe(true);
    expect(matches("november 2026")).toBe(true);
    expect(matches("playbill")).toBe(false);
  });
});

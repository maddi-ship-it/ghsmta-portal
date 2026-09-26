import { describe, expect, it } from "vitest";

import {
  matchAdjudicationReferenceDocuments,
  type AdjudicationReferenceDocument,
} from "./adjudication-reference-documents";

function document(
  id: string,
  fileName: string,
  description: string | null = null,
): AdjudicationReferenceDocument {
  return {
    id,
    file_name: fileName,
    storage_path: `2026/${id}.pdf`,
    description,
  };
}

describe("matchAdjudicationReferenceDocuments", () => {
  it("matches the uploaded scoring guide and the handbook glossary", () => {
    const matches = matchAdjudicationReferenceDocuments([
      document("guide", "2026-2027 Adjudication Scoring Guide:Rubric:Criteria.pdf"),
      document("handbook", "2026-2027 Adjudicator Handbook FINAL.pdf"),
    ]);

    expect(matches.map((match) => match.key)).toEqual([
      "scoring-guide",
      "evaluative-glossary",
    ]);
    expect(matches[1]?.page).toBe(29);
  });

  it("prefers a dedicated glossary when one is uploaded", () => {
    const matches = matchAdjudicationReferenceDocuments([
      document("glossary", "GHSMTA Evaluation Glossary.pdf"),
      document("handbook", "2026-2027 Adjudicator Handbook FINAL.pdf"),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.document.id).toBe("glossary");
    expect(matches[0]?.page).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { answerValue, normalizeAcceptdApplication, portalQuestionType } from "./model";

describe("Acceptd application normalization", () => {
  it("extracts IDs, source question definitions, and key portal metadata", () => {
    const normalized = normalizeAcceptdApplication({
      id: 44,
      user: 55,
      program: 66,
      current_stage: 77,
      first_name: "Ada",
      last_name: "Lovelace",
      started: "2026-08-04T10:00:00Z",
      answers: [
        {
          id: 1,
          value: "ada@example.com",
          relationships: {
            question: { data: { id: 9, type: "email", label: "Email", category: "Applicant" } },
          },
        },
        {
          id: 2,
          value: "North High",
          relationships: {
            question: { data: { id: 82999, type: "text", label: "School Name", category: "School" } },
          },
        },
      ],
    });

    expect(normalized).toMatchObject({
      id: 44,
      userId: 55,
      programId: 66,
      stageId: 77,
      email: "ada@example.com",
      schoolName: "North High",
    });
    expect(normalized.answers[0].question.category).toBe("Applicant");
  });

  it("preserves attachment metadata with the answer", () => {
    expect(
      answerValue({
        id: 1,
        value: "Headshot",
        question: { id: 2, type: "image", label: "Photo", description: null, category: "Media", archived: false },
        attachment: { id: 3, name: "photo.jpg", url: "https://files.example/photo.jpg", type: "image/jpeg" },
      }),
    ).toEqual({
      answer: "Headshot",
      attachment: {
        id: 3,
        name: "photo.jpg",
        url: "https://files.example/photo.jpg",
        type: "image/jpeg",
        description: null,
      },
    });
  });

  it("maps Acceptd field types onto portal-compatible read-only types", () => {
    expect(portalQuestionType("yesno")).toBe("yes_no");
    expect(portalQuestionType("upload")).toBe("short_text");
    expect(portalQuestionType("textarea")).toBe("long_text");
  });
});

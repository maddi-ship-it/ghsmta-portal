import { describe, expect, it } from "vitest";

import { resolveScoringCategorySubjects } from "./application-scoring-subjects";

describe("application scoring subjects", () => {
  it("formats individual performing categories as name, pronouns, and role", () => {
    const subjects = resolveScoringCategorySubjects({
      application: {
        form_data: {
          leading_actress_name: "Jordan Smith",
          leading_actress_pronouns: "She/Her",
          leading_actress_role: "Fantine",
          supporting_performer_a_name: "Avery Jones",
          supporting_performer_a_pronouns: "They/Them",
          supporting_performer_a_role: "Thenardier",
          featured_performer_name: "Morgan Lee",
          featured_performer_pronouns: "He/Him",
          featured_performer_role: "Gavroche",
        },
        archived_payload: {},
      },
      questions: [],
      answers: [],
    });

    expect(subjects.leading_actress).toBe(
      "Jordan Smith | She/Her | Fantine",
    );
    expect(subjects.supporting_performer_a).toBe(
      "Avery Jones | They/Them | Thenardier",
    );
    expect(subjects.featured_performer).toBe(
      "Morgan Lee | He/Him | Gavroche",
    );
  });

  it("keeps the student name when an application has no role value", () => {
    const subjects = resolveScoringCategorySubjects({
      application: {
        form_data: { leading_actor_name: "Taylor Green" },
        archived_payload: {},
      },
      questions: [],
      answers: [],
    });

    expect(subjects.leading_actor).toBe(
      "Taylor Green | Not provided | Not provided",
    );
  });

  it("matches imported Acceptd question keys for the candidate fields", () => {
    const subjects = resolveScoringCategorySubjects({
      application: { form_data: {}, archived_payload: {} },
      questions: [
        {
          id: "name-question",
          question_key: "acceptd_c347_leading_actress_name",
          label: "Leading Actress Name",
          source_label: null,
        },
        {
          id: "pronouns-question",
          question_key: "acceptd_c351_leading_actress_pronouns",
          label: "Leading Actress Pronouns",
          source_label: null,
        },
        {
          id: "role-question",
          question_key: "acceptd_c352_leading_actress_role",
          label: "Leading Actress Role",
          source_label: null,
        },
      ] as never,
      answers: [
        { question_id: "name-question", value: "Mia DeMartino" },
        { question_id: "pronouns-question", value: "She/Her" },
        { question_id: "role-question", value: "Eurydice" },
      ] as never,
    });

    expect(subjects.leading_actress).toBe(
      "Mia DeMartino | She/Her | Eurydice",
    );
  });
});

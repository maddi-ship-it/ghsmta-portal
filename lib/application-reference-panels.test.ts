import { describe, expect, it } from "vitest";

import {
  buildApplicationCategoryEligibilityDefaults,
  buildApplicationReferencePanels,
  formatApplicationReferenceValue,
} from "./application-reference-panels";
import type {
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
} from "./types";

function question(
  id: string,
  label: string,
  sortOrder: number,
  overrides: Partial<ApplicationQuestion> = {},
): ApplicationQuestion {
  return {
    id,
    form_version_id: "form-version",
    section_id: "section",
    question_key: id,
    label,
    description: null,
    question_type: "short_text",
    required: false,
    options: [],
    settings: {},
    visibility_rule: null,
    sort_order: sortOrder,
    active: true,
    source_column_index: null,
    source_label: label,
    imported: false,
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    ...overrides,
  };
}

function answer(questionId: string, value: unknown): ApplicationAnswer {
  return {
    id: `answer-${questionId}`,
    application_id: "application",
    question_id: questionId,
    value,
    updated_at: "2026-10-09T00:00:00Z",
  };
}

const application = {
  source_system: "acceptd-api-v2",
  form_data: {
    acceptd: {
      application_id: 2346317,
      last_synced_at: "2026-10-09T00:00:00Z",
    },
  },
  archived_payload: {},
} as Pick<
  Application,
  "form_data" | "archived_payload" | "source_system"
>;

const legacyApplication = {
  ...application,
  source_system: null,
} as Pick<
  Application,
  "form_data" | "archived_payload" | "source_system"
>;

describe("buildApplicationReferencePanels", () => {
  it("adds a full-application panel and removes portal-only questions from current Acceptd data", () => {
    const panels = buildApplicationReferencePanels({
      application,
      questions: [
        question("school-name", "School Name", 1, { active: false }),
        question("directions", "Directions", 2),
        question("optional-note", "Optional Note", 3),
        question("instructions", "Instructions", 4, {
          question_type: "content",
        }),
      ],
      answers: [
        answer("school-name", "Rainey-McCullers School of the Arts"),
        answer("directions", "Use the stage entrance"),
      ],
    });

    expect(panels[0]?.key).toBe("full-application");
    expect(panels[0]?.shortTitle).toBe("FULL APPLICATION");
    expect(panels[0]?.groups[0]?.items).toEqual([
      {
        label: "School Name",
        value: "Rainey-McCullers School of the Arts",
      },
    ]);
    expect(panels[0]?.groups[0]?.items).not.toContainEqual(
      expect.objectContaining({ label: "Application Id" }),
    );
    expect(panels.map((panel) => panel.key)).toEqual([
      "full-application",
      "eligibility",
    ]);
  });

  it("keeps every eligibility response and renders 1/0 as True/False", () => {
    const panels = buildApplicationReferencePanels({
      application: legacyApplication,
      questions: [
        question("direction", "Direction - Award Eligible", 1, {
          question_type: "yes_no",
        }),
        question("choreography", "Choreography - Award Eligibility", 2, {
          question_type: "yes_no",
        }),
      ],
      answers: [answer("direction", 1), answer("choreography", 0)],
      eligibilityCategories: [
        { category_key: "direction", title: "DIRECTION" },
        { category_key: "choreography", title: "CHOREOGRAPHY" },
        { category_key: "costume_design", title: "COSTUMES" },
        { category_key: "overall_production", title: "OVERALL PRODUCTION" },
      ],
    });

    const eligibilityItems = panels.find(
      (panel) => panel.key === "eligibility",
    )?.groups[0]?.items;

    expect(eligibilityItems).toHaveLength(4);
    expect(
      eligibilityItems?.map((item) =>
        formatApplicationReferenceValue(item.label, item.value),
      ),
    ).toEqual(["True", "False", "False", "True"]);
  });

  it("provides adjudicator eligibility defaults from application data", () => {
    const defaults = buildApplicationCategoryEligibilityDefaults({
      application: legacyApplication,
      questions: [
        question("direction", "Direction - Award Eligible", 1, {
          question_type: "yes_no",
        }),
        question("choreography", "Choreography - Award Eligibility", 2, {
          question_type: "yes_no",
        }),
      ],
      answers: [answer("direction", 1), answer("choreography", 0)],
      eligibilityCategories: [
        { category_key: "direction", title: "DIRECTION" },
        { category_key: "choreography", title: "CHOREOGRAPHY" },
        { category_key: "costume_design", title: "COSTUMES" },
        { category_key: "overall_production", title: "OVERALL PRODUCTION" },
      ],
    });

    expect(defaults).toEqual({
      direction: true,
      choreography: false,
      costume_design: false,
      overall_production: true,
    });
  });

  it("calculates overall production as false at five ineligible categories", () => {
    const panels = buildApplicationReferencePanels({
      application,
      questions: [],
      answers: [],
      eligibilityCategories: [
        { category_key: "music_direction", title: "MUSIC DIRECTION" },
        { category_key: "orchestra", title: "ORCHESTRA" },
        { category_key: "ensemble", title: "ENSEMBLE" },
        { category_key: "costume_design", title: "COSTUMES" },
        { category_key: "direction", title: "DIRECTION" },
        { category_key: "overall_production", title: "OVERALL PRODUCTION" },
      ],
    });

    const eligibilityItems = panels.find(
      (panel) => panel.key === "eligibility",
    )?.groups[0]?.items;

    expect(eligibilityItems?.at(-1)).toEqual({
      label: "Overall Production - Award Eligible",
      value: "0",
    });
  });

  it("includes structured addresses and uploaded file names in the full application", () => {
    const panels = buildApplicationReferencePanels({
      application: legacyApplication,
      questions: [
        question("address", "School Address", 1, {
          question_type: "long_text",
        }),
        question("upload", "Scenic Design Upload", 2),
      ],
      answers: [
        answer("address", {
          street_address1: "123 Main Street",
          locality: "Columbus",
          administrative_area_level_1: "GA",
          postal_code: "31901",
          country: "US",
        }),
        answer("upload", {
          answer: "media",
          attachment: { name: "scenic-design.pdf" },
        }),
      ],
    });

    expect(panels[0]?.groups[0]?.items).toEqual([
      {
        label: "School Address",
        value: "123 Main Street, Columbus, GA, 31901, US",
      },
      { label: "Scenic Design Upload", value: "scenic-design.pdf" },
    ]);
  });
});

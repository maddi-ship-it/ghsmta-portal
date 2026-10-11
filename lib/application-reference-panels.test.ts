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
  it("keeps required toolbar panels and removes portal-only questions from current Acceptd data", () => {
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
      "acting-candidates",
      "musical-budget",
      "program-vision",
    ]);
    expect(
      panels.find((panel) => panel.key === "acting-candidates")?.groups,
    ).toEqual([]);
    expect(
      panels.find((panel) => panel.key === "musical-budget")?.groups,
    ).toEqual([]);
  });

  it("keeps every eligibility response and renders 1/0 as YES/NO", () => {
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
    ).toEqual(["YES", "NO", "NO", "YES"]);
  });

  it("includes populated Acceptd-imported acting and budget fields", () => {
    const panels = buildApplicationReferencePanels({
      application,
      questions: [
        question("leading-actress-name", "Leading Actress Name", 1, {
          imported: true,
        }),
        question("leading-actress-role", "Leading Actress Role", 2, {
          imported: true,
        }),
        question(
          "leading-actress-phonetic",
          "Leading Actress Phonetic Spelling",
          3,
          { imported: true },
        ),
        question("funding", "Please describe all sources of funding that apply to you:", 4, {
          imported: true,
        }),
        question("production-cost", "Total $ amount spent on production costs?", 5, {
          imported: true,
        }),
      ],
      answers: [
        answer("leading-actress-name", "Mikayla Shoemaker"),
        answer("leading-actress-role", "Witch"),
        answer("leading-actress-phonetic", "mih-KAY-luh"),
        answer("funding", "Ticket Sales"),
        answer("production-cost", 4336.25),
      ],
    });

    expect(
      panels.find((panel) => panel.key === "acting-candidates")?.groups,
    ).toEqual([
      {
        title: "Leading Actress",
        items: [
          {
            label: "Leading Actress Name",
            value: "Mikayla Shoemaker",
          },
          {
            label: "Leading Actress Role",
            value: "Witch",
          },
        ],
      },
    ]);
    expect(panels[0]?.groups[0]?.items).toContainEqual({
      label: "Leading Actress Phonetic Spelling",
      value: "mih-KAY-luh",
    });
    expect(
      panels.find((panel) => panel.key === "musical-budget")?.groups,
    ).toEqual([
      {
        title: "Funding sources",
        items: [
          {
            label: "Please describe all sources of funding that apply to you:",
            value: "Ticket Sales",
          },
        ],
      },
      {
        title: "Production expenses",
        items: [
          {
            label: "Total $ amount spent on production costs?",
            value: "4336.25",
          },
        ],
      },
    ]);
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

  it("flags submitted appeals without changing the original eligibility", () => {
    const panels = buildApplicationReferencePanels({
      application: legacyApplication,
      questions: [
        question("direction", "Direction - Award Eligible", 1, {
          question_type: "yes_no",
        }),
      ],
      answers: [answer("direction", 0)],
      eligibilityCategories: [
        { id: "direction-id", category_key: "direction", title: "DIRECTION" },
      ],
      eligibilityAppeals: [
        {
          category_id: "direction-id",
          current_eligibility: false,
          requested_eligibility: true,
          status: "submitted",
          submitted_at: "2026-10-11T16:00:00Z",
        },
      ],
    });

    const eligibilityPanel = panels.find(
      (panel) => panel.key === "eligibility",
    );

    expect(eligibilityPanel?.groups[0]).toEqual({
      title: "Eligibility appeals",
      items: [
        {
          label: "⚑ DIRECTION ELIGIBILITY APPEAL",
          value:
            "SUBMITTED — CURRENT ELIGIBILITY REMAINS IN EFFECT",
        },
      ],
    });
    expect(
      formatApplicationReferenceValue(
        eligibilityPanel?.groups[1]?.items[0]?.label ?? "",
        eligibilityPanel?.groups[1]?.items[0]?.value ?? "",
      ),
    ).toBe("NO");
  });

  it("changes eligibility after approval and retains it after denial", () => {
    const buildWithStatus = (status: "resolved" | "denied") =>
      buildApplicationReferencePanels({
        application: legacyApplication,
        questions: [
          question("direction", "Direction - Award Eligible", 1, {
            question_type: "yes_no",
          }),
        ],
        answers: [answer("direction", 0)],
        eligibilityCategories: [
          {
            id: "direction-id",
            category_key: "direction",
            title: "DIRECTION",
          },
        ],
        eligibilityAppeals: [
          {
            category_id: "direction-id",
            current_eligibility: false,
            requested_eligibility: true,
            status,
            submitted_at: "2026-10-11T16:00:00Z",
          },
        ],
      });

    const currentEligibility = (status: "resolved" | "denied") => {
      const eligibilityPanel = buildWithStatus(status).find(
        (panel) => panel.key === "eligibility",
      );
      const item = eligibilityPanel?.groups[1]?.items[0];
      return formatApplicationReferenceValue(
        item?.label ?? "",
        item?.value ?? "",
      );
    };

    expect(currentEligibility("resolved")).toBe("YES");
    expect(currentEligibility("denied")).toBe("NO");
  });

  it("keeps a prior approved eligibility when a later appeal is denied", () => {
    const panels = buildApplicationReferencePanels({
      application: legacyApplication,
      questions: [
        question("direction", "Direction - Award Eligible", 1, {
          question_type: "yes_no",
        }),
      ],
      answers: [answer("direction", 0)],
      eligibilityCategories: [
        { id: "direction-id", category_key: "direction", title: "DIRECTION" },
      ],
      eligibilityAppeals: [
        {
          category_id: "direction-id",
          current_eligibility: false,
          requested_eligibility: true,
          status: "resolved",
          submitted_at: "2026-10-10T16:00:00Z",
        },
        {
          category_id: "direction-id",
          current_eligibility: true,
          requested_eligibility: false,
          status: "denied",
          submitted_at: "2026-10-11T16:00:00Z",
        },
      ],
    });
    const eligibilityPanel = panels.find(
      (panel) => panel.key === "eligibility",
    );
    const currentEligibilityItem = eligibilityPanel?.groups
      .find((group) => group.title === "Current eligibility")
      ?.items.at(0);

    expect(eligibilityPanel?.groups[0]?.items[0]?.value).toBe(
      "DENIED — CURRENT ELIGIBILITY RETAINED",
    );
    expect(
      formatApplicationReferenceValue(
        currentEligibilityItem?.label ?? "",
        currentEligibilityItem?.value ?? "",
      ),
    ).toBe("YES");
  });

  it("recalculates overall production after an approved appeal", () => {
    const categories = [
      { id: "music-id", category_key: "music_direction", title: "MUSIC DIRECTION" },
      { id: "orchestra-id", category_key: "orchestra", title: "ORCHESTRA" },
      { id: "ensemble-id", category_key: "ensemble", title: "ENSEMBLE" },
      { id: "costume-id", category_key: "costume_design", title: "COSTUMES" },
      { id: "direction-id", category_key: "direction", title: "DIRECTION" },
      {
        id: "overall-id",
        category_key: "overall_production",
        title: "OVERALL PRODUCTION",
      },
    ];
    const panels = buildApplicationReferencePanels({
      application,
      questions: [],
      answers: [],
      eligibilityCategories: categories,
      eligibilityAppeals: [
        {
          category_id: "direction-id",
          current_eligibility: false,
          requested_eligibility: true,
          status: "resolved",
          submitted_at: "2026-10-11T16:00:00Z",
        },
      ],
    });
    const currentEligibilityItems = panels.find(
      (panel) => panel.key === "eligibility",
    )?.groups.find((group) => group.title === "Current eligibility")?.items;

    expect(currentEligibilityItems?.at(-1)).toEqual({
      label: "Overall Production - Award Eligible",
      value: "1",
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

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
  it("renders boolean application responses as TRUE or FALSE", () => {
    const panels = buildApplicationReferencePanels({
      application: legacyApplication,
      questions: [
        question("boolean-true", "Uses student performers", 1, {
          question_type: "yes_no",
        }),
        question("boolean-false", "Uses guest performers", 2, {
          question_type: "yes_no",
        }),
        question("source-boolean", "Imported boolean", 3),
      ],
      answers: [
        answer("boolean-true", 1),
        answer("boolean-false", false),
        answer("source-boolean", true),
      ],
    });

    const items = panels.find(
      (panel) => panel.key === "full-application",
    )?.groups[0]?.items;

    expect(items?.map((item) => item.value)).toEqual([
      "TRUE",
      "FALSE",
      "TRUE",
    ]);
    expect(formatApplicationReferenceValue("Imported", "false")).toBe(
      "FALSE",
    );
  });

  it("removes stored HTML tags from popup labels and values", () => {
    const panels = buildApplicationReferencePanels({
      application: legacyApplication,
      questions: [
        question(
          "question-html",
          "<p>Director's Vision</p>",
          1,
          { source_label: null },
        ),
      ],
      answers: [
        answer(
          "question-html",
          "<p>A clear, student-centered concept.</p><p>Strong storytelling.</p>",
        ),
      ],
    });

    const fullApplication = panels.find(
      (panel) => panel.key === "full-application",
    );
    const item = fullApplication?.groups
      .flatMap((group) => group.items)
      .find((candidate) => candidate.label === "Director's Vision");

    expect(item).toEqual({
      label: "Director's Vision",
      value: "A clear, student-centered concept.\nStrong storytelling.",
    });
    expect(formatApplicationReferenceValue(
      "Narrative",
      "<p>Visible copy</p>",
    )).toBe("Visible copy");
  });

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

  it.each([
    {
      name: "the newer Scenic Design field is answered",
      scenicValue: null,
      scenicDesignValue: 1,
      expectedLabel: "Scenic Design - Award Eligible",
    },
    {
      name: "the legacy Scenic field is answered",
      scenicValue: 1,
      scenicDesignValue: null,
      expectedLabel: "Scenic - Award Eligible",
    },
  ])(
    "uses the populated duplicate eligibility field when $name",
    ({ scenicValue, scenicDesignValue, expectedLabel }) => {
      const input = {
        application: legacyApplication,
        questions: [
          question("scenic", "Scenic - Award Eligible", 1, {
            question_type: "yes_no" as const,
          }),
          question("scenic-design", "Scenic Design - Award Eligible", 2, {
            question_type: "yes_no" as const,
          }),
        ],
        answers: [
          answer("scenic", scenicValue),
          answer("scenic-design", scenicDesignValue),
        ],
        eligibilityCategories: [
          { category_key: "scenic_design", title: "SCENIC" },
        ],
      };

      expect(buildApplicationCategoryEligibilityDefaults(input)).toEqual({
        scenic_design: true,
      });
      expect(
        buildApplicationReferencePanels(input).find(
          (panel) => panel.key === "eligibility",
        )?.groups[0]?.items,
      ).toEqual([{ label: expectedLabel, value: "true" }]);
    },
  );

  it("prefers the exact rubric category when duplicate fields are both answered", () => {
    const input = {
      application: legacyApplication,
      questions: [
        question("scenic", "Scenic - Award Eligible", 1, {
          question_type: "yes_no" as const,
        }),
        question("scenic-design", "Scenic Design - Award Eligible", 2, {
          question_type: "yes_no" as const,
        }),
      ],
      answers: [answer("scenic", 0), answer("scenic-design", 1)],
      eligibilityCategories: [
        { category_key: "scenic_design", title: "SCENIC" },
      ],
    };

    expect(buildApplicationCategoryEligibilityDefaults(input)).toEqual({
      scenic_design: true,
    });
  });

  it("does not borrow an answered eligibility value from a longer category name", () => {
    const defaults = buildApplicationCategoryEligibilityDefaults({
      application: legacyApplication,
      questions: [
        question("music-direction", "Music Direction - Award Eligible", 1, {
          question_type: "yes_no",
        }),
        question("direction", "Direction - Award Eligible", 2, {
          question_type: "yes_no",
        }),
      ],
      answers: [answer("music-direction", 1)],
      eligibilityCategories: [
        { category_key: "direction", title: "DIRECTION" },
        { category_key: "music_direction", title: "MUSIC DIRECTION" },
      ],
    });

    expect(defaults).toEqual({
      direction: false,
      music_direction: true,
    });
  });

  it("derives Blessed Trinity eligibility from conditional Acceptd answers", () => {
    const eligibleLabels = [
      "Music Direction",
      "Choreography",
      "Technical Execution",
      "Lighting",
      "Scenic",
      "Leading Actress",
      "Leading Actor",
      "Supporting Performer [A]",
      "Supporting Performer [B]",
      "Featured Performer",
      "Direction",
    ];
    const questions = eligibleLabels.map((label, index) =>
      question(`eligible-${index}`, `${label} - Award Eligible`, index + 1, {
        question_type: "yes_no",
      }),
    );
    questions.push(
      question(
        "accompaniment",
        "Select the option that best describes your musical accompaniment:",
        20,
      ),
      question(
        "ensemble-description",
        "Please describe your ensemble by choosing one option below.",
        21,
      ),
    );

    const defaults = buildApplicationCategoryEligibilityDefaults({
      application,
      questions,
      answers: [
        ...eligibleLabels.map((_, index) => answer(`eligible-${index}`, 1)),
        answer("accompaniment", "Recorded tracks"),
        answer(
          "ensemble-description",
          "Our ensemble exclusively features eligible 9th-12th grade performers.",
        ),
      ],
      eligibilityCategories: [
        { category_key: "music_direction", title: "MUSIC DIRECTION" },
        { category_key: "orchestra", title: "ORCHESTRA" },
        { category_key: "choreography", title: "CHOREOGRAPHY" },
        { category_key: "ensemble", title: "ENSEMBLE" },
        { category_key: "technical_execution", title: "TECHNICAL EXECUTION" },
        { category_key: "lighting_design", title: "LIGHTING DESIGN" },
        { category_key: "sound_design", title: "SOUND DESIGN" },
        { category_key: "scenic_design", title: "SCENIC" },
        { category_key: "costume_design", title: "COSTUMES" },
        { category_key: "leading_actress", title: "LEADING ACTRESS" },
        { category_key: "leading_actor", title: "LEADING ACTOR" },
        { category_key: "supporting_performer_a", title: "SUPPORTING PERFORMER A" },
        { category_key: "supporting_performer_b", title: "SUPPORTING PERFORMER B" },
        { category_key: "featured_performer", title: "FEATURED PERFORMER" },
        { category_key: "direction", title: "DIRECTION" },
        { category_key: "overall_production", title: "OVERALL PRODUCTION" },
      ],
    });

    expect(defaults).toEqual({
      music_direction: true,
      orchestra: false,
      choreography: true,
      ensemble: true,
      technical_execution: true,
      lighting_design: true,
      sound_design: false,
      scenic_design: true,
      costume_design: false,
      leading_actress: true,
      leading_actor: true,
      supporting_performer_a: true,
      supporting_performer_b: true,
      featured_performer: true,
      direction: true,
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
            "SUBMITTED — CURRENT ELIGIBILITY STATUS REMAINS IN EFFECT",
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
      "DENIED — CURRENT ELIGIBILITY STATUS REMAINS IN EFFECT",
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

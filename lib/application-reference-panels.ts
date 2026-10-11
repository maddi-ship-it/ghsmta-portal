import type {
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
} from "@/lib/types";
import { CURRENT_ACCEPTD_EXPORT_QUESTION_LABELS } from "./acceptd-current-export-question-labels";

export type ApplicationReferenceItem = {
  label: string;
  value: string;
};

export type ApplicationReferenceGroup = {
  title: string;
  items: ApplicationReferenceItem[];
};

export type ApplicationReferencePanel = {
  key: string;
  title: string;
  shortTitle: string;
  description: string;
  groups: ApplicationReferenceGroup[];
};

export type ApplicationEligibilityAppeal = {
  category_id: string | null;
  current_eligibility: boolean | null;
  requested_eligibility: boolean;
  status: string;
  submitted_at: string;
};

type ReferenceInput = {
  application: Pick<
    Application,
    "form_data" | "archived_payload" | "source_system"
  >;
  questions: ApplicationQuestion[];
  answers: ApplicationAnswer[];
  eligibilityCategories?: Array<{
    id?: string;
    category_key: string;
    title: string;
  }>;
  eligibilityAppeals?: ApplicationEligibilityAppeal[];
};

type ReferenceRow = {
  key: string;
  label: string;
  value: string;
  order: number;
  imported?: boolean;
};

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (value == null) return "";

  if (Array.isArray(value)) {
    return value
      .map(displayValue)
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return displayValue(record.value);

    const attachment =
      record.attachment &&
      typeof record.attachment === "object" &&
      !Array.isArray(record.attachment)
        ? (record.attachment as Record<string, unknown>)
        : null;
    if (attachment) {
      return displayValue(attachment.name) || displayValue(record.answer);
    }

    const addressKeys = [
      "street_address1",
      "street_address2",
      "locality",
      "administrative_area_level_1",
      "postal_code",
      "country",
    ];
    if (addressKeys.some((key) => key in record)) {
      return addressKeys
        .map((key) => displayValue(record[key]))
        .filter(Boolean)
        .join(", ");
    }

    if ("answer" in record) return displayValue(record.answer);
    return "";
  }

  return String(value).trim();
}

export function formatApplicationReferenceValue(
  label: string,
  rawValue: string,
) {
  const value = rawValue.trim();
  if (!value) return "Not provided";

  const normalizedLabel = normalize(label);
  const normalizedValue = value.toLowerCase();

  if (normalizedLabel.includes("eligib")) {
    if (["1", "true", "yes"].includes(normalizedValue)) return "YES";
    if (["0", "false", "no"].includes(normalizedValue)) return "NO";
  }

  const numeric = Number(value.replace(/[$,%\s,]/g, ""));

  if (Number.isFinite(numeric)) {
    if (
      normalizedLabel.includes("amount") ||
      normalizedLabel.includes("compensation") ||
      normalizedLabel.includes("spent") ||
      normalizedLabel.includes("budget") ||
      normalizedLabel.includes("fees")
    ) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(numeric);
    }

    if (normalizedLabel.includes("percentage")) {
      const percentage = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
      return `${percentage.toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })}%`;
    }
  }

  return value;
}

function flattenObject(
  value: unknown,
  rows: ReferenceRow[],
  inheritedKey = "",
  depth = 0,
) {
  if (value == null || depth > 8) return;

  if (Array.isArray(value)) {
    const joined = displayValue(value);
    if (inheritedKey && joined) {
      rows.push({
        key: normalize(inheritedKey),
        label: humanize(inheritedKey),
        value: joined,
        order: 100000 + rows.length,
      });
    }
    return;
  }

  if (typeof value !== "object") {
    if (!inheritedKey) return;
    rows.push({
      key: normalize(inheritedKey),
      label: humanize(inheritedKey),
      value: displayValue(value),
      order: 100000 + rows.length,
    });
    return;
  }

  const record = value as Record<string, unknown>;
  const recordLabel =
    typeof record.label === "string" ? record.label : null;

  if (recordLabel && "value" in record) {
    rows.push({
      key: normalize(inheritedKey || recordLabel),
      label: recordLabel,
      value: displayValue(record.value),
      order: 100000 + rows.length,
    });
    return;
  }

  for (const [key, nested] of Object.entries(record)) {
    flattenObject(nested, rows, key, depth + 1);
  }
}

function publicFormData(formData: Application["form_data"]) {
  if (!formData || typeof formData !== "object" || Array.isArray(formData)) {
    return formData;
  }

  return Object.fromEntries(
    Object.entries(formData).filter(([key]) => key !== "acceptd"),
  );
}

function buildRows({
  application,
  questions,
  answers,
}: ReferenceInput) {
  const answerMap = new Map(
    answers.map((answer) => [answer.question_id, answer.value]),
  );

  const rows: ReferenceRow[] = questions
    .filter((question) => question.question_type !== "content")
    .sort((a, b) => {
      const aOrder = a.source_column_index ?? a.sort_order;
      const bOrder = b.source_column_index ?? b.sort_order;
      return aOrder - bOrder;
    })
    .map((question, index) => ({
      key: normalize(
        [
          question.question_key,
          question.label,
          question.source_label,
        ]
          .filter(Boolean)
          .join(" "),
      ),
      label: question.source_label || question.label,
      value: displayValue(answerMap.get(question.id)),
      imported: question.imported,
      order:
        question.source_column_index ??
        question.sort_order ??
        index,
    }));

  const fallbackRows: ReferenceRow[] = [];
  flattenObject(publicFormData(application.form_data), fallbackRows);
  flattenObject(application.archived_payload, fallbackRows);

  const seen = new Set(
    rows.map((row) => `${normalize(row.label)}::${row.value}`),
  );

  for (const row of fallbackRows) {
    const signature = `${normalize(row.label)}::${row.value}`;
    if (!seen.has(signature)) {
      rows.push(row);
      seen.add(signature);
    }
  }

  return rows.sort((a, b) => a.order - b.order);
}

function rowMatches(row: ReferenceRow, fragments: string[]) {
  const haystack = `${row.key}_${normalize(row.label)}`;
  return fragments.some((fragment) =>
    haystack.includes(normalize(fragment)),
  );
}

function uniqueItems(rows: ReferenceRow[]) {
  const seen = new Set<string>();
  const items: ApplicationReferenceItem[] = [];

  for (const row of rows) {
    const signature = normalize(row.label);
    if (seen.has(signature)) continue;
    seen.add(signature);
    items.push({ label: row.label, value: row.value });
  }

  return items;
}

function allItems(rows: ReferenceRow[]) {
  return rows.map((row) => ({ label: row.label, value: row.value }));
}

function categoryEligibilitySelections(
  rows: ReferenceRow[],
  categories: NonNullable<ReferenceInput["eligibilityCategories"]>,
  appeals: ApplicationEligibilityAppeal[] = [],
) {
  const latestApprovedAppealByCategoryId = new Map<
    string,
    ApplicationEligibilityAppeal
  >();
  for (const appeal of [...appeals].sort((left, right) =>
    right.submitted_at.localeCompare(left.submitted_at),
  )) {
    if (
      !appeal.category_id ||
      !["approved", "resolved"].includes(appeal.status.toLowerCase()) ||
      latestApprovedAppealByCategoryId.has(appeal.category_id)
    ) {
      continue;
    }
    latestApprovedAppealByCategoryId.set(appeal.category_id, appeal);
  }

  const usedRows = new Set<ReferenceRow>();
  const categoryItems = categories.map((category) => {
    const categoryKey = normalize(category.category_key);
    const aliases = new Set([categoryKey, normalize(category.title)]);
    if (categoryKey.endsWith("_design")) {
      aliases.add(categoryKey.slice(0, -"_design".length));
    }

    const matchingRow = rows.find((row) => {
      if (usedRows.has(row)) return false;
      const haystack = `${row.key}_${normalize(row.label)}`;
      return [...aliases].some((alias) => haystack.includes(alias));
    });

    const applicationValue = matchingRow?.value ?? "0";
    const latestApprovedAppeal = category.id
      ? latestApprovedAppealByCategoryId.get(category.id)
      : undefined;
    const effectiveValue = latestApprovedAppeal
      ? latestApprovedAppeal.requested_eligibility
        ? "1"
        : "0"
      : applicationValue;

    if (matchingRow) {
      usedRows.add(matchingRow);
      return {
        categoryKey,
        label: matchingRow.label,
        value: effectiveValue,
      };
    }

    return {
      categoryKey,
      label: `${humanize(normalize(category.title))} - Award Eligible`,
      value: effectiveValue,
    };
  });

  const ineligibleCategoryCount = categoryItems.filter((item) => {
    if (item.categoryKey === "overall_production") return false;
    return !["1", "true", "yes"].includes(item.value.trim().toLowerCase());
  }).length;

  const selections = categoryItems.map(({ categoryKey, label, value }) => ({
    categoryKey,
    label,
    value:
      categoryKey === "overall_production"
        ? ineligibleCategoryCount >= 5
          ? "0"
          : "1"
        : value,
  }));

  return { selections, usedRows };
}

function categoryEligibilityItems(
  rows: ReferenceRow[],
  categories: NonNullable<ReferenceInput["eligibilityCategories"]>,
  appeals: ApplicationEligibilityAppeal[] = [],
) {
  const { selections, usedRows } = categoryEligibilitySelections(
    rows,
    categories,
    appeals,
  );

  return [
    ...selections.map(({ label, value }) => ({ label, value })),
    ...allItems(rows.filter((row) => !usedRows.has(row))),
  ];
}

function eligibilityAppealItems(
  appeals: ApplicationEligibilityAppeal[],
  categories: NonNullable<ReferenceInput["eligibilityCategories"]>,
) {
  const categoryById = new Map(
    categories.flatMap((category) =>
      category.id ? [[category.id, category] as const] : [],
    ),
  );
  const seenAppealKeys = new Set<string>();

  return [...appeals]
    .sort((left, right) =>
      right.submitted_at.localeCompare(left.submitted_at),
    )
    .flatMap((appeal) => {
      const appealKey =
        appeal.category_id ?? `unassigned:${appeal.submitted_at}`;
      if (
        seenAppealKeys.has(appealKey) ||
        ["draft", "withdrawn"].includes(appeal.status.toLowerCase())
      ) {
        return [];
      }

      const category = appeal.category_id
        ? categoryById.get(appeal.category_id)
        : undefined;
      seenAppealKeys.add(appealKey);

      const status = appeal.status.toLowerCase();
      const value = ["approved", "resolved"].includes(status)
        ? `APPROVED — ELIGIBILITY UPDATED TO ${
            appeal.requested_eligibility ? "YES" : "NO"
          }`
        : status === "denied"
          ? "DENIED — CURRENT ELIGIBILITY STATUS REMAINS IN EFFECT"
          : status === "owner_review"
            ? "UNDER OWNER REVIEW — CURRENT ELIGIBILITY STATUS REMAINS IN EFFECT"
            : status === "advisory_review"
              ? "UNDER ADVISORY REVIEW — CURRENT ELIGIBILITY STATUS REMAINS IN EFFECT"
              : "SUBMITTED — CURRENT ELIGIBILITY STATUS REMAINS IN EFFECT";

      return [
        {
          label: `⚑ ${
            category?.title ??
            (appeal.category_id
              ? "CATEGORY NOT IN CURRENT RUBRIC"
              : "CATEGORY NOT RECORDED")
          } ELIGIBILITY APPEAL`,
          value,
        },
      ];
    });
}

export function buildApplicationCategoryEligibilityDefaults(
  input: ReferenceInput,
): Record<string, boolean> {
  const categories = input.eligibilityCategories ?? [];
  if (categories.length === 0) return {};

  const eligibilityRows = buildRows(input).filter((row) =>
    `${row.key}_${normalize(row.label)}`.includes("eligib"),
  );
  const { selections } = categoryEligibilitySelections(
    eligibilityRows,
    categories,
    input.eligibilityAppeals,
  );
  const eligibilityByNormalizedKey = new Map(
    selections.map((selection) => [
      selection.categoryKey,
      ["1", "true", "yes"].includes(
        selection.value.trim().toLowerCase(),
      ),
    ]),
  );

  return Object.fromEntries(
    categories.map((category) => [
      category.category_key,
      eligibilityByNormalizedKey.get(normalize(category.category_key)) ?? false,
    ]),
  );
}

function group(
  title: string,
  rows: ReferenceRow[],
): ApplicationReferenceGroup {
  return { title, items: uniqueItems(rows) };
}

function candidateGroup(
  rows: ReferenceRow[],
  title: string,
  aliases: string[],
) {
  return group(
    title,
    rows.filter(
      (row) => rowMatches(row, aliases) && !rowMatches(row, ["phonetic"]),
    ),
  );
}

function buildSupplementalArchiveItems(
  application: Pick<Application, "archived_payload">,
): ApplicationReferenceItem[] {
  const archive = application.archived_payload?.supplemental_archive_export;
  if (!archive || typeof archive !== "object" || Array.isArray(archive)) {
    return [];
  }

  const fields = (archive as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return [];
  }

  return Object.entries(fields as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, rawField]) => {
      if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) {
        return [];
      }

      const field = rawField as Record<string, unknown>;
      const label = typeof field.label === "string" ? field.label.trim() : "";
      if (!label) return [];

      return [{ label, value: displayValue(field.value) }];
    });
}

export function buildApplicationReferencePanels(
  input: ReferenceInput,
): ApplicationReferencePanel[] {
  const rows = buildRows(input);
  const popupRows =
    input.application.source_system === "acceptd-api-v2"
      ? rows.filter((row) =>
          row.imported ||
          CURRENT_ACCEPTD_EXPORT_QUESTION_LABELS.has(normalize(row.label)),
        )
      : rows;
  const populatedPopupRows = popupRows.filter(
    (row) => row.value.trim().length > 0,
  );

  const eligibilityRows = rows.filter((row) =>
    `${row.key}_${normalize(row.label)}`.includes("eligib"),
  );
  const eligibilityItems = input.eligibilityCategories?.length
    ? categoryEligibilityItems(
        eligibilityRows,
        input.eligibilityCategories,
        input.eligibilityAppeals,
      )
    : allItems(eligibilityRows);
  const appealItems = input.eligibilityCategories?.length
    ? eligibilityAppealItems(
        input.eligibilityAppeals ?? [],
        input.eligibilityCategories,
      )
    : [];

  const actingGroups = [
    candidateGroup(populatedPopupRows, "Leading Actress", ["leading actress"]),
    candidateGroup(populatedPopupRows, "Leading Actor", ["leading actor"]),
    candidateGroup(populatedPopupRows, "Supporting Performer A", [
      "supporting performer a",
      "supporting performer 1",
    ]),
    candidateGroup(populatedPopupRows, "Supporting Performer B", [
      "supporting performer b",
      "supporting performer 2",
    ]),
    candidateGroup(populatedPopupRows, "Featured Performer", [
      "featured performer",
    ]),
  ].filter((candidate) => candidate.items.length > 0);

  const budgetFunding = populatedPopupRows.filter((row) =>
    rowMatches(row, [
      "sources of funding",
      "amount supplied",
      "amount raised",
      "fundraising",
      "sponsorship",
      "program advertisements",
      "student fees",
      "ticket sales",
      "other funding source",
    ]),
  );

  const budgetCompensation = populatedPopupRows.filter((row) =>
    rowMatches(row, ["compensation", "compensations"]),
  );

  const budgetExpenses = populatedPopupRows.filter((row) =>
    rowMatches(row, [
      "total amount spent",
      "total $ amount spent",
      "licensing fees",
      "royalty fees",
      "marketing",
      "photography",
      "videography",
    ]),
  );

  const budgetResources = populatedPopupRows.filter((row) =>
    rowMatches(row, [
      "percentage",
      "rented",
      "pre owned",
      "repurposed",
      "built new",
      "bought new",
      "already installed",
      "incorporates projections",
      "projection equipment",
      "projection design",
      "budgeted",
    ]),
  );

  const participationRows = populatedPopupRows.filter((row) =>
    rowMatches(row, [
      "total number of high school students",
      "total number of parents",
      "total number of school faculty",
      "total number of guests",
      "total number of non parent",
      "total number of k 8",
      "total number of other people",
      "total number of people involved",
      "how many years has your school produced",
      "two or more years of experience",
      "one year of experience",
      "first year in your school",
      "level of experience and maturity",
      "how many weeks did you rehearse",
    ]),
  );

  const ideaRows = populatedPopupRows.filter((row) =>
    rowMatches(row, [
      "diverse equitable inclusive accessible",
      "i.d.e.a",
      "idea initiative",
    ]),
  );

  const visionRows = populatedPopupRows.filter((row) =>
    rowMatches(row, [
      "why did you choose this musical",
      "director s vision",
      "directors vision",
      "written response",
      "challenges involved when mounting",
      "what else should we know",
      "additional comments",
      "program vision",
      "administration support",
    ]),
  );

  const panels: ApplicationReferencePanel[] = [
    {
      key: "full-application",
      title: "Full Application",
      shortTitle: "FULL APPLICATION",
      description:
        "Every application response available for this school, in the submitted form order.",
      groups: [
        {
          title: "All application responses",
          items: allItems(populatedPopupRows),
        },
      ],
    },
    {
      key: "eligibility",
      title: "Category Eligibility View",
      shortTitle: "ELIGIBILITY",
      description:
        "Current award eligibility, including any submitted appeal and final decision.",
      groups: [
        ...(appealItems.length > 0
          ? [
              {
                title: "Eligibility appeals",
                items: appealItems,
              },
            ]
          : []),
        {
          title: "Current eligibility",
          items: eligibilityItems,
        },
      ],
    },
    {
      key: "acting-candidates",
      title: "Individual Acting Category Candidates",
      shortTitle: "ACTING CANDIDATES",
      description:
        "Submitted acting candidates, roles, pronouns, and grade levels.",
      groups: actingGroups,
    },
    {
      key: "musical-budget",
      title: "Musical Budget View",
      shortTitle: "BUDGET",
      description:
        "Funding, compensation, expenses, and production-resource information supplied by the school.",
      groups: [
        group("Funding sources", budgetFunding),
        group("Compensation", budgetCompensation),
        group("Production expenses", budgetExpenses),
        group("Resource mix", budgetResources),
      ].filter((section) => section.items.length > 0),
    },
    {
      key: "program-vision",
      title: "Program Maturity, Vision, and Support",
      shortTitle: "PROGRAM MATURITY, VISION, SUPPORT VIEW",
      description:
        "Program participation, experience, I.D.E.A. work, production vision, and school context.",
      groups: [
        group("Participation and experience", participationRows),
        group("I.D.E.A. initiative", ideaRows),
        group("Vision and program context", visionRows),
      ].filter((section) => section.items.length > 0),
    },
  ];

  const supplementalArchiveItems = buildSupplementalArchiveItems(
    input.application,
  );
  if (supplementalArchiveItems.length > 0) {
    panels.push({
      key: "archive-export",
      title: "Complete Archive Export",
      shortTitle: "Archive Export",
      description:
        "Every populated field supplied in the imported Acceptd archive record, including legacy fields that are not part of the current form.",
      groups: [
        {
          title: "Imported archive fields",
          items: supplementalArchiveItems,
        },
      ],
    });
  }

  const requiredToolbarPanels = new Set([
    "full-application",
    "eligibility",
    "acting-candidates",
    "musical-budget",
    "program-vision",
  ]);

  return panels.filter(
    (panel) =>
      requiredToolbarPanels.has(panel.key) ||
      panel.groups.some((section) => section.items.length > 0),
  );
}

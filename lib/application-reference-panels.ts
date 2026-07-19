import type {
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
} from "@/lib/types";

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

type ReferenceInput = {
  application: Pick<Application, "form_data" | "archived_payload">;
  questions: ApplicationQuestion[];
  answers: ApplicationAnswer[];
};

type ReferenceRow = {
  key: string;
  label: string;
  value: string;
  order: number;
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
    return "";
  }

  return String(value).trim();
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

function buildRows({
  application,
  questions,
  answers,
}: ReferenceInput) {
  const answerMap = new Map(
    answers.map((answer) => [answer.question_id, answer.value]),
  );

  const rows: ReferenceRow[] = questions
    .filter((question) => question.active)
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
      order:
        question.source_column_index ??
        question.sort_order ??
        index,
    }));

  const fallbackRows: ReferenceRow[] = [];
  flattenObject(application.form_data, fallbackRows);
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
    rows.filter((row) => rowMatches(row, aliases)),
  );
}

export function buildApplicationReferencePanels(
  input: ReferenceInput,
): ApplicationReferencePanel[] {
  const rows = buildRows(input);

  const eligibilityRows = rows.filter((row) => {
    const normalized = `${row.key}_${normalize(row.label)}`;
    return (
      normalized.includes("award_eligible") ||
      normalized.includes("award_eligibility") ||
      normalized.includes("eligible_for_award")
    );
  });

  const actingGroups = [
    candidateGroup(rows, "Leading Actress", ["leading actress"]),
    candidateGroup(rows, "Leading Actor", ["leading actor"]),
    candidateGroup(rows, "Supporting Performer A", [
      "supporting performer a",
      "supporting performer 1",
    ]),
    candidateGroup(rows, "Supporting Performer B", [
      "supporting performer b",
      "supporting performer 2",
    ]),
    candidateGroup(rows, "Featured Performer", [
      "featured performer",
    ]),
  ].filter((candidate) => candidate.items.length > 0);

  const budgetFunding = rows.filter((row) =>
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

  const budgetCompensation = rows.filter((row) =>
    rowMatches(row, ["compensation", "compensations"]),
  );

  const budgetExpenses = rows.filter((row) =>
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

  const budgetResources = rows.filter((row) =>
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

  const participationRows = rows.filter((row) =>
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

  const ideaRows = rows.filter((row) =>
    rowMatches(row, [
      "diverse equitable inclusive accessible",
      "i.d.e.a",
      "idea initiative",
    ]),
  );

  const visionRows = rows.filter((row) =>
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

  return [
    {
      key: "eligibility",
      title: "Category Eligibility View",
      shortTitle: "Eligibility",
      description:
        "Award eligibility selections submitted by the school.",
      groups: [group("Application eligibility", eligibilityRows)],
    },
    {
      key: "acting-candidates",
      title: "Individual Acting Category Candidates",
      shortTitle: "Acting Candidates",
      description:
        "Submitted acting candidates, roles, pronouns, and grade levels.",
      groups: actingGroups,
    },
    {
      key: "musical-budget",
      title: "Musical Budget View",
      shortTitle: "Musical Budget",
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
      shortTitle: "Program & Vision",
      description:
        "Program participation, experience, I.D.E.A. work, production vision, and school context.",
      groups: [
        group("Participation and experience", participationRows),
        group("I.D.E.A. initiative", ideaRows),
        group("Vision and program context", visionRows),
      ].filter((section) => section.items.length > 0),
    },
  ];
}

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
    if (["1", "true", "yes"].includes(normalizedValue)) return "True";
    if (["0", "false", "no"].includes(normalizedValue)) return "False";
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

  const eligibilityRows = rows.filter((row) =>
    `${row.key}_${normalize(row.label)}`.includes("eligib"),
  );

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
          items: allItems(rows.filter((row) => row.value.trim().length > 0)),
        },
      ],
    },
    {
      key: "eligibility",
      title: "Category Eligibility View",
      shortTitle: "Eligibility",
      description:
        "Award eligibility selections submitted by the school.",
      groups: [
        {
          title: "Application eligibility",
          items: allItems(eligibilityRows),
        },
      ],
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

  return panels;
}

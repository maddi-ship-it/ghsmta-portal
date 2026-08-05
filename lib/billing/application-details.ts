type BillingApplicationInput = {
  id: string;
  form_version_id?: string | null;
};

type BillingQuestionRow = {
  id: string;
  form_version_id: string;
  question_key: string | null;
  label: string | null;
  source_label: string | null;
  sort_order: number | null;
};

type BillingAnswerRow = {
  application_id: string;
  question_id: string;
  value: unknown;
};

type BillingQueryResult = Promise<{
  data: unknown[] | null;
  error: { message: string } | null;
}>;

type BillingSelectQuery = {
  in: (column: string, values: string[]) => BillingQueryResult;
};

type BillingTableQuery = {
  select: (columns: string) => BillingSelectQuery;
};

export type BillingApplicationDetails = {
  schoolAddress: string | null;
  schoolPhone: string | null;
  schoolType: string | null;
  selectedTrack: string | null;
};

export const DEFAULT_INVOICE_PAYMENT_URL =
  "https://secure.qgiv.com/for/gapr2/event/shureg27/";

export const DEFAULT_INVOICE_PROMO_CODES = {
  titleOne: "SHUSUB",
  mentor: "MENTOR27",
  fullWaiver: "SHUWAIVER",
  check: "CHECK",
} as const;

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function answerToText(value: unknown): string {
  if (value == null) return "";

  if (Array.isArray(value)) {
    return value.map(answerToText).filter(Boolean).join(", ");
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return answerToText(record.value);
    if ("label" in record) return answerToText(record.label);
    return "";
  }

  return String(value).trim();
}

function addressToText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return answerToText(value);
  }
  const record = value as Record<string, unknown>;
  const street1 = answerToText(record.street_address1);
  const street2 = answerToText(record.street_address2);
  const city = answerToText(record.locality);
  const state = answerToText(record.administrative_area_level_1);
  const postalCode = answerToText(record.postal_code);
  const country = answerToText(record.country);
  const cityLine = [
    city,
    [state, postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");

  return [street1, street2, cityLine, country]
    .filter(Boolean)
    .join("\n");
}

function trackToText(value: unknown): string {
  const text = answerToText(value);
  const normalized = normalize(text);
  if (!text) return "";
  if (normalized.includes("mentorship") || normalized.includes("mentor")) {
    return "Mentorship Track";
  }
  if (normalized.includes("competition")) {
    return "Competition Track";
  }
  const [shortLabel] = text.split(/\s[-–—]\s|-/);
  return (shortLabel || text).trim();
}

function questionHaystack(question: BillingQuestionRow) {
  return normalize(
    [
      question.question_key,
      question.label,
      question.source_label,
    ].filter(Boolean).join(" "),
  );
}

function findAnswer(
  questions: BillingQuestionRow[],
  answerByQuestionId: Map<string, unknown>,
  fragments: string[],
  formatter: (value: unknown) => string = answerToText,
) {
  const normalizedFragments = fragments.map(normalize);
  for (const question of questions) {
    const haystack = questionHaystack(question);
    if (!normalizedFragments.some((fragment) => haystack.includes(fragment))) {
      continue;
    }
    const value = formatter(answerByQuestionId.get(question.id));
    if (value) return value;
  }
  return null;
}

export function buildBillingApplicationDetails(
  questions: BillingQuestionRow[],
  answers: BillingAnswerRow[],
): BillingApplicationDetails {
  const sortedQuestions = [...questions].sort(
    (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
  );
  const answerByQuestionId = new Map(
    answers.map((answer) => [answer.question_id, answer.value]),
  );

  return {
    schoolAddress: findAnswer(
      sortedQuestions,
      answerByQuestionId,
      ["please provide the address below", "school address", "mailing address"],
      addressToText,
    ),
    schoolPhone: findAnswer(
      sortedQuestions,
      answerByQuestionId,
      ["school phone number extension", "school phone", "main phone"],
    ),
    schoolType: findAnswer(
      sortedQuestions,
      answerByQuestionId,
      ["school type", "school_type"],
    ),
    selectedTrack: findAnswer(
      sortedQuestions,
      answerByQuestionId,
      [
        "which track are you registering",
        "track are you registering",
        "program you are registering",
        "select the program",
      ],
      trackToText,
    ),
  };
}

export async function loadBillingApplicationDetails(
  supabase: {
    // Supabase's generated query-builder types become extremely deep when this
    // shared helper is used from server actions and route handlers. Keep this
    // boundary intentionally small and validate the returned rows below.
    from: (table: string) => unknown;
  },
  applications: BillingApplicationInput[],
) {
  const formVersionIds = [
    ...new Set(
      applications
        .map((application) => application.form_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (applications.length === 0 || formVersionIds.length === 0) {
    return new Map<string, BillingApplicationDetails>();
  }

  const [questionResult, answerResult] = await Promise.all([
    (supabase.from("application_questions") as BillingTableQuery)
      .select("id,form_version_id,question_key,label,source_label,sort_order")
      .in("form_version_id", formVersionIds),
    (supabase.from("application_answers") as BillingTableQuery)
      .select("application_id,question_id,value")
      .in("application_id", applications.map((application) => application.id)),
  ]);
  if (questionResult.error) throw new Error(questionResult.error.message);
  if (answerResult.error) throw new Error(answerResult.error.message);

  const questionsByFormVersion = new Map<string, BillingQuestionRow[]>();
  for (const question of (questionResult.data ?? []) as BillingQuestionRow[]) {
    const list = questionsByFormVersion.get(question.form_version_id) ?? [];
    list.push(question);
    questionsByFormVersion.set(question.form_version_id, list);
  }

  const answersByApplication = new Map<string, BillingAnswerRow[]>();
  for (const answer of (answerResult.data ?? []) as BillingAnswerRow[]) {
    const list = answersByApplication.get(answer.application_id) ?? [];
    list.push(answer);
    answersByApplication.set(answer.application_id, list);
  }

  const detailsByApplication = new Map<string, BillingApplicationDetails>();
  for (const application of applications) {
    const questions = application.form_version_id
      ? questionsByFormVersion.get(application.form_version_id) ?? []
      : [];
    const answers = answersByApplication.get(application.id) ?? [];
    detailsByApplication.set(
      application.id,
      buildBillingApplicationDetails(questions, answers),
    );
  }
  return detailsByApplication;
}

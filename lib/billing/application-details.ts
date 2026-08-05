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
  id?: string;
  application_id: string;
  question_id: string;
  value: unknown;
};

type BillingQueryResult = Promise<{
  data: unknown[] | null;
  error: { message: string } | null;
}>;

type BillingFilteredQuery = BillingQueryResult & {
  in: (column: string, values: string[]) => BillingFilteredQuery;
  order: (
    column: string,
    options?: { ascending?: boolean },
  ) => BillingFilteredQuery;
  range: (from: number, to: number) => BillingFilteredQuery;
};

type BillingTableQuery = {
  select: (columns: string) => BillingFilteredQuery;
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

const BILLING_QUERY_PAGE_SIZE = 900;

const PROGRAM_QUESTION_FRAGMENTS = [
  "acceptd_q_163198",
  "please select the program you are registering for the 2026 2027 ghsmta season",
  "program you are registering for the 2026 2027 ghsmta season",
  "select the program",
];

const LEGACY_TRACK_FRAGMENTS = [
  "which track are you registering",
  "track are you registering",
];

const SCHOOL_ADDRESS_FRAGMENTS = [
  "please provide the address below",
  "school address",
  "mailing address",
];

const SCHOOL_PHONE_FRAGMENTS = [
  "school phone number extension",
  "school phone",
  "main phone",
];

const SCHOOL_TYPE_FRAGMENTS = [
  "acceptd_q_137656",
  "school type",
  "school_type",
];

const BILLING_DETAIL_FRAGMENTS = [
  ...PROGRAM_QUESTION_FRAGMENTS,
  ...LEGACY_TRACK_FRAGMENTS,
  ...SCHOOL_ADDRESS_FRAGMENTS,
  ...SCHOOL_PHONE_FRAGMENTS,
  ...SCHOOL_TYPE_FRAGMENTS,
];

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

function questionMatchesFragments(
  question: BillingQuestionRow,
  fragments: string[],
) {
  const haystack = questionHaystack(question);
  return fragments
    .map(normalize)
    .some((fragment) => haystack.includes(fragment));
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
  const selectedTrack =
    findAnswer(
      sortedQuestions,
      answerByQuestionId,
      PROGRAM_QUESTION_FRAGMENTS,
      trackToText,
    ) ??
    findAnswer(
      sortedQuestions,
      answerByQuestionId,
      LEGACY_TRACK_FRAGMENTS,
      trackToText,
    );

  return {
    schoolAddress: findAnswer(
      sortedQuestions,
      answerByQuestionId,
      SCHOOL_ADDRESS_FRAGMENTS,
      addressToText,
    ),
    schoolPhone: findAnswer(
      sortedQuestions,
      answerByQuestionId,
      SCHOOL_PHONE_FRAGMENTS,
    ),
    schoolType: findAnswer(
      sortedQuestions,
      answerByQuestionId,
      SCHOOL_TYPE_FRAGMENTS,
    ),
    selectedTrack,
  };
}

async function fetchPagedRows<Row>(
  buildQuery: () => BillingFilteredQuery,
) {
  const rows: Row[] = [];
  let from = 0;

  while (true) {
    const to = from + BILLING_QUERY_PAGE_SIZE - 1;
    const result = await buildQuery().range(from, to);
    if (result.error) throw new Error(result.error.message);

    const page = (result.data ?? []) as Row[];
    rows.push(...page);
    if (page.length < BILLING_QUERY_PAGE_SIZE) break;
    from += BILLING_QUERY_PAGE_SIZE;
  }

  return rows;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
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

  const questions = await fetchPagedRows<BillingQuestionRow>(() =>
    (supabase.from("application_questions") as BillingTableQuery)
      .select("id,form_version_id,question_key,label,source_label,sort_order")
      .in("form_version_id", formVersionIds)
      .order("id", { ascending: true }),
  );
  const relevantQuestionIds = questions
    .filter((question) =>
      questionMatchesFragments(question, BILLING_DETAIL_FRAGMENTS),
    )
    .map((question) => question.id);

  const applicationIds = applications.map((application) => application.id);
  const applicationBatchSize = Math.max(
    1,
    Math.floor(BILLING_QUERY_PAGE_SIZE / Math.max(relevantQuestionIds.length, 1)),
  );
  const answers = relevantQuestionIds.length
    ? (
        await Promise.all(
          chunks(applicationIds, applicationBatchSize).map((applicationBatch) =>
            fetchPagedRows<BillingAnswerRow>(() =>
              (supabase.from("application_answers") as BillingTableQuery)
                .select("id,application_id,question_id,value")
                .in("application_id", applicationBatch)
                .in("question_id", relevantQuestionIds)
                .order("id", { ascending: true }),
            ),
          ),
        )
      ).flat()
    : [];

  const questionsByFormVersion = new Map<string, BillingQuestionRow[]>();
  for (const question of questions) {
    const list = questionsByFormVersion.get(question.form_version_id) ?? [];
    list.push(question);
    questionsByFormVersion.set(question.form_version_id, list);
  }

  const answersByApplication = new Map<string, BillingAnswerRow[]>();
  for (const answer of answers) {
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

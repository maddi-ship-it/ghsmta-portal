export type CommunityShow = {
  applicationId: string;
  schoolName: string;
  productionTitle: string;
  openingDate: string | null;
  closingDate: string | null;
};

type CommunityShowApplication = {
  id: string;
  school_name: string;
  production_title: string | null;
};

type CommunityShowQuestion = {
  id: string;
  question_key: string;
  label: string;
  source_label: string | null;
};

type CommunityShowAnswer = {
  application_id: string;
  question_id: string;
  value: unknown;
};

type DateKind = "opening" | "closing";

type QuestionMatch = {
  kind: DateKind;
  priority: number;
};

function normalizeLabel(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function matchDateQuestion(question: CommunityShowQuestion): QuestionMatch | null {
  const key = normalizeLabel(question.question_key);
  const labels = [question.label, question.source_label].map(normalizeLabel);

  if (
    key.includes("opening_night_date") ||
    labels.some((label) => label === "opening night date")
  ) {
    return { kind: "opening", priority: 2 };
  }

  if (
    key.includes("closing_night_date") ||
    labels.some((label) => label === "closing night date")
  ) {
    return { kind: "closing", priority: 2 };
  }

  if (
    labels.some(
      (label) =>
        label.includes("confirm") &&
        label.includes("opening night") &&
        label.includes("date"),
    )
  ) {
    return { kind: "opening", priority: 1 };
  }

  if (
    labels.some(
      (label) =>
        label.includes("confirm") &&
        label.includes("closing night") &&
        label.includes("date"),
    )
  ) {
    return { kind: "closing", priority: 1 };
  }

  return null;
}

function findDateString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const usMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/);
    let year: number;
    let month: number;
    let day: number;

    if (isoMatch) {
      year = Number(isoMatch[1]);
      month = Number(isoMatch[2]);
      day = Number(isoMatch[3]);
    } else if (usMatch) {
      month = Number(usMatch[1]);
      day = Number(usMatch[2]);
      year = Number(usMatch[3]);
      if (year < 100) year += 2000;
    } else {
      const naturalLanguageDate = new Date(
        normalized.replace(/\s+at\s+/i, " "),
      );
      if (Number.isNaN(naturalLanguageDate.getTime())) return null;

      year = naturalLanguageDate.getFullYear();
      month = naturalLanguageDate.getMonth() + 1;
      day = naturalLanguageDate.getDate();
    }

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-");
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const date = findDateString(entry);
      if (date) return date;
    }
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      const date = findDateString(entry);
      if (date) return date;
    }
  }

  return null;
}

export function buildCommunityShows({
  applications,
  questions,
  answers,
}: {
  applications: CommunityShowApplication[];
  questions: CommunityShowQuestion[];
  answers: CommunityShowAnswer[];
}): CommunityShow[] {
  const questionMatches = new Map<string, QuestionMatch>();

  for (const question of questions) {
    const match = matchDateQuestion(question);
    if (match) questionMatches.set(question.id, match);
  }

  const datesByApplication = new Map<
    string,
    Partial<Record<DateKind, { date: string; priority: number }>>
  >();

  for (const answer of answers) {
    const match = questionMatches.get(answer.question_id);
    const date = findDateString(answer.value);
    if (!match || !date) continue;

    const applicationDates = datesByApplication.get(answer.application_id) ?? {};
    const current = applicationDates[match.kind];

    if (!current || match.priority > current.priority) {
      applicationDates[match.kind] = { date, priority: match.priority };
      datesByApplication.set(answer.application_id, applicationDates);
    }
  }

  return applications
    .map((application) => {
      const dates = datesByApplication.get(application.id);

      return {
        applicationId: application.id,
        schoolName: application.school_name.trim() || "School not provided",
        productionTitle:
          application.production_title?.trim() || "Production title not provided",
        openingDate: dates?.opening?.date ?? null,
        closingDate: dates?.closing?.date ?? null,
      };
    })
    .sort((left, right) => {
      if (left.openingDate && right.openingDate) {
        const openingDifference = left.openingDate.localeCompare(right.openingDate);
        if (openingDifference !== 0) return openingDifference;
      } else if (left.openingDate) {
        return -1;
      } else if (right.openingDate) {
        return 1;
      }

      if (left.closingDate && right.closingDate) {
        const closingDifference = left.closingDate.localeCompare(right.closingDate);
        if (closingDifference !== 0) return closingDifference;
      } else if (left.closingDate) {
        return -1;
      } else if (right.closingDate) {
        return 1;
      }

      return (
        left.schoolName.localeCompare(right.schoolName) ||
        left.productionTitle.localeCompare(right.productionTitle)
      );
    });
}


import type { ApplicationQuestionType } from "@/lib/types";

export type AcceptdQuestionDefinition = {
  id: number;
  type: string;
  label: string;
  description: string | null;
  category: string;
  archived: boolean;
};

export type AcceptdAnswer = {
  id: number | null;
  value: unknown;
  attachment: Record<string, unknown> | null;
  question: AcceptdQuestionDefinition;
};

export type NormalizedAcceptdApplication = {
  id: number;
  userId: number | null;
  programId: number | null;
  stageId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  schoolName: string | null;
  productionTitle: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  answers: AcceptdAnswer[];
  raw: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceId(value: unknown): number | null {
  const candidate = record(value)?.data ?? record(value)?.id ?? value;
  const nested = record(candidate)?.id ?? candidate;
  const parsed = typeof nested === "number" ? nested : Number(String(nested ?? ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString();
}

function questionFromAnswer(value: Record<string, unknown>): AcceptdQuestionDefinition | null {
  const relationships = record(value.relationships);
  const question = record(record(relationships?.question)?.data) ?? record(value.question);
  const id = sourceId(question?.id);
  const type = text(question?.type);
  const label = text(question?.label);
  if (!id || !type || !label) return null;
  return {
    id,
    type: type.toLowerCase(),
    label,
    description: text(question?.description),
    category: text(question?.category) ?? "Other",
    archived: question?.archived === true,
  };
}

export function normalizeAcceptdApplication(raw: Record<string, unknown>): NormalizedAcceptdApplication {
  const id = sourceId(raw.id);
  if (!id) throw new Error("Acceptd application payload is missing a numeric ID.");
  const answers = (Array.isArray(raw.answers) ? raw.answers : [])
    .map((entry): AcceptdAnswer | null => {
      const answer = record(entry);
      if (!answer) return null;
      const question = questionFromAnswer(answer);
      if (!question) return null;
      return {
        id: sourceId(answer.id),
        value: answer.value ?? null,
        attachment: record(answer.attachment),
        question,
      };
    })
    .filter((answer): answer is AcceptdAnswer => Boolean(answer));

  const answerById = new Map(answers.map((answer) => [answer.question.id, answer]));
  const answerByLabel = (pattern: RegExp) =>
    answers.find((answer) => pattern.test(answer.question.label))?.value;
  const emailAnswer =
    answerById.get(83002)?.value ??
    answers.find((answer) => answer.question.type === "email")?.value;

  return {
    id,
    userId: sourceId(raw.user),
    programId: sourceId(raw.program),
    stageId: sourceId(raw.current_stage),
    firstName: text(raw.first_name),
    lastName: text(raw.last_name),
    email: text(emailAnswer),
    schoolName: text(answerById.get(82999)?.value ?? answerByLabel(/school name/i)),
    productionTitle: text(
      answerById.get(83013)?.value ?? answerByLabel(/production title|title of production/i),
    ),
    startedAt: timestamp(raw.started),
    submittedAt: timestamp(raw.submitted),
    answers,
    raw,
  };
}

export function portalQuestionType(acceptdType: string): ApplicationQuestionType {
  switch (acceptdType.toLowerCase()) {
    case "phone":
      return "phone";
    case "email":
      return "email";
    case "integer":
    case "float":
      return "number";
    case "date":
      return "date";
    case "textarea":
    case "richtext":
    case "comment":
    case "address":
      return "long_text";
    case "yesno":
      return "yes_no";
    case "modalsignature":
      return "signature_acknowledgement";
    case "checkbox":
    case "multiselect":
      return "multi_select";
    case "select":
      return "select";
    default:
      return "short_text";
  }
}

export function answerValue(answer: AcceptdAnswer): unknown {
  if (!answer.attachment) return answer.value ?? null;
  return {
    answer: answer.value ?? null,
    attachment: {
      id: answer.attachment.id ?? null,
      type: answer.attachment.type ?? null,
      url: answer.attachment.url ?? null,
      name: answer.attachment.name ?? null,
      description: answer.attachment.description ?? null,
    },
  };
}

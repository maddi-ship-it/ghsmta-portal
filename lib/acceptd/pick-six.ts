const PICK_SIX_QUESTION_ID = 156852;
const PICK_SIX_LABEL_PATTERN = /pick\s*6\s+categories/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function answerValues(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter(
      (item): item is string | number =>
        typeof item === "string" || typeof item === "number",
    )
    .map((item) => String(item).trim())
    .filter(Boolean);
}

export function extractAcceptdPickSix(payload: unknown): string[] {
  const application = record(payload);
  const answers = Array.isArray(application?.answers)
    ? application.answers
    : [];
  const selections: string[] = [];

  for (const value of answers) {
    const answer = record(value);
    const relationships = record(answer?.relationships);
    const questionRelationship = record(relationships?.question);
    const question =
      record(questionRelationship?.data) ?? record(answer?.question);
    const questionId = Number(question?.id);
    const label = typeof question?.label === "string" ? question.label : "";

    if (
      questionId !== PICK_SIX_QUESTION_ID &&
      !PICK_SIX_LABEL_PATTERN.test(label)
    ) {
      continue;
    }

    selections.push(...answerValues(answer?.value));
  }

  return [...new Set(selections)];
}

const PICK_SIX_QUESTION_ID = 156852;
const PICK_SIX_LABEL_PATTERN = /pick\s*6\s+categories/i;

const PICK_SIX_CATEGORY_ALIASES: Record<string, string[]> = {
  choreography: ["choreography"],
  costume_design: ["costumes", "costume", "costume design"],
  direction: ["direction"],
  ensemble: ["ensemble"],
  featured_performer: ["featured performer"],
  leading_actor: ["leading actor"],
  leading_actress: ["leading actress"],
  lighting_design: ["lighting", "lighting design"],
  music_direction: ["music direction"],
  orchestra: ["orchestra"],
  scenic_design: ["scenic", "scenic design"],
  sound_design: ["sound", "sound design"],
  supporting_performer_a: ["supporting performer a"],
  supporting_performer_b: ["supporting performer b"],
  technical_execution: ["technical", "technical execution"],
};

function normalizeCategoryLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function acceptdPickSixOrder(
  category: { category_key: string; title: string },
  selections: readonly string[],
) {
  const aliases = new Set(
    [
      category.title,
      category.category_key.replaceAll("_", " "),
      ...(PICK_SIX_CATEGORY_ALIASES[category.category_key] ?? []),
    ].map(normalizeCategoryLabel),
  );
  const index = selections
    .slice(0, 6)
    .findIndex((selection) => aliases.has(normalizeCategoryLabel(selection)));

  return index === -1 ? null : index + 1;
}

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

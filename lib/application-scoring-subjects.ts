import type {
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
} from "@/lib/types";

type SubjectSource = Pick<
  Application,
  "form_data" | "archived_payload"
>;

type ResolveSubjectInput = {
  application: SubjectSource;
  questions: ApplicationQuestion[];
  answers: ApplicationAnswer[];
};

type AnswerIndex = Map<string, string[]>;

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function displayValue(value: unknown): string {
  if (value == null) return "";

  if (Array.isArray(value)) {
    return value
      .map(displayValue)
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "object") {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value).trim();
}

function addIndexedValue(
  index: AnswerIndex,
  key: string | null | undefined,
  rawValue: unknown,
) {
  if (!key) return;

  const normalizedKey = normalizeLookupKey(key);
  const value = displayValue(rawValue);

  if (!normalizedKey || !value) return;

  const existing = index.get(normalizedKey) ?? [];

  if (!existing.includes(value)) {
    existing.push(value);
    index.set(normalizedKey, existing);
  }
}

function indexObject(
  index: AnswerIndex,
  value: unknown,
  inheritedKey?: string,
  depth = 0,
) {
  if (value == null || depth > 8) return;

  if (Array.isArray(value)) {
    const primitiveValue = displayValue(value);
    if (inheritedKey && primitiveValue) {
      addIndexedValue(index, inheritedKey, primitiveValue);
      return;
    }

    for (const item of value) {
      indexObject(index, item, inheritedKey, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    if (inheritedKey) {
      addIndexedValue(index, inheritedKey, value);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const fieldLabel =
    typeof record.label === "string" ? record.label : null;

  if (fieldLabel && "value" in record) {
    addIndexedValue(index, fieldLabel, record.value);
    if (inheritedKey) {
      addIndexedValue(index, inheritedKey, record.value);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    indexObject(index, nestedValue, key, depth + 1);
  }
}

function buildAnswerIndex({
  application,
  questions,
  answers,
}: ResolveSubjectInput) {
  const index: AnswerIndex = new Map();
  const questionMap = new Map(
    questions.map((question) => [question.id, question]),
  );

  for (const answer of answers) {
    const question = questionMap.get(answer.question_id);
    if (!question) continue;

    addIndexedValue(index, question.question_key, answer.value);
    addIndexedValue(index, question.label, answer.value);
    addIndexedValue(index, question.source_label, answer.value);
  }

  indexObject(index, application.form_data);
  indexObject(index, application.archived_payload);

  return index;
}

function valuesForAliases(
  index: AnswerIndex,
  aliases: string[],
): string[] {
  const normalizedAliases = aliases.map(normalizeLookupKey);
  const values: string[] = [];

  for (const [key, keyValues] of index.entries()) {
    const matches = normalizedAliases.some(
      (alias) =>
        key === alias ||
        key.endsWith(`_${alias}`),
    );

    if (!matches) continue;

    for (const value of keyValues) {
      if (!values.includes(value)) {
        values.push(value);
      }
    }
  }

  return values;
}

function firstValue(
  index: AnswerIndex,
  aliases: string[],
) {
  return valuesForAliases(index, aliases)[0] ?? "";
}

function labeledValues(
  index: AnswerIndex,
  definitions: Array<{
    label: string;
    aliases: string[];
  }>,
) {
  return definitions
    .map(({ label, aliases }) => {
      const value = firstValue(index, aliases);
      return value ? `${label}: ${value}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

export function resolveScoringCategorySubjects(
  input: ResolveSubjectInput,
): Record<string, string> {
  const index = buildAnswerIndex(input);

  const musicDirector = firstValue(index, [
    "music_director_name",
    "musical_director_name",
  ]);

  const conductor = firstValue(index, [
    "conductor_name",
    "orchestra_director_conductor_name",
    "orchestra_director_name",
  ]);

  return {
    music_direction: musicDirector,
    orchestra: conductor || musicDirector,
    choreography: firstValue(index, [
      "choreographer_name",
      "choreography_director_name",
    ]),
    ensemble: "",
    technical_execution: labeledValues(index, [
      {
        label: "Technical Director",
        aliases: ["technical_director_name"],
      },
      {
        label: "Stage Manager",
        aliases: ["stage_manager_name"],
      },
      {
        label: "Lighting Engineer",
        aliases: [
          "lighting_engineer_electrician_name",
          "lighting_engineer_name",
        ],
      },
      {
        label: "Sound Engineer",
        aliases: [
          "sound_audio_engineer_name",
          "sound_engineer_name",
        ],
      },
    ]),
    lighting_design: firstValue(index, [
      "lighting_designer_name",
    ]),
    sound_design: labeledValues(index, [
      {
        label: "Designer",
        aliases: ["sound_designer_name"],
      },
      {
        label: "Engineer",
        aliases: [
          "sound_audio_engineer_name",
          "sound_engineer_name",
        ],
      },
    ]),
    scenic_design: firstValue(index, [
      "scenic_designer_name",
      "set_designer_name",
    ]),
    costume_design: firstValue(index, [
      "costume_designer_coordinator_name",
      "costume_designer_name",
      "costume_coordinator_name",
    ]),
    leading_actress: firstValue(index, [
      "leading_actress_name",
    ]),
    leading_actor: firstValue(index, [
      "leading_actor_name",
    ]),
    supporting_performer_a: firstValue(index, [
      "supporting_performer_a_name",
      "supporting_performer_1_name",
    ]),
    supporting_performer_b: firstValue(index, [
      "supporting_performer_b_name",
      "supporting_performer_2_name",
    ]),
    featured_performer: firstValue(index, [
      "featured_performer_name",
    ]),
    direction: firstValue(index, [
      "director_name",
      "production_director_name",
    ]),
  };
}

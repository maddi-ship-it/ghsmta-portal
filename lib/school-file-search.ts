export type SearchableSchoolFileApplication = {
  application_id: string;
  school_name: string;
  production_title: string | null;
  season_year: string;
  program_name: string;
};

export type SearchableSchoolFile = {
  application_id: string;
  original_name: string;
  generated_name: string;
  mime_type: string | null;
  document_category: string;
  created_at: string;
  display_name?: string | null;
  person_name?: string | null;
  award_category?: string | null;
  role_or_character?: string | null;
  designer_name?: string | null;
  phonetic_spelling?: string | null;
  file_notes?: string | null;
  production_name?: string | null;
};

function normalizedSearchTerms(query: string) {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function searchableText(values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(" ").toLocaleLowerCase();
}

function includesEveryTerm(haystack: string, query: string) {
  const terms = normalizedSearchTerms(query);
  return terms.length === 0 || terms.every((term) => haystack.includes(term));
}

export function schoolApplicationMatchesSearch(
  application: SearchableSchoolFileApplication,
  query: string,
) {
  return includesEveryTerm(
    searchableText([
      application.school_name,
      application.production_title,
      application.season_year,
      application.program_name,
    ]),
    query,
  );
}

export function schoolFileMatchesSearch({
  application,
  file,
  query,
  categoryLabel,
}: {
  application?: SearchableSchoolFileApplication;
  file: SearchableSchoolFile;
  query: string;
  categoryLabel: string;
}) {
  const createdAt = new Date(file.created_at);
  const friendlyDate = Number.isNaN(createdAt.valueOf())
    ? ""
    : createdAt.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

  return includesEveryTerm(
    searchableText([
      file.original_name,
      file.generated_name,
      file.mime_type,
      file.document_category,
      categoryLabel,
      file.display_name,
      file.person_name,
      file.award_category,
      file.role_or_character,
      file.designer_name,
      file.phonetic_spelling,
      file.file_notes,
      file.production_name,
      file.created_at,
      friendlyDate,
      application?.school_name,
      application?.production_title,
      application?.season_year,
      application?.program_name,
    ]),
    query,
  );
}

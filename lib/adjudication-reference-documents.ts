import type { SupabaseClient } from "@supabase/supabase-js";

const REFERENCE_DOCUMENT_BUCKET = "reference-documents";
const EVALUATION_GLOSSARY_HANDBOOK_PAGE = 29;

export type AdjudicationReferenceDocument = {
  id: string;
  file_name: string;
  storage_path: string;
  description: string | null;
};

export type AdjudicationReferenceLink = {
  key: "scoring-guide" | "evaluative-glossary";
  label: string;
  fileName: string;
  href: string;
};

type MatchedReferenceDocument = {
  key: AdjudicationReferenceLink["key"];
  label: string;
  document: AdjudicationReferenceDocument;
  page?: number;
};

function searchableDocumentName(document: AdjudicationReferenceDocument) {
  return `${document.file_name} ${document.description ?? ""}`
    .replaceAll(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchAdjudicationReferenceDocuments(
  documents: AdjudicationReferenceDocument[],
): MatchedReferenceDocument[] {
  const scoringGuide = documents.find((document) =>
    searchableDocumentName(document).includes("scoring guide"),
  );
  const dedicatedGlossary = documents.find((document) => {
    const searchableName = searchableDocumentName(document);
    return (
      searchableName.includes("evaluation glossary") ||
      searchableName.includes("evaluative glossary") ||
      searchableName.includes("category glossary")
    );
  });
  const handbookGlossary = dedicatedGlossary
    ? undefined
    : documents.find((document) =>
        searchableDocumentName(document).includes("adjudicator handbook"),
      );

  const matches: MatchedReferenceDocument[] = [];
  if (scoringGuide) {
    matches.push({
      key: "scoring-guide",
      label: "Scoring guide",
      document: scoringGuide,
    });
  }

  if (dedicatedGlossary) {
    matches.push({
      key: "evaluative-glossary",
      label: "Evaluative glossary",
      document: dedicatedGlossary,
    });
  } else if (handbookGlossary) {
    matches.push({
      key: "evaluative-glossary",
      label: "Evaluative glossary",
      document: handbookGlossary,
      page: EVALUATION_GLOSSARY_HANDBOOK_PAGE,
    });
  }

  return matches;
}

export async function loadAdjudicationReferenceLinks(
  supabase: SupabaseClient,
): Promise<AdjudicationReferenceLink[]> {
  const { data, error } = await supabase
    .from("reference_documents")
    .select("id,file_name,storage_path,description")
    .order("created_at", { ascending: false });

  if (error) return [];

  const matches = matchAdjudicationReferenceDocuments(
    (data ?? []) as AdjudicationReferenceDocument[],
  );
  const links = await Promise.all(
    matches.map(async (match) => {
      const { data: urlData, error: urlError } = await supabase.storage
        .from(REFERENCE_DOCUMENT_BUCKET)
        .createSignedUrl(match.document.storage_path, 60 * 60);

      if (urlError || !urlData?.signedUrl) return null;

      return {
        key: match.key,
        label: match.label,
        fileName: match.document.file_name,
        href: match.page
          ? `${urlData.signedUrl}#page=${match.page}`
          : urlData.signedUrl,
      };
    }),
  );

  return links.filter((link): link is AdjudicationReferenceLink => Boolean(link));
}

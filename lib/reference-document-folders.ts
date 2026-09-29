export type ReferenceAudience =
  | "all"
  | "applicant"
  | "adjudicator"
  | "advisory";

export type ReferenceFolder = {
  id: string;
  parent_id: string | null;
  name: string;
  visible_to_applicants: boolean;
  visible_to_adjudicators: boolean;
  visible_to_advisory: boolean;
  created_at: string;
};

export type ReferenceDocumentVisibility = {
  visible_to_applicants: boolean;
  visible_to_adjudicators: boolean;
  visible_to_advisory: boolean;
};

export function referenceItemVisibleToAudience(
  item: ReferenceDocumentVisibility,
  audience: ReferenceAudience,
) {
  if (audience === "all") return true;
  if (audience === "applicant") return item.visible_to_applicants;
  if (audience === "adjudicator") return item.visible_to_adjudicators;
  return item.visible_to_advisory;
}

export function referenceFolderCanContainDocument(
  folder: ReferenceFolder,
  document: ReferenceDocumentVisibility,
) {
  return (
    (!document.visible_to_applicants || folder.visible_to_applicants) &&
    (!document.visible_to_adjudicators || folder.visible_to_adjudicators) &&
    (!document.visible_to_advisory || folder.visible_to_advisory)
  );
}

export function referenceFolderBreadcrumbs(
  folders: ReferenceFolder[],
  folderId: string | null,
) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const breadcrumbs: ReferenceFolder[] = [];
  const visited = new Set<string>();
  let currentId = folderId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = byId.get(currentId);
    if (!folder) break;
    breadcrumbs.unshift(folder);
    currentId = folder.parent_id;
  }

  return breadcrumbs;
}

export function referenceFolderPath(
  folders: ReferenceFolder[],
  folderId: string,
) {
  return referenceFolderBreadcrumbs(folders, folderId)
    .map((folder) => folder.name)
    .join(" / ");
}

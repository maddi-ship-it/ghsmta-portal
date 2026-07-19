export function slugFilePart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function buildGeneratedFileName({
  season,
  program,
  school,
  documentType,
  originalName,
  date = new Date(),
}: {
  season?: string | null;
  program?: string | null;
  school?: string | null;
  documentType: string;
  originalName: string;
  date?: Date;
}) {
  const extensionMatch = originalName.match(/(\.[a-zA-Z0-9]{1,10})$/);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "";
  const baseName = extension ? originalName.slice(0, -extension.length) : originalName;
  const datePart = date.toISOString().slice(0, 10).replaceAll("-", "");

  return [
    season,
    program,
    school,
    documentType,
    baseName,
    datePart,
  ]
    .map((part) => slugFilePart(String(part ?? "")))
    .filter(Boolean)
    .join("_")
    .concat(extension);
}

export const PORTAL_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
  "audio/x-m4a",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/zip",
  "application/x-zip-compressed",
] as const;

const ALLOWED_MIME_TYPES = new Set<string>(PORTAL_UPLOAD_MIME_TYPES);
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "txt", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "webp", "heic", "heif", "gif",
  "mp3", "m4a", "wav", "webm", "mp4", "mov", "zip",
]);

const FALLBACK_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
};

export const REFERENCE_DOCUMENT_MAX_FILE_BYTES = 500 * 1024 * 1024;

export const PORTAL_FILE_ACCEPT = [
  ".pdf", ".txt", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif",
  ".mp3", ".m4a", ".wav", ".webm", ".mp4", ".mov", ".zip",
].join(",");

export function portalFileMimeType(file: Pick<File, "name" | "type">) {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;
  const reportedType = file.type.toLowerCase();
  if (reportedType) {
    return ALLOWED_MIME_TYPES.has(reportedType) ? reportedType : null;
  }
  return FALLBACK_MIME_TYPES[extension] ?? null;
}

export function isAllowedPortalFile(file: Pick<File, "name" | "type">) {
  return portalFileMimeType(file) !== null;
}

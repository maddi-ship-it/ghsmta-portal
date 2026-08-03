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

export const PORTAL_FILE_ACCEPT = [
  ".pdf", ".txt", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif",
  ".mp3", ".m4a", ".wav", ".webm", ".mp4", ".mov", ".zip",
].join(",");

export function isAllowedPortalFile(file: Pick<File, "name" | "type">) {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) return false;
  return !file.type || ALLOWED_MIME_TYPES.has(file.type.toLowerCase());
}

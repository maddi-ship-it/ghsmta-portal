function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x26;", "&")
    .replaceAll("&quot;", '"')
    .trim();
}

function iframeSource(value: string): string | null {
  const iframe = value.match(/<iframe\b[^>]*>/i)?.[0];
  if (!iframe) return null;

  const quoted = iframe.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (quoted) return decodeHtmlAttribute(quoted);

  const unquoted = iframe.match(/\ssrc\s*=\s*([^\s>]+)/i)?.[1];
  return unquoted ? decodeHtmlAttribute(unquoted) : null;
}

export function normalizeEmbeddedDocumentUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Add a complete HTTPS document URL or iframe code.");
  }

  const source = iframeSource(trimmed) ?? trimmed;
  if (source.includes("<") || source.includes(">")) {
    throw new Error("The iframe code must include a valid src URL.");
  }

  let url: URL;
  try {
    url = new URL(decodeHtmlAttribute(source));
  } catch {
    throw new Error("Add a complete HTTPS document URL or iframe code.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Embedded documents must use HTTPS.");
  }

  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("The embedded document URL is not valid.");
  }

  return url.toString();
}

export function safeEmbeddedDocumentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    return normalizeEmbeddedDocumentUrl(value);
  } catch {
    return null;
  }
}

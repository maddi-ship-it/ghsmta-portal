const ADOBE_SIGN_HOST_SUFFIXES = [
  "adobesign.com",
  "echosign.com",
  "documents.adobe.com",
  "adobesigndemo.com",
  "echosigndemo.com",
] as const;

const DEFAULT_EMBED_HEIGHT = 760;
const MIN_EMBED_HEIGHT = 500;
const MAX_EMBED_HEIGHT = 1800;

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

function isAllowedAdobeSignHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ADOBE_SIGN_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

export function normalizeAdobeSignEmbed(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Paste the Adobe Sign iframe code or Web Form URL.");
  }

  const source = iframeSource(trimmed) ?? trimmed;
  if (source.includes("<") || source.includes(">")) {
    throw new Error("The Adobe Sign iframe code must include a valid src URL.");
  }

  let url: URL;
  try {
    url = new URL(decodeHtmlAttribute(source));
  } catch {
    throw new Error("Paste a complete Adobe Sign https URL or iframe code.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Adobe Sign embeds must use https.");
  }

  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("The Adobe Sign Web Form URL is not valid.");
  }

  if (!isAllowedAdobeSignHost(url.hostname)) {
    throw new Error(
      "Only Adobe Acrobat Sign Web Form URLs can be embedded.",
    );
  }

  if (!/^\/public\/esignWidget\/?$/i.test(url.pathname)) {
    throw new Error(
      "Use the Web Form iframe code from Adobe Sign (the esignWidget URL).",
    );
  }

  if (!url.searchParams.get("wid")?.trim()) {
    throw new Error("The Adobe Sign Web Form URL is missing its widget ID.");
  }

  return url.toString();
}

export function safeAdobeSignEmbedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizeAdobeSignEmbed(value);
  } catch {
    return null;
  }
}

export function normalizeAdobeSignEmbedHeight(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_EMBED_HEIGHT;
  return Math.min(Math.max(parsed, MIN_EMBED_HEIGHT), MAX_EMBED_HEIGHT);
}

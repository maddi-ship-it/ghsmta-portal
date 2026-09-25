const LOCAL_SITE_URL = "http://localhost:3000";
const PRODUCTION_SITE_URL = "https://ghsmta.getproductionops.com";

function isSupabaseApiOrigin(value: string) {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "supabase.co" || hostname.endsWith(".supabase.co");
}

export function normalizeSiteUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const explicitProtocol = trimmed.match(/^([a-z][a-z\d+.-]*):/i)?.[1];
  if (
    explicitProtocol &&
    !["http", "https"].includes(explicitProtocol.toLowerCase())
  ) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function portalSiteUrl(requestOrigin?: string | null) {
  if (process.env.NODE_ENV === "production") {
    return PRODUCTION_SITE_URL;
  }

  const supabaseApiOrigin = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const candidates = [
    requestOrigin,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ];

  for (const candidate of candidates) {
    const origin = normalizeSiteUrl(candidate);
    if (
      origin &&
      origin !== supabaseApiOrigin &&
      !isSupabaseApiOrigin(origin)
    ) {
      return origin;
    }
  }

  return LOCAL_SITE_URL;
}

export function portalAuthCallbackUrl(
  nextPath: string,
  requestOrigin?: string | null,
) {
  const url = new URL("/auth/callback", portalSiteUrl(requestOrigin));
  url.searchParams.set("next", safePortalRedirectPath(nextPath));
  return url.toString();
}

export function safePortalRedirectPath(
  value: string | null | undefined,
  fallback = "/portal",
) {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return fallback;
  }

  try {
    const base = "https://portal.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

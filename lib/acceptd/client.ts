const DEFAULT_BASE_URL = "https://api.getacceptd.com";
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export class AcceptdApiError extends Error {
  status: number | null;
  retryable: boolean;

  constructor(
    message: string,
    options: { cause?: unknown; status?: number; retryable?: boolean } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AcceptdApiError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

type Query = URLSearchParams | Array<[string, string | number]> | Record<string, string | number | null | undefined>;

type ClientOptions = {
  token?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

type ListOptions = {
  query?: Query;
  maxPages?: number;
  limit?: number;
};

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new TypeError("The Acceptd API base URL must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function appendQuery(url: URL, query?: Query) {
  if (!query) return;
  const entries =
    query instanceof URLSearchParams
      ? query.entries()
      : Array.isArray(query)
        ? query
        : Object.entries(query);
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.append(key, String(value));
  }
}

function sanitized(value: unknown, token: string) {
  return String(value ?? "")
    .replaceAll(token, "[REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function collection(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: Record<string, unknown>[] }).data;
  }
  throw new AcceptdApiError("Acceptd returned an unexpected application list payload.");
}

function resource(payload: unknown): Record<string, unknown> {
  const value =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AcceptdApiError("Acceptd returned an unexpected application payload.");
  }
  return value as Record<string, unknown>;
}

function nextLink(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const next = (payload as { links?: { next?: unknown } }).links?.next;
  if (typeof next === "string" && next.trim()) return next;
  if (next && typeof next === "object") {
    const link = next as { href?: unknown; url?: unknown };
    if (typeof link.href === "string" && link.href.trim()) return link.href;
    if (typeof link.url === "string" && link.url.trim()) return link.url;
  }
  return null;
}

function retryDelay(response: Response | null, attempt: number) {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30_000);
  }
  return Math.min(500 * 2 ** attempt, 8_000);
}

export function createAcceptdClient(options: ClientOptions = {}) {
  const token = (options.token ?? process.env.ACCEPTD_API_TOKEN ?? "").trim();
  if (!token) throw new Error("ACCEPTD_API_TOKEN is not configured.");
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? process.env.ACCEPTD_API_BASE_URL ?? DEFAULT_BASE_URL,
  );
  const timeoutMs = options.timeoutMs ?? Number(process.env.ACCEPTD_API_TIMEOUT_MS || 30_000);
  const maxRetries = options.maxRetries ?? 3;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  positiveInteger(timeoutMs, "Acceptd API timeout");
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new TypeError("Acceptd API max retries must be between 0 and 10.");
  }

  function apiUrl(pathOrUrl: string | URL) {
    const url = new URL(pathOrUrl, baseUrl);
    if (url.origin !== baseUrl.origin) {
      throw new AcceptdApiError("Acceptd returned a cross-origin pagination URL.");
    }
    return url;
  }

  async function requestJson(pathOrUrl: string | URL) {
    const url = apiUrl(pathOrUrl);
    let finalError: AcceptdApiError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        finalError = new AcceptdApiError(
          error instanceof Error && error.name === "AbortError"
            ? `Acceptd API request timed out after ${timeoutMs}ms.`
            : `Acceptd API request failed: ${sanitized(error, token)}`,
          { cause: error, retryable: true },
        );
        if (attempt >= maxRetries) throw finalError;
        await sleep(retryDelay(null, attempt));
        continue;
      } finally {
        clearTimeout(timeout);
      }

      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (error) {
          if (response.ok) {
            throw new AcceptdApiError("Acceptd returned invalid JSON.", {
              cause: error,
              status: response.status,
            });
          }
          body = text;
        }
      }
      if (response.ok) return body;
      const retryable = RETRYABLE_STATUS_CODES.has(response.status);
      finalError = new AcceptdApiError(
        `Acceptd API request failed (${url.pathname}): ${response.status} ${sanitized(
          typeof body === "object" && body ? JSON.stringify(body) : body,
          token,
        )}`,
        { status: response.status, retryable },
      );
      if (!retryable || attempt >= maxRetries) throw finalError;
      await sleep(retryDelay(response, attempt));
    }
    throw finalError ?? new AcceptdApiError("Acceptd API request failed.");
  }

  async function getApplication(applicationId: string | number) {
    const id = String(applicationId).trim();
    if (!/^\d+$/.test(id)) throw new TypeError("A numeric Acceptd application ID is required.");
    const url = apiUrl(`/v2/applications/${encodeURIComponent(id)}`);
    appendQuery(url, { include: "user,program,tags" });
    return resource(await requestJson(url));
  }

  async function listApplications(options: ListOptions = {}) {
    const maxPages = options.maxPages ?? 100;
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    positiveInteger(maxPages, "Acceptd API max pages");
    if (limit !== Number.POSITIVE_INFINITY) positiveInteger(limit, "Acceptd API record limit");
    const firstUrl = apiUrl("/v2/applications");
    appendQuery(firstUrl, options.query);
    const applications: Record<string, unknown>[] = [];
    const visited = new Set<string>();
    let currentUrl: URL | null = firstUrl;
    let pageCount = 0;
    while (currentUrl) {
      if (visited.has(currentUrl.toString())) {
        throw new AcceptdApiError("Acceptd returned a circular pagination link.");
      }
      visited.add(currentUrl.toString());
      pageCount += 1;
      const payload = await requestJson(currentUrl);
      const rows = collection(payload);
      applications.push(...rows.slice(0, limit - applications.length));
      if (applications.length >= limit) break;
      const next = nextLink(payload);
      if (!next) break;
      if (pageCount >= maxPages) {
        throw new AcceptdApiError(`Acceptd pagination exceeded ${maxPages} pages.`);
      }
      currentUrl = apiUrl(next);
    }
    return { applications, pageCount };
  }

  async function getProgramApplications(programId: string | number) {
    const id = String(programId).trim();
    if (!/^\d+$/.test(id)) throw new TypeError("A numeric Acceptd program ID is required.");
    const listed = await listApplications({
      query: [
        ["programs", id],
        ["include", "user,program,tags"],
        ["per_page", 100],
      ],
    });
    const details = new Array<Record<string, unknown>>(listed.applications.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, listed.applications.length) }, async () => {
        while (cursor < listed.applications.length) {
          const index = cursor++;
          const sourceId = listed.applications[index]?.id;
          if (sourceId === undefined || sourceId === null) {
            throw new AcceptdApiError("An Acceptd application list record has no ID.");
          }
          details[index] = await getApplication(String(sourceId));
        }
      }),
    );
    return details;
  }

  return { getApplication, getProgramApplications, listApplications };
}

const DEFAULT_BASE_URL = "https://api.getacceptd.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export class AcceptdApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AcceptdApiError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(
    url.hostname,
  );
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopmentHost)) {
    throw new TypeError(
      "The Acceptd API base URL must use HTTPS (HTTP is allowed only for local tests).",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function sanitizeText(value, token) {
  const text = String(value ?? "")
    .replaceAll(token, "[REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
  return text.slice(0, 500);
}

function responseDescription(response, body, token) {
  const detail = sanitizeText(
    typeof body === "object" && body !== null
      ? body.message ?? body.error ?? JSON.stringify(body)
      : body,
    token,
  ).trim();
  return `${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`;
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 30_000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(Math.max(0, date - Date.now()), 30_000);
    }
  }
  return Math.min(500 * 2 ** attempt, 8_000);
}

function nextLinkFrom(payload) {
  if (!payload || typeof payload !== "object") return null;
  const next = payload.links?.next;
  if (typeof next === "string" && next.trim()) return next;
  if (next && typeof next === "object") {
    if (typeof next.href === "string" && next.href.trim()) return next.href;
    if (typeof next.url === "string" && next.url.trim()) return next.url;
  }
  return null;
}

function collectionData(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
    return payload.data;
  }
  throw new AcceptdApiError(
    "Acceptd returned an unexpected application-list payload (expected an array or a JSON:API data array).",
  );
}

function singleResourceData(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

function appendQuery(url, query) {
  if (!query) return;
  const entries =
    query instanceof URLSearchParams
      ? query.entries()
      : Array.isArray(query)
        ? query
        : Object.entries(query);
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.append(String(key), String(value));
  }
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await callback(items[currentIndex], currentIndex);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function createAcceptdClient({
  token,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof token !== "string" || !token.trim()) {
    throw new TypeError("An Acceptd API bearer token is required.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A Fetch-compatible implementation is required.");
  }
  requirePositiveInteger(timeoutMs, "timeoutMs");
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new TypeError("maxRetries must be an integer between 0 and 10.");
  }

  const apiToken = token.trim();
  const apiBaseUrl = normalizeBaseUrl(baseUrl);

  function resolveApiUrl(pathOrUrl) {
    const url = new URL(pathOrUrl, apiBaseUrl);
    if (url.origin !== apiBaseUrl.origin) {
      throw new AcceptdApiError(
        "Acceptd returned a pagination URL on a different origin; the bearer token was not sent.",
      );
    }
    return url;
  }

  async function requestJson(pathOrUrl) {
    const url = resolveApiUrl(pathOrUrl);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiToken}`,
          },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? `Acceptd API request timed out after ${timeoutMs}ms.`
            : `Acceptd API request failed: ${sanitizeText(error, apiToken)}`;
        lastError = new AcceptdApiError(message, {
          cause: error,
          retryable: true,
        });
        if (attempt < maxRetries) {
          await sleep(retryDelayMs(null, attempt));
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeout);
      }

      let body = null;
      const text = await response.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (error) {
          if (response.ok) {
            throw new AcceptdApiError(
              "Acceptd returned a successful response that was not valid JSON.",
              { cause: error, status: response.status },
            );
          }
          body = text;
        }
      }

      if (response.ok) return body;

      const retryable = RETRYABLE_STATUS_CODES.has(response.status);
      lastError = new AcceptdApiError(
        `Acceptd API request failed (${url.pathname}): ${responseDescription(response, body, apiToken)}`,
        { status: response.status, retryable },
      );
      if (!retryable || attempt >= maxRetries) throw lastError;
      await sleep(retryDelayMs(response, attempt));
    }

    throw lastError ?? new AcceptdApiError("Acceptd API request failed.");
  }

  async function listApplications({
    query,
    maxPages = 100,
    limit = Number.POSITIVE_INFINITY,
    onPage,
  } = {}) {
    requirePositiveInteger(maxPages, "maxPages");
    if (limit !== Number.POSITIVE_INFINITY) requirePositiveInteger(limit, "limit");

    const firstUrl = resolveApiUrl("/v2/applications");
    appendQuery(firstUrl, query);
    const visited = new Set();
    const applications = [];
    let currentUrl = firstUrl;
    let pageCount = 0;

    while (currentUrl) {
      const pageKey = currentUrl.toString();
      if (visited.has(pageKey)) {
        throw new AcceptdApiError(
          "Acceptd returned a circular application pagination link.",
        );
      }
      visited.add(pageKey);
      pageCount += 1;

      const payload = await requestJson(currentUrl);
      const pageApplications = collectionData(payload);
      const remaining = limit - applications.length;
      applications.push(...pageApplications.slice(0, remaining));
      if (typeof onPage === "function") {
        onPage({ page: pageCount, received: pageApplications.length });
      }
      if (applications.length >= limit) break;

      const next = nextLinkFrom(payload);
      if (!next) break;
      if (pageCount >= maxPages) {
        throw new AcceptdApiError(
          `Acceptd application pagination exceeded the ${maxPages}-page safety limit.`,
        );
      }
      currentUrl = resolveApiUrl(next);
    }

    return { applications, pageCount };
  }

  async function getApplication(applicationId) {
    const id = String(applicationId ?? "").trim();
    if (!id) throw new TypeError("An Acceptd application ID is required.");
    const payload = await requestJson(`/v2/applications/${encodeURIComponent(id)}`);
    return singleResourceData(payload);
  }

  async function pullApplications({
    includeDetails = true,
    concurrency = 4,
    onDetail,
    ...listOptions
  } = {}) {
    requirePositiveInteger(concurrency, "concurrency");
    if (concurrency > 20) {
      throw new TypeError("concurrency cannot exceed 20.");
    }
    const listed = await listApplications(listOptions);
    if (!includeDetails) return listed;

    const applications = await mapWithConcurrency(
      listed.applications,
      concurrency,
      async (application, index) => {
        const id = application?.id;
        if (id === undefined || id === null || String(id).trim() === "") {
          throw new AcceptdApiError(
            `Acceptd application list item ${index + 1} does not include an ID.`,
          );
        }
        const detail = await getApplication(id);
        if (typeof onDetail === "function") {
          onDetail({ completed: index + 1, total: listed.applications.length });
        }
        return detail;
      },
    );

    return { applications, pageCount: listed.pageCount };
  }

  return {
    getApplication,
    listApplications,
    pullApplications,
  };
}

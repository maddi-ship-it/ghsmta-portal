export const PORTAL_ERROR_STORAGE_KEY = "ghsmta:recent-page-errors:v1";

const MAX_ERROR_COUNT = 12;
const MAX_ERROR_AGE_MS = 30 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 800;
const ALLOWED_ERROR_KINDS = new Set([
  "runtime",
  "promise",
  "react",
  "visible",
  "query",
  "resource",
]);

export type PortalPageError = {
  kind:
    | "runtime"
    | "promise"
    | "react"
    | "visible"
    | "query"
    | "resource";
  message: string;
  name?: string;
  digest?: string;
  source?: string;
  line?: number;
  column?: number;
  pagePath: string;
  occurredAt: string;
};

type PortalPageErrorInput = Omit<PortalPageError, "pagePath" | "occurredAt"> & {
  pagePath?: string;
  occurredAt?: string;
};

function truncate(value: string, maximum = MAX_MESSAGE_LENGTH) {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

export function sanitizePortalDiagnosticText(value: string) {
  return truncate(
    value
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g,
        "[redacted-token]",
      )
      .replace(
        /([?&](?:access_token|refresh_token|token|code|key|secret|password)=)[^&\s]+/gi,
        "$1[redacted]",
      )
      .trim(),
  );
}

export function sanitizePortalPageUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /^(?:access_token|refresh_token|token|code|key|secret|password)$/i.test(
          key,
        )
      ) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    url.hash = "";
    return truncate(url.toString(), 2_000);
  } catch {
    return "";
  }
}

function safePagePath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  return truncate(value.split(/[?#]/, 1)[0], 500);
}

function safeSource(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;

  try {
    const parsed = new URL(
      value,
      typeof window === "undefined" ? "https://portal.invalid" : window.location.origin,
    );
    return truncate(`${parsed.origin}${parsed.pathname}`, 500);
  } catch {
    return truncate(value.split(/[?#]/, 1)[0], 500);
  }
}

function safePositiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

export function parsePortalPageErrors(value: unknown): PortalPageError[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.slice(-MAX_ERROR_COUNT).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const kind = typeof row.kind === "string" ? row.kind : "";
    const message =
      typeof row.message === "string"
        ? sanitizePortalDiagnosticText(row.message)
        : "";
    if (!ALLOWED_ERROR_KINDS.has(kind) || !message) return [];

    const occurredAt =
      typeof row.occurredAt === "string" &&
      Number.isFinite(new Date(row.occurredAt).getTime())
        ? new Date(row.occurredAt).toISOString()
        : new Date().toISOString();

    const source = safeSource(row.source);
    const line = safePositiveInteger(row.line);
    const column = safePositiveInteger(row.column);

    return [
      {
        kind: kind as PortalPageError["kind"],
        message,
        ...(typeof row.name === "string" && row.name.trim()
          ? {
              name: truncate(
                sanitizePortalDiagnosticText(row.name.trim()),
                100,
              ),
            }
          : {}),
        ...(typeof row.digest === "string" && row.digest.trim()
          ? {
              digest: truncate(
                sanitizePortalDiagnosticText(row.digest.trim()),
                160,
              ),
            }
          : {}),
        ...(source ? { source } : {}),
        ...(line ? { line } : {}),
        ...(column ? { column } : {}),
        pagePath: safePagePath(row.pagePath),
        occurredAt,
      },
    ];
  });
}

function readStoredErrors() {
  if (typeof window === "undefined") return [];
  try {
    return parsePortalPageErrors(
      window.sessionStorage.getItem(PORTAL_ERROR_STORAGE_KEY),
    ).filter(
      (error) =>
        Date.now() - new Date(error.occurredAt).getTime() <= MAX_ERROR_AGE_MS,
    );
  } catch {
    return [];
  }
}

function writeStoredErrors(errors: PortalPageError[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      PORTAL_ERROR_STORAGE_KEY,
      JSON.stringify(errors.slice(-MAX_ERROR_COUNT)),
    );
  } catch {
    // Diagnostics must never interrupt the portal workflow.
  }
}

function deduplicateErrors(errors: PortalPageError[]) {
  const bySignature = new Map<string, PortalPageError>();
  for (const error of errors) {
    const signature = [
      error.kind,
      error.message,
      error.digest ?? "",
      error.source ?? "",
      error.line ?? "",
      error.column ?? "",
      error.pagePath,
    ].join("|");
    bySignature.set(signature, error);
  }
  return [...bySignature.values()]
    .sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() -
        new Date(right.occurredAt).getTime(),
    )
    .slice(-MAX_ERROR_COUNT);
}

export function recordPortalPageError(input: PortalPageErrorInput) {
  if (typeof window === "undefined") return;
  const message = sanitizePortalDiagnosticText(input.message);
  if (!message) return;

  const next = parsePortalPageErrors([
    {
      ...input,
      message,
      pagePath: input.pagePath ?? window.location.pathname,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    },
  ])[0];
  if (!next) return;

  writeStoredErrors(deduplicateErrors([...readStoredErrors(), next]));
}

export function recordPortalErrorBoundary(
  error: Error & { digest?: string },
) {
  recordPortalPageError({
    kind: "react",
    message: error.message || "A portal workspace failed to render.",
    name: error.name,
    digest: error.digest,
  });
}

function visiblePageErrors(pagePath: string): PortalPageError[] {
  if (typeof document === "undefined") return [];

  return [...document.querySelectorAll<HTMLElement>(
    '[role="alert"], .form-error, .error-banner, .header-chat-error',
  )].flatMap((element) => {
    if (
      element.closest("[data-feedback-dialog]") ||
      element.closest('[aria-hidden="true"]')
    ) {
      return [];
    }
    const message = sanitizePortalDiagnosticText(element.innerText || "");
    if (!message) return [];
    return [
      {
        kind: "visible" as const,
        message,
        pagePath,
        occurredAt: new Date().toISOString(),
      },
    ];
  });
}

function queryStringErrors(pagePath: string): PortalPageError[] {
  if (typeof window === "undefined") return [];
  const parameters = new URLSearchParams(window.location.search);
  const captured = ["error", "error_code", "message", "reason", "missing"]
    .flatMap((key) => {
      const value = parameters.get(key);
      return value ? [`${key}: ${value}`] : [];
    })
    .join(" · ");

  return captured
    ? [
        {
          kind: "query" as const,
          message: sanitizePortalDiagnosticText(captured),
          pagePath,
          occurredAt: new Date().toISOString(),
        },
      ]
    : [];
}

function failedResourceErrors(pagePath: string): PortalPageError[] {
  if (typeof performance === "undefined") return [];
  return performance
    .getEntriesByType("resource")
    .slice(-80)
    .flatMap((entry) => {
      const status = Number(
        (entry as PerformanceResourceTiming & { responseStatus?: number })
          .responseStatus,
      );
      if (!Number.isInteger(status) || status < 400) return [];
      return [
        {
          kind: "resource" as const,
          message: `HTTP ${status} while loading a page resource.`,
          source: safeSource(entry.name),
          pagePath,
          occurredAt: new Date().toISOString(),
        },
      ];
    });
}

export function collectPortalPageErrors() {
  if (typeof window === "undefined") return [];
  const pagePath = safePagePath(window.location.pathname);
  return deduplicateErrors([
    ...readStoredErrors().filter((error) => error.pagePath === pagePath),
    ...visiblePageErrors(pagePath),
    ...queryStringErrors(pagePath),
    ...failedResourceErrors(pagePath),
  ]);
}

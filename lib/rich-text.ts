const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replaceAll(
          "\n",
          "<br>",
        )}</p>`,
    )
    .join("");
}

export function sanitizeRichTextHtml(
  value: string | null | undefined,
) {
  const source = String(value ?? "").trim();

  if (!source) {
    return "";
  }

  if (!/<\/?[a-z][^>]*>/i.test(source)) {
    return plainTextToHtml(source);
  }

  const withoutDangerousBlocks = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(
      /<(script|style|iframe|object|embed)[^>]*\/?\s*>/gi,
      "",
    );

  const normalized = withoutDangerousBlocks
    .replace(
      /<\/?b(?:\s[^>]*)?>/gi,
      (tag) =>
        tag.startsWith("</")
          ? "</strong>"
          : "<strong>",
    )
    .replace(
      /<\/?i(?:\s[^>]*)?>/gi,
      (tag) =>
        tag.startsWith("</")
          ? "</em>"
          : "<em>",
    )
    .replace(/<div(?:\s[^>]*)?>/gi, "<p>")
    .replace(/<\/div>/gi, "</p>");

  return normalized
    .replace(
      /<(\/?)\s*([a-z0-9]+)(?:\s[^>]*)?>/gi,
      (
        _match,
        closing: string,
        rawTag: string,
      ) => {
        const tag = rawTag.toLowerCase();

        if (!ALLOWED_TAGS.has(tag)) {
          return "";
        }

        if (tag === "br") {
          return "<br>";
        }

        return `<${closing ? "/" : ""}${tag}>`;
      },
    )
    .trim();
}

function decodeEntities(value: string) {
  const named = value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

  return named
    .replace(
      /&#(\d+);/g,
      (_match, code: string) =>
        String.fromCodePoint(Number(code)),
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_match, code: string) =>
        String.fromCodePoint(
          Number.parseInt(code, 16),
        ),
    );
}

export function richTextToPlainText(
  value: string | null | undefined,
) {
  const html = sanitizeRichTextHtml(value);

  if (!html) {
    return "";
  }

  return decodeEntities(
    html
      .replace(/<li>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<br>/gi, "\n")
      .replace(/<\/(p|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function richTextHasContent(
  value: string | null | undefined,
) {
  return richTextToPlainText(value).length > 0;
}

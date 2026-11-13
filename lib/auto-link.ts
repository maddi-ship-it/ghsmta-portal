const AUTO_LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const SIMPLE_TRAILING_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":"]);
const CLOSING_PAIRS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

export type AutoLinkSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

function appendTextSegment(segments: AutoLinkSegment[], text: string) {
  if (!text) return;

  const previousSegment = segments.at(-1);
  if (previousSegment?.kind === "text") {
    previousSegment.text += text;
    return;
  }

  segments.push({ kind: "text", text });
}

function countCharacter(value: string, character: string) {
  let count = 0;
  for (const candidate of value) {
    if (candidate === character) count += 1;
  }
  return count;
}

function splitTrailingPunctuation(value: string) {
  let linkText = value;
  let trailingText = "";

  while (linkText) {
    const finalCharacter = linkText.at(-1)!;
    if (SIMPLE_TRAILING_PUNCTUATION.has(finalCharacter)) {
      trailingText = `${finalCharacter}${trailingText}`;
      linkText = linkText.slice(0, -1);
      continue;
    }

    const openingCharacter = CLOSING_PAIRS[finalCharacter];
    if (
      openingCharacter &&
      countCharacter(linkText, finalCharacter) >
        countCharacter(linkText, openingCharacter)
    ) {
      trailingText = `${finalCharacter}${trailingText}`;
      linkText = linkText.slice(0, -1);
      continue;
    }

    break;
  }

  return { linkText, trailingText };
}

function safeLinkHref(value: string) {
  const candidate = value.toLowerCase().startsWith("www.")
    ? `https://${value}`
    : value;

  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function autoLinkSegments(value: string): AutoLinkSegment[] {
  const segments: AutoLinkSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(AUTO_LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      appendTextSegment(segments, value.slice(cursor, index));
    }

    const matchedText = match[0];
    const { linkText, trailingText } = splitTrailingPunctuation(matchedText);
    const href = safeLinkHref(linkText);
    if (href) {
      segments.push({ kind: "link", text: linkText, href });
    } else {
      appendTextSegment(segments, linkText);
    }
    if (trailingText) {
      appendTextSegment(segments, trailingText);
    }

    cursor = index + matchedText.length;
  }

  if (cursor < value.length) {
    appendTextSegment(segments, value.slice(cursor));
  }

  return segments.length > 0 ? segments : [{ kind: "text", text: value }];
}

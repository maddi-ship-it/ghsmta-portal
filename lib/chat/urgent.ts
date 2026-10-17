const URGENT_MENTION_PATTERN = /(^|[^a-z0-9_])@urgent\b/i;

export function containsUrgentMention(value: string) {
  return URGENT_MENTION_PATTERN.test(value);
}

export function canUseUrgentTag(role: string) {
  return role === "owner" || role === "advisory_member";
}

function normalizeForSms(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1).trimEnd()}…`
    : value;
}

export function buildUrgentChatSms({
  authorName,
  channelLabel,
  message,
  chatUrl,
}: {
  authorName: string;
  channelLabel: string;
  message: string;
  chatUrl: string;
}) {
  const heading = truncate(
    `URGENT GHSMTA chat — ${normalizeForSms(channelLabel)}`,
    90,
  );
  const byline = truncate(`From ${normalizeForSms(authorName)}`, 60);
  const reservedLength = heading.length + byline.length + chatUrl.length + 6;
  const previewLength = Math.max(20, 320 - reservedLength);
  const preview = truncate(normalizeForSms(message), previewLength);

  return `${heading}\n${byline}\n${preview}\n${chatUrl}`;
}

export const DEFAULT_COMMUNITY_POST_SUBJECT = "Community post";

export function communityPostSubject(
  value: string,
  fallback = DEFAULT_COMMUNITY_POST_SUBJECT,
) {
  const subject = value.trim();
  return subject || fallback;
}


export const DEFAULT_COMMUNITY_POST_SUBJECT = "Community post";

export function communityPostSubject(value: string) {
  const subject = value.trim();
  return subject || DEFAULT_COMMUNITY_POST_SUBJECT;
}


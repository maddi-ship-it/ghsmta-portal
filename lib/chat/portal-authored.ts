export const PORTAL_CHAT_AUTHOR_NAME = "The Portal";
export const PORTAL_NARRATIVE_ASSIGNMENTS_SUBJECT =
  "Final comment assignments";

const PORTAL_AUTHOR_ID_PREFIX = "portal:";
const NARRATIVE_ASSIGNMENT_PREVIEW_PREFIX =
  "Final comment writers have been assigned for ";

export function isPortalChatAuthorId(authorId: string) {
  return authorId.startsWith(PORTAL_AUTHOR_ID_PREFIX);
}

export function presentPortalAuthoredThread<
  T extends {
    author_id: string;
    author_name: string;
    post_id: string;
    subject: string;
  },
>(thread: T): T {
  if (thread.subject !== PORTAL_NARRATIVE_ASSIGNMENTS_SUBJECT) {
    return thread;
  }

  return {
    ...thread,
    author_id: `${PORTAL_AUTHOR_ID_PREFIX}${thread.post_id}`,
    author_name: PORTAL_CHAT_AUTHOR_NAME,
  };
}

export function presentPortalAuthoredChannel<
  T extends {
    latest_author_name: string | null;
    latest_message_preview: string | null;
  },
>(channel: T): T {
  if (
    !channel.latest_message_preview?.startsWith(
      NARRATIVE_ASSIGNMENT_PREVIEW_PREFIX,
    )
  ) {
    return channel;
  }

  return {
    ...channel,
    latest_author_name: PORTAL_CHAT_AUTHOR_NAME,
  };
}

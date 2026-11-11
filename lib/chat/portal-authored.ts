export const PORTAL_CHAT_AUTHOR_NAME = "The Portal";
export const PORTAL_ACTING_CANDIDATES_CONFIRMED_SUBJECT =
  "Acting candidates confirmed";
export const PORTAL_ACTING_CANDIDATE_CHANGES_SUBJECT =
  "Acting candidate changes approved";
export const PORTAL_NARRATIVE_ASSIGNMENTS_SUBJECT =
  "Final comment assignments";
export const PORTAL_PLAYBILL_SONG_LIST_MISSING_SUBJECT_PREFIX =
  "Playbill song list not found:";

const PORTAL_AUTHOR_ID_PREFIX = "portal:";
const NARRATIVE_ASSIGNMENT_PREVIEW_PREFIX =
  "Final comment writers have been assigned for ";
const ACTING_CANDIDATE_PREVIEW_PHRASE =
  "Congratulations on a successful run of your production!";
export const PORTAL_PLAYBILL_SONG_LIST_MISSING_PREVIEW_PREFIX =
  "The Portal could not find a printed song list in ";

function isPortalAuthoredSubject(subject: string) {
  return (
    subject === PORTAL_NARRATIVE_ASSIGNMENTS_SUBJECT ||
    subject === PORTAL_ACTING_CANDIDATES_CONFIRMED_SUBJECT ||
    subject === PORTAL_ACTING_CANDIDATE_CHANGES_SUBJECT ||
    subject.startsWith(PORTAL_PLAYBILL_SONG_LIST_MISSING_SUBJECT_PREFIX)
  );
}

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
  if (!isPortalAuthoredSubject(thread.subject)) {
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
    ) &&
    !channel.latest_message_preview?.includes(
      ACTING_CANDIDATE_PREVIEW_PHRASE,
    ) &&
    !channel.latest_message_preview?.startsWith(
      PORTAL_PLAYBILL_SONG_LIST_MISSING_PREVIEW_PREFIX,
    )
  ) {
    return channel;
  }

  return {
    ...channel,
    latest_author_name: PORTAL_CHAT_AUTHOR_NAME,
  };
}

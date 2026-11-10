import { describe, expect, it } from "vitest";

import {
  isPortalChatAuthorId,
  PORTAL_NARRATIVE_ASSIGNMENTS_SUBJECT,
  PORTAL_PLAYBILL_SONG_LIST_MISSING_PREVIEW_PREFIX,
  PORTAL_PLAYBILL_SONG_LIST_MISSING_SUBJECT_PREFIX,
  presentPortalAuthoredChannel,
  presentPortalAuthoredThread,
} from "./portal-authored";

describe("portal-authored chat notifications", () => {
  it("presents final-comment assignments as coming from The Portal", () => {
    const presented = presentPortalAuthoredThread({
      author_id: "staff-user",
      author_name: "Staff Member",
      post_id: "post-1",
      subject: PORTAL_NARRATIVE_ASSIGNMENTS_SUBJECT,
    });

    expect(presented.author_name).toBe("The Portal");
    expect(isPortalChatAuthorId(presented.author_id)).toBe(true);
  });

  it("leaves ordinary staff posts unchanged", () => {
    const post = {
      author_id: "staff-user",
      author_name: "Staff Member",
      post_id: "post-2",
      subject: "Message",
    };

    expect(presentPortalAuthoredThread(post)).toBe(post);
  });

  it("uses The Portal in the channel preview for assignment notices", () => {
    expect(
      presentPortalAuthoredChannel({
        latest_author_name: "Staff Member",
        latest_message_preview:
          "Final comment writers have been assigned for Demo School — Newsies.",
      }).latest_author_name,
    ).toBe("The Portal");
  });

  it("presents missing Playbill song-list notices as coming from The Portal", () => {
    const presented = presentPortalAuthoredThread({
      author_id: "school-user",
      author_name: "School User",
      post_id: "post-3",
      subject: `${PORTAL_PLAYBILL_SONG_LIST_MISSING_SUBJECT_PREFIX} Playbill.pdf`,
    });

    expect(presented.author_name).toBe("The Portal");
    expect(isPortalChatAuthorId(presented.author_id)).toBe(true);
    expect(
      presentPortalAuthoredChannel({
        latest_author_name: "School User",
        latest_message_preview: `${PORTAL_PLAYBILL_SONG_LIST_MISSING_PREVIEW_PREFIX}Playbill.pdf.`,
      }).latest_author_name,
    ).toBe("The Portal");
  });
});

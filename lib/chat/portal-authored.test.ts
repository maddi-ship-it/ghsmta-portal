import { describe, expect, it } from "vitest";

import {
  isPortalChatAuthorId,
  PORTAL_NARRATIVE_ASSIGNMENTS_SUBJECT,
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
});

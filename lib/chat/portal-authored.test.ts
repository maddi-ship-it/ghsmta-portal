import { describe, expect, it } from "vitest";

import {
  isPortalChatAuthorId,
  PORTAL_ACTING_CANDIDATES_CONFIRMED_SUBJECT,
  PORTAL_ACTING_CANDIDATE_CHANGES_SUBJECT,
  PORTAL_FINAL_COMMENTS_READY_SUBJECT,
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

  it("presents Owner final-comment release notices as coming from The Portal", () => {
    const presented = presentPortalAuthoredThread({
      author_id: "owner-user",
      author_name: "Owner Name",
      post_id: "post-ready",
      subject: PORTAL_FINAL_COMMENTS_READY_SUBJECT,
    });

    expect(presented.author_name).toBe("The Portal");
    expect(isPortalChatAuthorId(presented.author_id)).toBe(true);
    expect(
      presentPortalAuthoredChannel({
        latest_author_name: "Owner Name",
        latest_message_preview:
          "The Owner sent final comments to the panel for Demo School — Newsies.",
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

  it.each([
    PORTAL_ACTING_CANDIDATES_CONFIRMED_SUBJECT,
    PORTAL_ACTING_CANDIDATE_CHANGES_SUBJECT,
  ])("presents %s as coming from The Portal", (subject) => {
    const presented = presentPortalAuthoredThread({
      author_id: "acm-user",
      author_name: "ACM Name",
      post_id: "candidate-post",
      subject,
    });

    expect(presented.author_name).toBe("The Portal");
    expect(isPortalChatAuthorId(presented.author_id)).toBe(true);
  });

  it("uses The Portal in the channel preview for acting-candidate notices", () => {
    expect(
      presentPortalAuthoredChannel({
        latest_author_name: "ACM Name",
        latest_message_preview:
          "Hi Leila! Congratulations on a successful run of your production! We are so proud to have your program and students",
      }).latest_author_name,
    ).toBe("The Portal");
  });
});

import { describe, expect, it } from "vitest";

import {
  isFeedNearBottom,
  messagesBelongTogether,
  realtimeConnectionLabel,
} from "@/lib/chat-presentation";

describe("chat presentation", () => {
  it("groups consecutive messages from the same author within five minutes", () => {
    expect(
      messagesBelongTogether(
        { author_id: "owner", created_at: "2026-10-15T14:00:00.000Z" },
        { author_id: "owner", created_at: "2026-10-15T14:05:00.000Z" },
      ),
    ).toBe(true);
  });

  it("starts a new message group for another author or a later message", () => {
    expect(
      messagesBelongTogether(
        { author_id: "school", created_at: "2026-10-15T14:00:00.000Z" },
        { author_id: "owner", created_at: "2026-10-15T14:01:00.000Z" },
      ),
    ).toBe(false);
    expect(
      messagesBelongTogether(
        { author_id: "owner", created_at: "2026-10-15T14:00:00.000Z" },
        { author_id: "owner", created_at: "2026-10-15T14:05:01.000Z" },
      ),
    ).toBe(false);
  });

  it("detects whether incoming messages can safely keep the feed pinned", () => {
    expect(
      isFeedNearBottom({ scrollHeight: 1200, scrollTop: 640, clientHeight: 500 }),
    ).toBe(true);
    expect(
      isFeedNearBottom({ scrollHeight: 1200, scrollTop: 300, clientHeight: 500 }),
    ).toBe(false);
  });

  it("uses concise realtime connection labels", () => {
    expect(realtimeConnectionLabel("connecting")).toBe("Connecting");
    expect(realtimeConnectionLabel("connected")).toBe("Live");
    expect(realtimeConnectionLabel("reconnecting")).toBe("Reconnecting");
  });
});

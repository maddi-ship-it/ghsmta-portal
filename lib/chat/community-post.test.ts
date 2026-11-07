import { describe, expect, it } from "vitest";

import {
  communityPostSubject,
  DEFAULT_COMMUNITY_POST_SUBJECT,
} from "@/lib/chat/community-post";

describe("communityPostSubject", () => {
  it("keeps an optional title when one is provided", () => {
    expect(communityPostSubject("  Opening night photos  ")).toBe(
      "Opening night photos",
    );
  });

  it("supplies the database fallback when a post has no title", () => {
    expect(communityPostSubject("   ")).toBe(DEFAULT_COMMUNITY_POST_SUBJECT);
  });
});


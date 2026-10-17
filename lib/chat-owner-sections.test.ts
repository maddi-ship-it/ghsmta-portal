import { describe, expect, it } from "vitest";

import {
  isOwnerChatSection,
  OWNER_CHAT_SECTIONS,
} from "@/lib/chat-owner-sections";

describe("owner chat sections", () => {
  it("offers each supported sidebar header once", () => {
    const values = OWNER_CHAT_SECTIONS.map((section) => section.value);

    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual([
      "direct_messages",
      "community",
      "adjudicator_channels",
      "advisory_committee",
      "portal_updates",
    ]);
  });

  it("rejects unsupported sidebar destinations", () => {
    expect(isOwnerChatSection("direct_messages")).toBe(true);
    expect(isOwnerChatSection("schools")).toBe(false);
    expect(isOwnerChatSection("")).toBe(false);
  });
});

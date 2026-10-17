import { describe, expect, it } from "vitest";

import { buildUrgentChatSms, containsUrgentMention } from "@/lib/chat/urgent";

describe("urgent chat messages", () => {
  it("recognizes a standalone urgent mention without case sensitivity", () => {
    expect(containsUrgentMention("@URGENT Please call me.")).toBe(true);
    expect(containsUrgentMention("Please treat this as @urgent, thank you.")).toBe(true);
  });

  it("does not match email-like or longer tokens", () => {
    expect(containsUrgentMention("person@urgent.example")).toBe(false);
    expect(containsUrgentMention("@urgently please")).toBe(false);
  });

  it("builds a compact text with context and a chat link", () => {
    const result = buildUrgentChatSms({
      authorName: "Beth Lenhart",
      channelLabel: "Demo School 01 — Panel Channel",
      message: `@URGENT ${"Please review this update. ".repeat(30)}`,
      chatUrl: "https://ghsmta.getproductionops.com/portal/chat?channel=123",
    });

    expect(result).toContain("URGENT GHSMTA chat");
    expect(result).toContain("From Beth Lenhart");
    expect(result).toContain("@URGENT");
    expect(result).toContain("/portal/chat?channel=123");
    expect(result.length).toBeLessThanOrEqual(320);
  });

  it("keeps long names within the text-size target", () => {
    const result = buildUrgentChatSms({
      authorName: "A".repeat(300),
      channelLabel: "C".repeat(300),
      message: `@URGENT ${"M".repeat(500)}`,
      chatUrl: "https://ghsmta.getproductionops.com/portal/chat?channel=123",
    });

    expect(result.length).toBeLessThanOrEqual(320);
    expect(result).toContain("/portal/chat?channel=123");
  });
});

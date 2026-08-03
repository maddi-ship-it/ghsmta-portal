import { describe, expect, it } from "vitest";

import {
  ADJUDICATOR_CHANNELS_LABEL,
  chatChannelDisplayName,
  chatChannelGroupLabel,
  GENERAL_ANNOUNCEMENTS_LABEL,
  SCHOOL_COMMUNITY_CHAT_LABEL,
} from "./chat-terminology";

describe("chat terminology", () => {
  it("brands the two global channels", () => {
    expect(chatChannelDisplayName("applicant_community", "Community Chat")).toBe(
      SCHOOL_COMMUNITY_CHAT_LABEL,
    );
    expect(chatChannelDisplayName("general", "General")).toBe(
      GENERAL_ANNOUNCEMENTS_LABEL,
    );
  });

  it("brands the adjudicator channel group without changing unrelated groups", () => {
    expect(chatChannelGroupLabel("networking", "Staff channels")).toBe(
      ADJUDICATOR_CHANNELS_LABEL,
    );
    expect(chatChannelGroupLabel("school", "Panel Channels")).toBe(
      "Panel Channels",
    );
  });
});

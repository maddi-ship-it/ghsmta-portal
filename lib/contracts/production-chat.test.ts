import { describe, expect, it } from "vitest";

import { productionChatParticipantIds } from "./production-chat";

describe("Production chat participants", () => {
  it("includes the Owner and contractor when they are different people", () => {
    expect(productionChatParticipantIds("owner-1", "contractor-1")).toEqual([
      "owner-1",
      "contractor-1",
    ]);
  });

  it("only includes the person once when an Owner creates their own contract", () => {
    expect(productionChatParticipantIds("owner-1", "owner-1")).toEqual([
      "owner-1",
    ]);
  });
});


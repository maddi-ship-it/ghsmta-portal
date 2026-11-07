import { describe, expect, it } from "vitest";

import { resolveFocusSafeRemoteUpdate } from "./focus-safe-remote-value";

describe("resolveFocusSafeRemoteUpdate", () => {
  it("acknowledges an autosave without rewriting the editor", () => {
    expect(
      resolveFocusSafeRemoteUpdate({
        currentValue: "Current draft",
        dirty: true,
        focused: true,
        remoteValue: "Current draft",
      }),
    ).toBe("acknowledge");
  });

  it("queues changed saved content while the editor is focused", () => {
    expect(
      resolveFocusSafeRemoteUpdate({
        currentValue: "Local text",
        dirty: false,
        focused: true,
        remoteValue: "Saved elsewhere",
      }),
    ).toBe("queue");
  });

  it("queues changed saved content while a local draft is unsaved", () => {
    expect(
      resolveFocusSafeRemoteUpdate({
        currentValue: "Unsaved text",
        dirty: true,
        focused: false,
        remoteValue: "Previous save",
      }),
    ).toBe("queue");
  });

  it("applies changed saved content to an idle clean editor", () => {
    expect(
      resolveFocusSafeRemoteUpdate({
        currentValue: "Previous save",
        dirty: false,
        focused: false,
        remoteValue: "New save",
      }),
    ).toBe("apply");
  });
});

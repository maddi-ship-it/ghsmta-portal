import { describe, expect, it } from "vitest";

import { roleLabel } from "./format";

describe("roleLabel", () => {
  it("labels the Program Manager access tier", () => {
    expect(roleLabel("program_manager")).toBe("Program Manager");
  });

  it("labels the Production access tier", () => {
    expect(roleLabel("production")).toBe("Production");
  });
});

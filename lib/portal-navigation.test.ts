import { describe, expect, it } from "vitest";

import { isPortalRouteActive } from "./portal-navigation";

describe("isPortalRouteActive", () => {
  it("only marks the portal dashboard active on the exact dashboard route", () => {
    expect(isPortalRouteActive("/portal", "/portal")).toBe(true);
    expect(isPortalRouteActive("/portal/schedule", "/portal")).toBe(false);
  });

  it("keeps a section active on nested detail routes", () => {
    expect(
      isPortalRouteActive(
        "/portal/adjudication/application-id",
        "/portal/adjudication",
      ),
    ).toBe(true);
  });

  it("does not confuse routes that only share a prefix", () => {
    expect(
      isPortalRouteActive("/portal/admin/users-old", "/portal/admin/users"),
    ).toBe(false);
  });

  it("ignores query strings and trailing slashes in navigation hrefs", () => {
    expect(
      isPortalRouteActive("/portal/chat", "/portal/chat/?channel=example"),
    ).toBe(true);
  });
});

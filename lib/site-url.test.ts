import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeSiteUrl,
  portalAuthCallbackUrl,
  portalSiteUrl,
  safePortalRedirectPath,
} from "./site-url";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
});

describe("normalizeSiteUrl", () => {
  it("adds https to a configured hostname", () => {
    expect(normalizeSiteUrl("ghsmta.getproductionops.com")).toBe(
      "https://ghsmta.getproductionops.com",
    );
  });

  it("keeps local http origins and removes paths", () => {
    expect(normalizeSiteUrl("http://localhost:3000/portal/")).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects credentials and unsupported protocols", () => {
    expect(normalizeSiteUrl("https://user:pass@example.com")).toBeNull();
    expect(normalizeSiteUrl("ftp://example.com")).toBeNull();
  });
});

describe("portalSiteUrl", () => {
  it("prefers the current request origin for user-triggered email flows", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://configured.example.com";

    expect(portalSiteUrl("https://ghsmta.getproductionops.com")).toBe(
      "https://ghsmta.getproductionops.com",
    );
  });

  it("never uses the Supabase API as the public portal origin", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://adunoztrgywglfgbooqb.supabase.co";
    process.env.NEXT_PUBLIC_SITE_URL =
      "https://adunoztrgywglfgbooqb.supabase.co";
    process.env.VERCEL_PROJECT_PRODUCTION_URL =
      "ghsmta.getproductionops.com";

    expect(portalSiteUrl()).toBe("https://ghsmta.getproductionops.com");
  });

  it("rejects any hosted Supabase API origin even if it differs from the configured project", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://adunoztrgywglfgbooqb.supabase.co";
    process.env.NEXT_PUBLIC_SITE_URL = "https://another-project.supabase.co";
    process.env.VERCEL_PROJECT_PRODUCTION_URL =
      "ghsmta.getproductionops.com";

    expect(portalSiteUrl()).toBe("https://ghsmta.getproductionops.com");
  });

  it("always uses the canonical portal in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_SITE_URL =
      "https://adunoztrgywglfgbooqb.supabase.co";

    expect(
      portalSiteUrl("https://adunoztrgywglfgbooqb.supabase.co"),
    ).toBe("https://ghsmta.getproductionops.com");
  });
});

describe("portalAuthCallbackUrl", () => {
  it("builds an encoded callback URL on the current portal origin", () => {
    expect(
      portalAuthCallbackUrl(
        "/portal/chat?channel=123#latest",
        "https://ghsmta.getproductionops.com",
      ),
    ).toBe(
      "https://ghsmta.getproductionops.com/auth/callback?next=%2Fportal%2Fchat%3Fchannel%3D123%23latest",
    );
  });

  it("falls back to the portal root for an external destination", () => {
    expect(
      portalAuthCallbackUrl(
        "https://attacker.example.com",
        "https://ghsmta.getproductionops.com",
      ),
    ).toBe(
      "https://ghsmta.getproductionops.com/auth/callback?next=%2Fportal",
    );
  });
});

describe("safePortalRedirectPath", () => {
  it("preserves internal portal destinations", () => {
    expect(safePortalRedirectPath("/portal/chat?channel=123#latest")).toBe(
      "/portal/chat?channel=123#latest",
    );
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(safePortalRedirectPath("https://example.com")).toBe("/portal");
    expect(safePortalRedirectPath("//example.com")).toBe("/portal");
    expect(safePortalRedirectPath("/\\example.com")).toBe("/portal");
  });
});

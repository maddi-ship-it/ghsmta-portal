import { describe, expect, it } from "vitest";

import { storedReportHref } from "@/lib/reports/report-links";

describe("storedReportHref", () => {
  it("restores camel-case filters from a completed report run", () => {
    const href = storedReportHref("score-completion", {
      cycleId: "cycle-1",
      school: "Rainey",
      sort: "school",
      direction: "desc",
      variant: "external",
      includeArchived: true,
      includeContactInfo: false,
    });
    const url = new URL(href, "https://portal.test");

    expect(url.searchParams.get("report")).toBe("score-completion");
    expect(url.searchParams.get("cycle_id")).toBe("cycle-1");
    expect(url.searchParams.get("school")).toBe("Rainey");
    expect(url.searchParams.get("direction")).toBe("desc");
    expect(url.searchParams.get("variant")).toBe("external");
    expect(url.searchParams.get("include_archived")).toBe("on");
    expect(url.searchParams.get("include_contact_info")).toBe("0");
  });

  it("restores snake-case filters from a saved preset", () => {
    const href = storedReportHref(
      "appeals-register",
      {
        date_from: "2026-08-01",
        date_to: "2026-10-31",
        include_internal_notes: false,
        include_protected_scores: true,
      },
      "internal",
    );
    const url = new URL(href, "https://portal.test");

    expect(url.searchParams.get("date_from")).toBe("2026-08-01");
    expect(url.searchParams.get("date_to")).toBe("2026-10-31");
    expect(url.searchParams.get("include_internal_notes")).toBe("0");
    expect(url.searchParams.get("include_protected_scores")).toBe("on");
    expect(url.searchParams.get("variant")).toBe("internal");
  });
});

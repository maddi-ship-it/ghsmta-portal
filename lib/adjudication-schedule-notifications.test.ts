import { describe, expect, it } from "vitest";

import { buildAdjudicationScheduleNotificationCopy } from "./adjudication-schedule-notifications";

describe("buildAdjudicationScheduleNotificationCopy", () => {
  it("includes all three ticket totals in the 72-hour panel notice", () => {
    const copy = buildAdjudicationScheduleNotificationCopy({
      kind: "guest_ticket_72_hour",
      schoolName: "Example High School",
      productionTitle: "Example Show",
      panelTicketCount: 4,
      guestTicketCount: 2,
      responseCount: 4,
      visitDetailsUrl: "https://example.test/portal/schedule",
      guestTicketUrl: "https://example.test/portal/guest-ticket-request",
    });

    expect(copy.body).toContain("Panel tickets: **4**");
    expect(copy.body).toContain("Guest tickets: **2**");
    expect(copy.body).toContain("Total tickets: **6**");
  });

  it("links applicants directly to visit details in the 14-day notice", () => {
    const copy = buildAdjudicationScheduleNotificationCopy({
      kind: "visit_details_14_day",
      schoolName: "Example High School",
      productionTitle: "Example Show",
      panelTicketCount: 0,
      guestTicketCount: 0,
      responseCount: 0,
      visitDetailsUrl:
        "https://example.test/portal/schedule#school-visit-details",
      guestTicketUrl: "https://example.test/portal/guest-ticket-request",
    });

    expect(copy.body).toContain("two weeks away");
    expect(copy.body).toContain("#school-visit-details");
  });
});

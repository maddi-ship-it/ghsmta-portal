import { describe, expect, it } from "vitest";

import { buildVisitReminderCopy } from "./adjudication-visit-reminders";

describe("72-hour adjudication visit reminder copy", () => {
  it("includes every visit detail and names all five attached views", () => {
    const copy = buildVisitReminderCopy({
      schoolName: "Rainey-McCullers School of the Arts",
      productionTitle: "Into The Woods",
      scheduleTitle: "Sunday Matinee",
      startsAt: "2026-10-18T18:00:00+00:00",
      endsAt: "2026-10-18T21:00:00+00:00",
      location: null,
      details: {
        venue_name: "Rainey-McCullers School of the Arts",
        venue_address: "1700 Midtown Drive, Columbus, GA 31906",
        arrival_entrance: "Concert Hall entrance",
        parking_instructions: "Front lot",
        accessibility_notes: "Accessible entrance and seating",
        wifi_network: "MSCD_Guest",
        wifi_password: "Register with email",
        day_of_contact_name: "Courtney McClendon",
        day_of_contact_phone: "423.741.6706",
      },
      panelNames: ["Christy Baggett", "Julie Ann Rice"],
      applicationId: "application-id",
      schoolInstructions: "Arrive 30 minutes before curtain.",
    });

    expect(copy.subject).toContain("72-HOUR ADJUDICATION VISIT REMINDER");
    expect(copy.text).toContain("Sunday, October 18, 2026");
    expect(copy.text).toContain("2:00 PM–5:00 PM ET");
    expect(copy.text).toContain("Concert Hall entrance");
    expect(copy.text).toContain("MSCD_Guest");
    expect(copy.text).toContain("Courtney McClendon");
    expect(copy.text).toContain("Arrive 30 minutes before curtain.");
    expect(copy.text).toContain(
      "The GHSMTA Portal is the official source of truth",
    );
    expect(copy.text).toContain("Please check the portal before your visit");
    expect(copy.text).toContain(
      "there is not currently a dedicated GHSMTA mobile app",
    );
    expect(copy.text).toContain("provided for convenient mobile viewing");
    expect(copy.text).toContain(
      "Eligibility, Acting Candidates, Budget, Program Maturity/Vision/Support, and Full Application",
    );
    expect(copy.text).toContain("Christy Baggett, Julie Ann Rice");
  });
});

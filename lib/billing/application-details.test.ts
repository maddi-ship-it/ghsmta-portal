import { describe, expect, it } from "vitest";

import { buildBillingApplicationDetails } from "./application-details";

describe("billing application details", () => {
  it("extracts school type and prefers the Acceptd program question for the selected track", () => {
    const details = buildBillingApplicationDetails(
      [
        {
          id: "school-type",
          form_version_id: "form-1",
          question_key: "acceptd_q_137656",
          label: "School Type",
          source_label: "School Type",
          sort_order: 10,
        },
        {
          id: "legacy-track",
          form_version_id: "form-1",
          question_key: "which_track_are_you_registering_for_in_the_2026_27_season",
          label: "Which Track are you registering for in the 2026-27 Season?",
          source_label: null,
          sort_order: 20,
        },
        {
          id: "acceptd-program",
          form_version_id: "form-1",
          question_key: "acceptd_q_163198",
          label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          source_label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          sort_order: 280,
        },
      ],
      [
        {
          application_id: "application-1",
          question_id: "school-type",
          value: "Public (Title I)",
        },
        {
          application_id: "application-1",
          question_id: "legacy-track",
          value: "Mentorship Track",
        },
        {
          application_id: "application-1",
          question_id: "acceptd-program",
          value:
            "Competition Track- A three-person adjudication panel will attend your production.",
        },
      ],
    );

    expect(details.schoolType).toBe("Public (Title I)");
    expect(details.selectedTrack).toBe("Competition Track");
  });

  it("normalizes mentorship track answers even when Acceptd text has a typo", () => {
    const details = buildBillingApplicationDetails(
      [
        {
          id: "acceptd-program",
          form_version_id: "form-1",
          question_key: "acceptd_q_163198",
          label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          source_label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          sort_order: 10,
        },
      ],
      [
        {
          application_id: "application-1",
          question_id: "acceptd-program",
          value: "Mentorship Trak",
        },
      ],
    );

    expect(details.selectedTrack).toBe("Mentorship Track");
  });
});

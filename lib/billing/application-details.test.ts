import { describe, expect, it } from "vitest";

import { buildBillingApplicationDetails } from "./application-details";

describe("billing application details", () => {
  it("extracts school type and a short selected-track label", () => {
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
          id: "track",
          form_version_id: "form-1",
          question_key: "which_track_are_you_registering_for_in_the_2026_27_season",
          label: "Which Track are you registering for in the 2026-27 Season?",
          source_label: null,
          sort_order: 20,
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
          question_id: "track",
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
          id: "track",
          form_version_id: "form-1",
          question_key: "which_track_are_you_registering_for_in_the_2026_27_season",
          label: "Which Track are you registering for in the 2026-27 Season?",
          source_label: null,
          sort_order: 10,
        },
      ],
      [
        {
          application_id: "application-1",
          question_id: "track",
          value: "Mentorship Trak",
        },
      ],
    );

    expect(details.selectedTrack).toBe("Mentorship Track");
  });
});

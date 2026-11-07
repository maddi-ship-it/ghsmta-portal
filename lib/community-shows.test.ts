import { describe, expect, it } from "vitest";

import { buildCommunityShows } from "@/lib/community-shows";

describe("buildCommunityShows", () => {
  it("uses the canonical date questions and sorts shows by opening night", () => {
    const shows = buildCommunityShows({
      applications: [
        { id: "b", school_name: "Buford", production_title: "Show B" },
        { id: "a", school_name: "Flowery Branch", production_title: "Show A" },
        { id: "c", school_name: "North Oconee", production_title: "Show C" },
      ],
      questions: [
        {
          id: "opening",
          question_key: "acceptd_c106_opening_night_date",
          label: "Opening Night Date",
          source_label: null,
        },
        {
          id: "closing",
          question_key: "acceptd_c107_closing_night_date",
          label: "Closing Night Date",
          source_label: null,
        },
      ],
      answers: [
        { application_id: "a", question_id: "opening", value: "10/1/26" },
        { application_id: "a", question_id: "closing", value: "10/4/26" },
        { application_id: "b", question_id: "opening", value: "11/5/26" },
        { application_id: "b", question_id: "closing", value: "11/8/26" },
      ],
    });

    expect(shows.map((show) => show.applicationId)).toEqual(["a", "b", "c"]);
    expect(shows[0]).toMatchObject({
      openingDate: "2026-10-01",
      closingDate: "2026-10-04",
    });
    expect(shows[2]).toMatchObject({
      openingDate: null,
      closingDate: null,
    });
  });

  it("prefers the canonical opening date over a confirmation question", () => {
    const shows = buildCommunityShows({
      applications: [
        { id: "show", school_name: "Blessed Trinity", production_title: null },
      ],
      questions: [
        {
          id: "confirmation",
          question_key: "confirm_opening",
          label: "Please confirm your opening night date and time",
          source_label: null,
        },
        {
          id: "canonical",
          question_key: "acceptd_q_137670",
          label: "Opening Night Date",
          source_label: null,
        },
      ],
      answers: [
        {
          application_id: "show",
          question_id: "confirmation",
          value: "November 4, 2026 at 7:00PM",
        },
        {
          application_id: "show",
          question_id: "canonical",
          value: { date: "2026-11-05" },
        },
      ],
    });

    expect(shows[0]).toMatchObject({
      openingDate: "2026-11-05",
      productionTitle: "Production title not provided",
    });
  });
});

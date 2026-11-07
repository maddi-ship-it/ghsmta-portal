import { describe, expect, it } from "vitest";

import {
  buildUpcomingAdjudications,
  REQUIRED_ADJUDICATOR_COUNT,
} from "@/lib/chat/upcoming-adjudications";

const slots = [
  {
    id: "slot-1",
    starts_at: "2026-11-10T23:00:00.000Z",
    ends_at: "2026-11-11T02:00:00.000Z",
    location: "Main stage",
    status: "open",
  },
];

const bookings = [
  {
    slot_id: "slot-1",
    application_id: "application-1",
    approval_status: "confirmed",
  },
];

const applications = [
  {
    id: "application-1",
    school_name: "North High School",
    production_title: "The Music Man",
  },
];

describe("buildUpcomingAdjudications", () => {
  it("flags a confirmed panel when an ACM or adjudicators are missing", () => {
    const [adjudication] = buildUpcomingAdjudications({
      applications,
      bookings,
      currentUserId: "current-user",
      slots,
      staff: [
        {
          slot_id: "slot-1",
          user_id: "adjudicator-1",
          joined_as: "adjudicator",
          participation_mode: "panel",
        },
      ],
    });

    expect(adjudication.acmCount).toBe(0);
    expect(adjudication.adjudicatorCount).toBe(1);
    expect(adjudication.needsAcm).toBe(true);
    expect(adjudication.needsAdjudicators).toBe(true);
  });

  it("counts only panel seats and recognizes the current user's enrollment", () => {
    const staff = [
      {
        slot_id: "slot-1",
        user_id: "current-user",
        joined_as: "advisory_member" as const,
        participation_mode: "panel" as const,
      },
      ...Array.from({ length: REQUIRED_ADJUDICATOR_COUNT }, (_, index) => ({
        slot_id: "slot-1",
        user_id: `adjudicator-${index}`,
        joined_as: "adjudicator" as const,
        participation_mode: "panel" as const,
      })),
      {
        slot_id: "slot-1",
        user_id: "shadow-user",
        joined_as: "adjudicator" as const,
        participation_mode: "shadow" as const,
      },
    ];

    const [adjudication] = buildUpcomingAdjudications({
      applications,
      bookings,
      currentUserId: "current-user",
      slots,
      staff,
    });

    expect(adjudication.acmCount).toBe(1);
    expect(adjudication.adjudicatorCount).toBe(3);
    expect(adjudication.needsAcm).toBe(false);
    expect(adjudication.needsAdjudicators).toBe(false);
    expect(adjudication.currentUserJoined).toBe(true);
  });

  it("does not expose pending bookings as adjudications", () => {
    expect(
      buildUpcomingAdjudications({
        applications,
        bookings: [{ ...bookings[0], approval_status: "pending" }],
        currentUserId: "current-user",
        slots,
        staff: [],
      }),
    ).toEqual([]);
  });

  it("excludes training and group-shadow copies", () => {
    expect(
      buildUpcomingAdjudications({
        applications: [
          {
            ...applications[0],
            school_name: "Group Shadow School 03 — North High Copy",
            production_title: "The Music Man (Training Copy)",
            source_system: "ghsmta-group-shadow-2026-2027",
          },
        ],
        bookings,
        currentUserId: "current-user",
        slots,
        staff: [],
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  canScheduleParticipantUseMode,
  canSelfJoinScheduleSlot,
  scheduleStaffCapacity,
  scheduleSlotHasAdvisoryMember,
  scheduleSlotHasPrimaryAdvisoryMember,
} from "./schedule-staff";

const advisoryParticipant = [
  { role: "advisory_member" as const, participation_mode: "panel" as const },
];

describe("schedule advisory capacity", () => {
  it("detects an advisory member already assigned to a slot", () => {
    expect(scheduleSlotHasAdvisoryMember(advisoryParticipant)).toBe(true);
  });

  it("requires a second advisory member to join as a shadow", () => {
    expect(
      canScheduleParticipantUseMode({
        participants: advisoryParticipant,
        role: "advisory_member",
        participationMode: "panel",
      }),
    ).toBe(false);
    expect(
      canScheduleParticipantUseMode({
        participants: advisoryParticipant,
        role: "advisory_member",
        participationMode: "shadow",
      }),
    ).toBe(true);
  });

  it("still allows adjudicators to join when the advisory seat is filled", () => {
    expect(
      canSelfJoinScheduleSlot({
        currentEnrollment: false,
        isPast: false,
        participants: advisoryParticipant,
        role: "adjudicator",
        status: "open",
        participationMode: "panel",
      }),
    ).toBe(true);
  });

  it("does not treat an advisory shadow as the primary advisory seat", () => {
    const shadowOnly = [
      { role: "advisory_member" as const, participation_mode: "shadow" as const },
    ];

    expect(scheduleSlotHasAdvisoryMember(shadowOnly)).toBe(true);
    expect(scheduleSlotHasPrimaryAdvisoryMember(shadowOnly)).toBe(false);
    expect(
      canScheduleParticipantUseMode({
        participants: shadowOnly,
        role: "advisory_member",
        participationMode: "panel",
      }),
    ).toBe(true);
  });
});

describe("schedule staff capacity", () => {
  it("counts adjudicator panel seats separately from the advisory member", () => {
    const capacity = scheduleStaffCapacity([
      { role: "adjudicator", participation_mode: "panel" },
      { role: "adjudicator", participation_mode: "panel" },
      { role: "adjudicator", participation_mode: "panel" },
      { role: "advisory_member", participation_mode: "panel" },
    ]);

    expect(capacity.adjudicators).toBe(3);
    expect(capacity.advisoryMembers).toBe(1);
    expect(capacity.primaryAdvisoryMembers).toBe(1);
    expect(capacity.adjudicatorsFull).toBe(true);
  });

  it("caps one understudy and three shadows", () => {
    const capacity = scheduleStaffCapacity([
      { role: "adjudicator", participation_mode: "understudy" },
      { role: "adjudicator", participation_mode: "shadow" },
      { role: "adjudicator", participation_mode: "shadow" },
      { role: "adjudicator", participation_mode: "shadow" },
    ]);

    expect(capacity.understudiesFull).toBe(true);
    expect(capacity.shadowsFull).toBe(true);
  });
});

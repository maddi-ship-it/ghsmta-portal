import { describe, expect, it } from "vitest";

import {
  buildActingCandidateSchoolMessage,
  changedActingCandidateSlots,
  extractActingCandidates,
  extractDirectorName,
} from "./acting-candidate-review";
import type { ApplicationReferencePanel } from "./application-reference-panels";

const actingPanel: ApplicationReferencePanel = {
  key: "acting-candidates",
  title: "Individual Acting Category Candidates",
  shortTitle: "ACTING CANDIDATES",
  description: "Submitted candidates",
  groups: [
    {
      title: "Leading Actress",
      items: [
        { label: "Leading Actress Name", value: "Raina Swaminathan" },
        { label: "Leading Actress Pronouns", value: "she/her" },
        { label: "Leading Actress Role", value: "Nancy" },
        { label: "Leading Actress Grade Level", value: "12" },
        { label: "Leading Actress Phonetic Spelling", value: "RAY-nuh" },
      ],
    },
    {
      title: "Featured Performer",
      items: [
        { label: "Featured Performer Name", value: "Kaveri Prashar" },
        { label: "Featured Performer Pronouns", value: "Other" },
        { label: "Featured Performer Pronouns Other", value: "they/them" },
        { label: "Featured Performer Role", value: "Widow Corney" },
      ],
    },
  ],
};

const fullApplicationPanel: ApplicationReferencePanel = {
  key: "full-application",
  title: "Full Application",
  shortTitle: "FULL APPLICATION",
  description: "All responses",
  groups: [
    {
      title: "All application responses",
      items: [
        { label: "Music Director Name", value: "Aleshia Samuel" },
        { label: "Technical Director Name", value: "William Rich" },
        { label: "Director Name", value: "Courtney McClendon" },
        { label: "Director Phonetic Name", value: "Court-nee" },
      ],
    },
  ],
};

describe("acting candidate review", () => {
  it("extracts the canonical roster without using phonetic spelling", () => {
    const candidates = extractActingCandidates([actingPanel]);

    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toMatchObject({
      slot: "leading_actress",
      name: "Raina Swaminathan",
      pronouns: "she/her",
      role: "Nancy",
      gradeLevel: "12",
    });
    expect(candidates[4]).toMatchObject({
      slot: "featured_performer",
      pronouns: "they/them",
      role: "Widow Corney",
    });
    expect(JSON.stringify(candidates)).not.toContain("RAY-nuh");
  });

  it("requires reapproval only for slots whose candidate details changed", () => {
    const original = extractActingCandidates([actingPanel]);
    const updated = original.map((candidate) =>
      candidate.slot === "featured_performer"
        ? { ...candidate, name: "Vee Gonzalez", role: "Donny Kirshner" }
        : candidate,
    );

    expect(changedActingCandidateSlots(original, updated)).toEqual([
      "featured_performer",
    ]);
  });

  it("auto-populates the school director without selecting another director field", () => {
    expect(extractDirectorName([fullApplicationPanel, actingPanel])).toBe(
      "Courtney McClendon",
    );
  });

  it("builds the school message with portal resources and the pronunciation requirement", () => {
    const candidates = extractActingCandidates([actingPanel]).map(
      (candidate) =>
        candidate.slot === "featured_performer"
          ? { ...candidate, name: "Vee Gonzalez", role: "Donny Kirshner" }
          : candidate,
    );
    const message = buildActingCandidateSchoolMessage({
      directorName: "Wesley Smith",
      coordinatorName: "Beth",
      candidates,
      changedSlots: ["featured_performer"],
      sectionDeadline: "March 13, 2027",
      referenceFilesUrl:
        "https://ghsmta.getproductionops.com/portal/reference-documents",
      schoolFilesUrl: "https://ghsmta.getproductionops.com/portal/files",
    });

    expect(message).toContain("Hi Wesley!");
    expect(message).toContain(
      "Featured Performer: Vee Gonzalez as Donny Kirshner",
    );
    expect(message).toContain("Reference Files:");
    expect(message).toContain("re-upload");
    expect(message).toContain("School Files:");
    expect(message).not.toContain("drive.google.com");
    expect(message).not.toContain("Section C");
  });
});

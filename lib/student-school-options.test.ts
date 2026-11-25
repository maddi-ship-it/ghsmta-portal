import { describe, expect, it } from "vitest";

import { isStudentSchoolOption } from "@/lib/student-school-options";

describe("student school options", () => {
  it("keeps real schools", () => {
    expect(isStudentSchoolOption("Blessed Trinity Catholic High School")).toBe(true);
  });

  it("hides demonstration and group-shadow records", () => {
    expect(isStudentSchoolOption("Demo School 01")).toBe(false);
    expect(isStudentSchoolOption("Group Shadow School A")).toBe(false);
    expect(isStudentSchoolOption("Peachtree Arts Academy (TEST)")).toBe(false);
  });

  it("allows local test records when explicitly requested", () => {
    expect(isStudentSchoolOption("Demo School 01", true)).toBe(true);
  });
});

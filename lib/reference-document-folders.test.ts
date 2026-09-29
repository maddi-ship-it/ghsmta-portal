import { describe, expect, it } from "vitest";

import {
  referenceFolderBreadcrumbs,
  referenceFolderCanContainDocument,
  referenceFolderPath,
  referenceItemVisibleToAudience,
  type ReferenceFolder,
} from "./reference-document-folders";

const folders: ReferenceFolder[] = [
  {
    id: "root",
    parent_id: null,
    name: "Scoring",
    visible_to_applicants: false,
    visible_to_adjudicators: true,
    visible_to_advisory: true,
    created_at: "2026-09-28T00:00:00Z",
  },
  {
    id: "child",
    parent_id: "root",
    name: "2026–2027",
    visible_to_applicants: false,
    visible_to_adjudicators: true,
    visible_to_advisory: true,
    created_at: "2026-09-28T00:00:00Z",
  },
];

describe("reference document folders", () => {
  it("builds SharePoint-style breadcrumb paths", () => {
    expect(referenceFolderBreadcrumbs(folders, "child")).toEqual(folders);
    expect(referenceFolderPath(folders, "child")).toBe("Scoring / 2026–2027");
  });

  it("stops safely if malformed folder data contains a cycle", () => {
    const cyclic = [
      { ...folders[0], parent_id: "child" },
      folders[1],
    ];

    expect(referenceFolderBreadcrumbs(cyclic, "child")).toHaveLength(2);
  });

  it("only places a document in a folder covering every document audience", () => {
    expect(
      referenceFolderCanContainDocument(folders[0], {
        visible_to_applicants: false,
        visible_to_adjudicators: true,
        visible_to_advisory: false,
      }),
    ).toBe(true);
    expect(
      referenceFolderCanContainDocument(folders[0], {
        visible_to_applicants: true,
        visible_to_adjudicators: true,
        visible_to_advisory: false,
      }),
    ).toBe(false);
  });

  it("keeps audience navigation role-specific", () => {
    expect(referenceItemVisibleToAudience(folders[0], "adjudicator")).toBe(true);
    expect(referenceItemVisibleToAudience(folders[0], "applicant")).toBe(false);
    expect(referenceItemVisibleToAudience(folders[0], "all")).toBe(true);
  });
});

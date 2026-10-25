import { describe, expect, it } from "vitest";

import {
  mergeReleasedFeedback,
  updateSelectedCategoryIds,
} from "@/lib/adjudication-release";
import type { ReleasedFeedbackSummary } from "@/lib/types";

function feedback(
  categoryId: string,
  sortOrder: number,
  finalComment: string,
): ReleasedFeedbackSummary {
  return {
    category_id: categoryId,
    final_comment: finalComment,
    sort_order: sortOrder,
    title: `Category ${sortOrder}`,
  };
}

describe("mergeReleasedFeedback", () => {
  it("retains earlier releases and adds newly selected comments in rubric order", () => {
    expect(
      mergeReleasedFeedback(
        [feedback("category-3", 3, "Third")],
        [feedback("category-1", 1, "First")],
      ),
    ).toEqual([
      feedback("category-1", 1, "First"),
      feedback("category-3", 3, "Third"),
    ]);
  });

  it("replaces a previously released category without duplicating it", () => {
    expect(
      mergeReleasedFeedback(
        [
          feedback("category-1", 1, "Old first"),
          feedback("category-2", 2, "Second"),
        ],
        [feedback("category-1", 1, "Updated first")],
      ),
    ).toEqual([
      feedback("category-1", 1, "Updated first"),
      feedback("category-2", 2, "Second"),
    ]);
  });
});

describe("updateSelectedCategoryIds", () => {
  it("adds the checked category without mutating the prior selection", () => {
    const current = new Set(["category-1"]);
    const next = updateSelectedCategoryIds(current, "category-2", true);

    expect([...current]).toEqual(["category-1"]);
    expect([...next]).toEqual(["category-1", "category-2"]);
  });

  it("removes an unchecked category while preserving other selections", () => {
    const current = new Set(["category-1", "category-2"]);

    expect([
      ...updateSelectedCategoryIds(current, "category-1", false),
    ]).toEqual(["category-2"]);
  });
});

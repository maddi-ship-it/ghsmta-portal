import { describe, expect, it } from "vitest";

import { mergeReleasedFeedback } from "@/lib/adjudication-release";
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

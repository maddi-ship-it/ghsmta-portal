"use client";

import { useEffect, useState } from "react";

import {
  ADJUDICATION_CATEGORY_COMPLETION_EVENT,
  type AdjudicationCategoryCompletionDetail,
} from "@/lib/adjudication-category-completion";

export type CategoryJumpOption = {
  id: string;
  title: string;
};

export function AdjudicationCategoryJumpMenu({
  categories,
  initialCompletedCategoryIds = [],
  showCompletion,
}: {
  categories: CategoryJumpOption[];
  initialCompletedCategoryIds?: string[];
  showCompletion: boolean;
}) {
  const [completedCategoryIds, setCompletedCategoryIds] = useState(
    () => new Set(initialCompletedCategoryIds),
  );

  useEffect(() => {
    if (!showCompletion) return;

    const updateCompletion = (event: Event) => {
      const detail = (
        event as CustomEvent<AdjudicationCategoryCompletionDetail>
      ).detail;

      if (!detail?.categoryId) return;

      setCompletedCategoryIds((current) => {
        const next = new Set(current);
        if (detail.complete) {
          next.add(detail.categoryId);
        } else {
          next.delete(detail.categoryId);
        }
        return next;
      });
    };

    window.addEventListener(
      ADJUDICATION_CATEGORY_COMPLETION_EVENT,
      updateCompletion,
    );

    return () => {
      window.removeEventListener(
        ADJUDICATION_CATEGORY_COMPLETION_EVENT,
        updateCompletion,
      );
    };
  }, [showCompletion]);

  const jumpToCategory = (categoryId: string) => {
    if (!categoryId) return;

    const hash = `#category-${categoryId}`;
    window.history.pushState(null, "", hash);
    window.dispatchEvent(new Event("hashchange"));

    window.requestAnimationFrame(() => {
      document.getElementById(`category-${categoryId}`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  };

  return (
    <select
      aria-label="Jump to category"
      className="application-reference-button application-category-jump-select"
      defaultValue=""
      onChange={(event) => {
        jumpToCategory(event.currentTarget.value);
        event.currentTarget.value = "";
      }}
    >
      <option value="">JUMP TO CATEGORY</option>
      {categories.map((category, index) => {
        const complete =
          showCompletion && completedCategoryIds.has(category.id);

        return (
          <option key={category.id} value={category.id}>
            {complete ? "✓ " : ""}
            {index + 1}. {category.title}
          </option>
        );
      })}
    </select>
  );
}

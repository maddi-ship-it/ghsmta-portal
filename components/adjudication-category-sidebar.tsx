"use client";

import { useEffect, useState } from "react";

import {
  ADJUDICATION_CATEGORY_COMPLETION_EVENT,
  type AdjudicationCategoryCompletionDetail,
} from "@/lib/adjudication-category-completion";

type SidebarCategory = {
  id: string;
  title: string;
};

export function AdjudicationCategorySidebar({
  categories,
  initialCompletedCategoryIds = [],
  showCompletion,
}: {
  categories: SidebarCategory[];
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

  return (
    <aside className="score-category-sidebar">
      <div className="score-category-sidebar-heading">
        <span className="eyebrow">Scorecard</span>
        <h2>Categories</h2>
        <p>Select a category to jump to that section.</p>
      </div>

      <nav className="score-category-tabs" aria-label="Scoring categories">
        {categories.map((category, index) => {
          const complete =
            showCompletion && completedCategoryIds.has(category.id);

          return (
            <a
              className={complete ? "is-complete" : undefined}
              href={`#category-${category.id}`}
              key={category.id}
            >
              <span
                aria-label={
                  complete ? "Category complete" : `Category ${index + 1}`
                }
                className="score-category-marker"
                role="img"
              >
                {complete ? "✓" : index + 1}
              </span>
              <strong>{category.title}</strong>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

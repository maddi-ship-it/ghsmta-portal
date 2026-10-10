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

export function AdjudicationCategoryNavigator({
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
  const [activeCategoryId, setActiveCategoryId] = useState(
    () => categories[0]?.id ?? "",
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

  useEffect(() => {
    let animationFrame = 0;

    const updateActiveCategory = () => {
      animationFrame = 0;

      const ribbonBottom =
        document
          .querySelector<HTMLElement>(".application-reference-bar")
          ?.getBoundingClientRect().bottom ?? 0;
      const sectionMarker = ribbonBottom + 12;
      let currentCategoryId = categories[0]?.id ?? "";

      categories.forEach((category) => {
        const section = document.getElementById(`category-${category.id}`);
        if (section && section.getBoundingClientRect().top <= sectionMarker) {
          currentCategoryId = category.id;
        }
      });

      setActiveCategoryId((current) =>
        current === currentCategoryId ? current : currentCategoryId,
      );
    };

    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateActiveCategory);
    };

    updateActiveCategory();
    window.addEventListener("hashchange", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("hashchange", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
    };
  }, [categories]);

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

  const activeCategoryIndex = Math.max(
    0,
    categories.findIndex((category) => category.id === activeCategoryId),
  );
  const activeCategory = categories[activeCategoryIndex];
  const activeCategoryComplete = Boolean(
    activeCategory &&
      showCompletion &&
      completedCategoryIds.has(activeCategory.id),
  );

  return (
    <div
      aria-label="Category navigation"
      className="application-category-navigator"
    >
      <button
        aria-label="Previous category"
        className="application-reference-button application-category-nav-button"
        disabled={activeCategoryIndex <= 0}
        onClick={() => {
          const category = categories[activeCategoryIndex - 1];
          if (!category) return;
          setActiveCategoryId(category.id);
          jumpToCategory(category.id);
        }}
        type="button"
      >
        ←
      </button>

      <div
        className={`application-category-current${
          activeCategoryComplete ? " is-complete" : ""
        }`}
      >
        <span className="application-category-current-label">
          CURRENT CATEGORY
        </span>
        <select
          aria-label="Jump to category"
          className="application-category-current-select"
          disabled={categories.length === 0}
          onChange={(event) => {
            const categoryId = event.currentTarget.value;
            setActiveCategoryId(categoryId);
            jumpToCategory(categoryId);
          }}
          value={activeCategory?.id ?? ""}
        >
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
        <span aria-hidden="true" className="application-category-current-chevron">
          ▾
        </span>
      </div>

      <button
        aria-label="Next category"
        className="application-reference-button application-category-nav-button"
        disabled={
          !activeCategory || activeCategoryIndex >= categories.length - 1
        }
        onClick={() => {
          const category = categories[activeCategoryIndex + 1];
          if (!category) return;
          setActiveCategoryId(category.id);
          jumpToCategory(category.id);
        }}
        type="button"
      >
        →
      </button>
    </div>
  );
}

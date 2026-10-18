"use client";

import { useEffect, useState } from "react";

import {
  ADJUDICATION_ACTIVE_CATEGORY_EVENT,
  type AdjudicationActiveCategoryDetail,
} from "@/components/adjudication-category-sidebar";

export function AdjudicationScoringGuideHeading({
  initialCategoryTitle,
}: {
  initialCategoryTitle: string;
}) {
  const [activeCategoryTitle, setActiveCategoryTitle] = useState(
    initialCategoryTitle,
  );

  useEffect(() => {
    const updateActiveCategory = (event: Event) => {
      const detail = (
        event as CustomEvent<AdjudicationActiveCategoryDetail>
      ).detail;

      if (detail?.title) setActiveCategoryTitle(detail.title);
    };

    window.addEventListener(
      ADJUDICATION_ACTIVE_CATEGORY_EVENT,
      updateActiveCategory,
    );

    return () => {
      window.removeEventListener(
        ADJUDICATION_ACTIVE_CATEGORY_EVENT,
        updateActiveCategory,
      );
    };
  }, []);

  return (
    <h2 className="score-guide-heading">
      <span>Scoring guide</span>
      <span aria-hidden="true" className="score-guide-heading-divider">
        |
      </span>
      <span className="score-guide-heading-category">
        {activeCategoryTitle || "Active category"}
      </span>
    </h2>
  );
}

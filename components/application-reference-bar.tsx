"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  AdjudicationCategoryJumpMenu,
  type CategoryJumpOption,
} from "@/components/adjudication-category-sidebar";
import { AdjudicationReferenceDocumentModal } from "@/components/adjudication-reference-document-modal";
import type {
  ApplicationReferencePanel,
} from "@/lib/application-reference-panels";
import { formatApplicationReferenceValue } from "@/lib/application-reference-panels";
import type { AdjudicationReferenceLink } from "@/lib/adjudication-reference-documents";

export const OPEN_CATEGORY_REVIEW_EVENT =
  "ghsmta:open-adjudication-category-review";
export const OPEN_PANEL_REVIEW_EVENT =
  "ghsmta:open-adjudication-panel-review";

const PRIMARY_PANEL_ORDER = [
  "eligibility",
  "acting-candidates",
  "musical-budget",
  "program-vision",
] as const;

const REFERENCE_DOCUMENT_BUTTON_LABELS = {
  "scoring-guide": "SCORING GUIDE",
  "evaluative-glossary": "EVALUTIVE GLOSSARY",
} as const;

export function ApplicationReferenceBar({
  categoryNavigation,
  links = [],
  panels,
  reviewActions,
}: {
  categoryNavigation?: {
    categories: CategoryJumpOption[];
    initialCompletedCategoryIds?: string[];
    showCompletion: boolean;
  };
  links?: AdjudicationReferenceLink[];
  panels: ApplicationReferencePanel[];
  reviewActions?: {
    showCategoryReview: boolean;
    showPanelReview: boolean;
  };
}) {
  const [activePanel, setActivePanel] =
    useState<ApplicationReferencePanel | null>(null);
  const panelByKey = new Map(panels.map((panel) => [panel.key, panel]));
  const primaryPanels = PRIMARY_PANEL_ORDER.flatMap((key) => {
    const panel = panelByKey.get(key);
    return panel ? [panel] : [];
  });
  const fullApplicationPanel = panelByKey.get("full-application");

  const panelButton = (panel: ApplicationReferencePanel) => (
    <button
      className="application-reference-button"
      key={panel.key}
      onClick={() => setActivePanel(panel)}
      type="button"
    >
      {panel.shortTitle}
    </button>
  );

  useEffect(() => {
    if (!activePanel) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePanel(null);
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activePanel]);

  return (
    <>
      <div
        className="application-reference-bar"
        aria-label="Application reference views"
      >
        <div className="application-reference-buttons">
          {categoryNavigation ? (
            <>
              <AdjudicationCategoryJumpMenu {...categoryNavigation} />
              <span
                aria-hidden="true"
                className="application-reference-divider"
              />
            </>
          ) : null}

          {primaryPanels.map(panelButton)}

          {primaryPanels.length > 0 && fullApplicationPanel ? (
            <span
              aria-hidden="true"
              className="application-reference-divider"
            />
          ) : null}

          {links.length > 0 ? (
            <AdjudicationReferenceDocumentModal
              buttonClassName="application-reference-button"
              buttonLabels={REFERENCE_DOCUMENT_BUTTON_LABELS}
              links={links}
            />
          ) : null}

          {fullApplicationPanel ? (
            <>
              {links.length > 0 ? (
                <span
                  aria-hidden="true"
                  className="application-reference-divider"
                />
              ) : null}
              {panelButton(fullApplicationPanel)}
            </>
          ) : null}

          {reviewActions?.showCategoryReview ? (
            <>
              <span
                aria-hidden="true"
                className="application-reference-divider"
              />
              {reviewActions.showPanelReview ? (
                <button
                  className="application-reference-button application-reference-review-button"
                  onClick={() =>
                    window.dispatchEvent(new Event(OPEN_PANEL_REVIEW_EVENT))
                  }
                  type="button"
                >
                  Panel review
                </button>
              ) : null}
              <button
                className="application-reference-button application-reference-review-button"
                onClick={() =>
                  window.dispatchEvent(new Event(OPEN_CATEGORY_REVIEW_EVENT))
                }
                type="button"
              >
                Review all categories
              </button>
            </>
          ) : null}
        </div>
      </div>

      {activePanel && createPortal(
        <div
          className="application-reference-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setActivePanel(null);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="application-reference-modal-title"
            aria-modal="true"
            className="application-reference-modal"
            role="dialog"
          >
            <header className="application-reference-modal-header">
              <div>
                <span className="eyebrow">Application data</span>
                <h2 id="application-reference-modal-title">
                  {activePanel.title}
                </h2>
                <p>{activePanel.description}</p>
              </div>

              <button
                aria-label="Close application data"
                className="application-reference-close"
                onClick={() => setActivePanel(null)}
                type="button"
              >
                ×
              </button>
            </header>

            <div className="application-reference-modal-body">
              {activePanel.groups.length > 0 ? (
                activePanel.groups.map((group) => (
                  <section
                    className={`application-reference-group${
                      activePanel.key === "eligibility"
                        ? " application-reference-eligibility-group"
                        : ""
                    }`}
                    key={`${activePanel.key}-${group.title}`}
                  >
                    <h3>{group.title}</h3>

                    {group.items.length > 0 ? (
                      <dl className="application-reference-list">
                        {group.items.map((item, index) => {
                          const formattedValue =
                            formatApplicationReferenceValue(
                              item.label,
                              item.value,
                            );
                          const isEligibility =
                            activePanel.key === "eligibility";
                          const isOverallEligibility =
                            isEligibility &&
                            item.label
                              .toLowerCase()
                              .includes("overall production");

                          return (
                            <div
                              className={`application-reference-row${
                                isOverallEligibility
                                  ? " is-overall-eligibility"
                                  : ""
                              }`}
                              key={`${item.label}-${index}`}
                            >
                              <dt>{item.label}</dt>
                              <dd
                                className={
                                  isEligibility
                                    ? `application-reference-status ${
                                        formattedValue === "True"
                                          ? "is-true"
                                          : formattedValue === "False"
                                            ? "is-false"
                                            : "is-neutral"
                                      }`
                                    : undefined
                                }
                              >
                                {formattedValue}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    ) : (
                      <p className="application-reference-empty">
                        No matching application responses were found.
                      </p>
                    )}
                  </section>
                ))
              ) : (
                <div className="empty-state">
                  <h3>No application data found</h3>
                  <p>
                    This application does not contain responses for this
                    view yet.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>,
        document.querySelector(".portal-shell") ?? document.body,
      )}
    </>
  );
}

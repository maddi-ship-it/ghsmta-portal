"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  AdjudicationCategoryNavigator,
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
export const PANEL_COMMENT_VISIBILITY_EVENT =
  "ghsmta:panel-comment-visibility";

export type PanelCommentVisibilityDetail = {
  currentUserId: string;
  showPeerComments: boolean;
};

export function panelCommentVisibilityStorageKey(currentUserId: string) {
  return `ghsmta:adjudication:peer-comments:v1:${currentUserId}`;
}

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
  categoryWorkflowControl,
  categoryNavigation,
  links = [],
  panelCommentControls,
  panels,
  reviewActions,
  scorecardSubmitControl,
}: {
  categoryWorkflowControl?: ReactNode;
  categoryNavigation?: {
    categories: CategoryJumpOption[];
    initialCompletedCategoryIds?: string[];
    showCompletion: boolean;
  };
  links?: AdjudicationReferenceLink[];
  panelCommentControls?: {
    currentUserId: string;
    peerCount: number;
  };
  panels: ApplicationReferencePanel[];
  reviewActions?: {
    categoryReviewStatus?: "needs-action" | "complete";
    showCategoryReview: boolean;
    showPanelReview: boolean;
  };
  scorecardSubmitControl?: ReactNode;
}) {
  const [activePanel, setActivePanel] =
    useState<ApplicationReferencePanel | null>(null);
  const [showPeerComments, setShowPeerComments] = useState(true);
  const barRef = useRef<HTMLDivElement>(null);
  const panelCommentUserId = panelCommentControls?.currentUserId;
  const panelCommentPeerCount = panelCommentControls?.peerCount ?? 0;
  const panelByKey = new Map(panels.map((panel) => [panel.key, panel]));
  const primaryPanels = PRIMARY_PANEL_ORDER.flatMap((key) => {
    const panel = panelByKey.get(key);
    return panel ? [panel] : [];
  });
  const fullApplicationPanel = panelByKey.get("full-application");

  useEffect(() => {
    if (!panelCommentUserId) return;

    const savedPreference = window.localStorage.getItem(
      panelCommentVisibilityStorageKey(panelCommentUserId),
    );
    const nextVisibility = savedPreference !== "hidden";
    const preferenceTimer = window.setTimeout(() => {
      setShowPeerComments(nextVisibility);
      window.dispatchEvent(
        new CustomEvent<PanelCommentVisibilityDetail>(
          PANEL_COMMENT_VISIBILITY_EVENT,
          {
            detail: {
              currentUserId: panelCommentUserId,
              showPeerComments: nextVisibility,
            },
          },
        ),
      );
    }, 0);

    return () => window.clearTimeout(preferenceTimer);
  }, [panelCommentUserId]);

  const togglePanelComments = () => {
    if (!panelCommentUserId) return;

    const next = !showPeerComments;
    setShowPeerComments(next);
    window.localStorage.setItem(
      panelCommentVisibilityStorageKey(panelCommentUserId),
      next ? "visible" : "hidden",
    );
    window.dispatchEvent(
      new CustomEvent<PanelCommentVisibilityDetail>(
        PANEL_COMMENT_VISIBILITY_EVENT,
        {
          detail: {
            currentUserId: panelCommentUserId,
            showPeerComments: next,
          },
        },
      ),
    );
  };

  const panelCommentControl =
    panelCommentUserId && panelCommentPeerCount > 0 ? (
      <button
        aria-label={`${showPeerComments ? "Hide" : "Show"} ${panelCommentPeerCount} other panel comments`}
        aria-pressed={showPeerComments}
        className="application-reference-button application-reference-panel-comments-button"
        onClick={togglePanelComments}
        type="button"
      >
        <span>Other comments</span>
        <strong>
          {showPeerComments ? "Hide" : "Show"} {panelCommentPeerCount}
        </strong>
      </button>
    ) : null;

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

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const root = document.documentElement;
    const updateStickyOffset = () => {
      const stickyTop = Number.parseFloat(window.getComputedStyle(bar).top) || 0;
      const stickyBottom = Math.ceil(
        stickyTop + bar.getBoundingClientRect().height,
      );
      root.style.setProperty(
        "--application-reference-bar-sticky-bottom",
        `${stickyBottom}px`,
      );
    };

    updateStickyOffset();
    const resizeObserver = new ResizeObserver(updateStickyOffset);
    resizeObserver.observe(bar);
    window.addEventListener("resize", updateStickyOffset);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateStickyOffset);
      root.style.removeProperty("--application-reference-bar-sticky-bottom");
    };
  }, []);

  return (
    <>
      <div
        className="application-reference-bar"
        aria-label="Application reference views"
        ref={barRef}
      >
        <div className="application-reference-buttons">
          {categoryNavigation ? (
            <div className="application-category-navigation-row">
              <AdjudicationCategoryNavigator {...categoryNavigation} />

              {scorecardSubmitControl ||
              categoryWorkflowControl ||
              reviewActions?.showCategoryReview ||
              panelCommentControl ? (
                <div className="application-reference-action-group application-reference-workflow-actions application-category-workflow-actions">
                  {reviewActions?.showCategoryReview ? (
                    <button
                      className={`application-reference-button application-reference-review-button${
                        reviewActions.categoryReviewStatus
                          ? ` application-reference-review-button-${reviewActions.categoryReviewStatus}`
                          : ""
                      }`}
                      onClick={() =>
                        window.dispatchEvent(
                          new Event(OPEN_CATEGORY_REVIEW_EVENT),
                        )
                      }
                      type="button"
                    >
                      Review all categories
                    </button>
                  ) : null}
                  {categoryWorkflowControl}
                  {scorecardSubmitControl}
                  {panelCommentControl}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="application-reference-action-groups">
            {primaryPanels.length > 0 || fullApplicationPanel ? (
              <div
                aria-label="Adjudicator views"
                className="application-reference-action-group"
              >
                <span className="application-reference-group-label">
                  ADJUDICATOR VIEWS
                </span>
                <div className="application-reference-group-buttons">
                  {primaryPanels.map(panelButton)}
                  {fullApplicationPanel
                    ? panelButton(fullApplicationPanel)
                    : null}
                </div>
              </div>
            ) : null}

            {links.length > 0 ? (
              <div
                aria-label="Scoring tools"
                className="application-reference-action-group"
              >
                <span className="application-reference-group-label">
                  SCORING TOOLS
                </span>
                <div className="application-reference-group-buttons">
                  <AdjudicationReferenceDocumentModal
                    buttonClassName="application-reference-button"
                    buttonLabels={REFERENCE_DOCUMENT_BUTTON_LABELS}
                    links={links}
                  />
                </div>
              </div>
            ) : null}

            {reviewActions?.showPanelReview ||
            (!categoryNavigation &&
              (scorecardSubmitControl ||
                categoryWorkflowControl ||
                reviewActions?.showCategoryReview ||
                panelCommentControl)) ? (
              <div className="application-reference-action-group application-reference-workflow-actions">
                {reviewActions?.showPanelReview ? (
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
                {!categoryNavigation && reviewActions?.showCategoryReview ? (
                  <button
                    className={`application-reference-button application-reference-review-button${
                      reviewActions.categoryReviewStatus
                        ? ` application-reference-review-button-${reviewActions.categoryReviewStatus}`
                        : ""
                    }`}
                    onClick={() =>
                      window.dispatchEvent(new Event(OPEN_CATEGORY_REVIEW_EVENT))
                    }
                    type="button"
                  >
                    Review all categories
                  </button>
                ) : null}
                {!categoryNavigation ? categoryWorkflowControl : null}
                {!categoryNavigation ? scorecardSubmitControl : null}
                {!categoryNavigation ? panelCommentControl : null}
              </div>
            ) : null}
          </div>
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
                    }${
                      activePanel.key === "eligibility" &&
                      group.title === "Eligibility appeals"
                        ? " application-reference-appeal-group"
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
                          const isEligibilityAppeal =
                            isEligibility &&
                            item.label.includes("ELIGIBILITY APPEAL");

                          return (
                            <div
                              className={`application-reference-row${
                                isOverallEligibility
                                  ? " is-overall-eligibility"
                                  : ""
                              }${
                                isEligibilityAppeal ? " is-appeal" : ""
                              }`}
                              key={`${item.label}-${index}`}
                            >
                              <dt>{item.label}</dt>
                              <dd
                                className={
                                  isEligibility
                                    ? `application-reference-status ${
                                        formattedValue === "YES"
                                          ? "is-true"
                                          : formattedValue === "NO"
                                            ? "is-false"
                                            : formattedValue.startsWith(
                                                  "APPROVED",
                                                )
                                              ? "is-true"
                                              : formattedValue.startsWith(
                                                    "DENIED",
                                                  )
                                                ? "is-false"
                                                : isEligibilityAppeal
                                                  ? "is-pending"
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

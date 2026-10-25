"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import {
  generateAllPanelNarrativesNow,
  releaseSelectedAdjudicationFeedback,
  sendAllPanelNarrativesToPanel,
} from "@/app/portal/adjudication/[id]/actions";
import { RegalConfirmDialog } from "@/components/regal-confirm-dialog";
import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import { updateSelectedCategoryIds } from "@/lib/adjudication-release";
import type {
  AdjudicationPanelFeedback,
  ScoringCategory,
} from "@/lib/types";

type ReviewDraftStatus =
  | "error"
  | "needs_generation"
  | "panel_approved"
  | "ready"
  | "school_released"
  | "sent";

type ReviewDraft = {
  categoryId: string;
  error: string;
  generatedAt: string;
  status: ReviewDraftStatus;
  title: string;
  value: string;
};

function createReviewDrafts({
  categories,
  feedback,
  panelApprovedCategoryIds,
  releasedCategoryIds,
}: {
  categories: ScoringCategory[];
  feedback: AdjudicationPanelFeedback[];
  panelApprovedCategoryIds: Set<string>;
  releasedCategoryIds: Set<string>;
}) {
  const feedbackByCategory = new Map(
    feedback.map((item) => [item.category_id, item]),
  );

  return categories
    .filter(
      (category) =>
        category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY,
    )
    .map((category): ReviewDraft => {
      const categoryFeedback = feedbackByCategory.get(category.id);
      const value =
        categoryFeedback?.final_comment?.trim() ||
        categoryFeedback?.generated_comment?.trim() ||
        "";
      const panelApproved = panelApprovedCategoryIds.has(category.id);
      const schoolReleased = releasedCategoryIds.has(category.id);
      const sent = categoryFeedback?.status === "approved";

      return {
        categoryId: category.id,
        error: "",
        generatedAt: categoryFeedback?.generated_at ?? "",
        status: schoolReleased
          ? "school_released"
          : panelApproved
            ? "panel_approved"
          : sent
            ? "sent"
            : value && categoryFeedback?.generated_at
              ? "ready"
              : "needs_generation",
        title: category.title,
        value,
      };
    });
}

function statusLabel(status: ReviewDraftStatus) {
  if (status === "school_released") return "Released to school";
  if (status === "panel_approved") return "Panel approved";
  if (status === "sent") return "Sent to panel";
  if (status === "ready") return "Ready for Owner review";
  if (status === "error") return "Needs attention";
  return "Not generated";
}

function statusDetail(status: ReviewDraftStatus) {
  if (status === "school_released") return "Visible to the school";
  if (status === "panel_approved") return "Ready for school release";
  if (status === "sent") return "Waiting for panel approval";
  if (status === "ready") return "Owner draft ready to review";
  if (status === "error") return "Resolve before continuing";
  return "Generate an Owner draft";
}

export function OwnerCommentReviewModal({
  applicationId,
  categories,
  feedback,
  panelApprovedCategoryIds,
  releasedCategoryIds,
}: {
  applicationId: string;
  categories: ScoringCategory[];
  feedback: AdjudicationPanelFeedback[];
  panelApprovedCategoryIds: string[];
  releasedCategoryIds: string[];
}) {
  const router = useRouter();
  const reactId = useId();
  const titleId = `owner-comment-review-${reactId.replaceAll(":", "")}`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const releaseConfirmationRef = useRef(false);
  const approvedCategoryIds = useMemo(
    () => new Set(panelApprovedCategoryIds),
    [panelApprovedCategoryIds],
  );
  const releasedIds = useMemo(
    () => new Set(releasedCategoryIds),
    [releasedCategoryIds],
  );
  const initialDrafts = useMemo(
    () =>
      createReviewDrafts({
        categories,
        feedback,
        panelApprovedCategoryIds: approvedCategoryIds,
        releasedCategoryIds: releasedIds,
      }),
    [approvedCategoryIds, categories, feedback, releasedIds],
  );
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [message, setMessage] = useState("");
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showReleaseConfirmation, setShowReleaseConfirmation] = useState(false);
  const [isGenerating, startGeneration] = useTransition();
  const [isReleasing, startRelease] = useTransition();
  const [isSending, startSending] = useTransition();

  useEffect(() => {
    releaseConfirmationRef.current = showReleaseConfirmation;
  }, [showReleaseConfirmation]);

  useEffect(() => {
    if (!open) return;

    const triggerElement = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !releaseConfirmationRef.current) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      triggerElement?.focus();
    };
  }, [open]);

  const readyDrafts = drafts.filter(
    (draft) =>
      draft.status === "ready" &&
      Boolean(draft.value.trim()) &&
      Boolean(draft.generatedAt),
  );
  const unresolvedDrafts = drafts.filter(
    (draft) =>
      draft.status === "needs_generation" || draft.status === "error",
  );
  const completedCount = drafts.filter(
    (draft) =>
      draft.status === "sent" ||
      draft.status === "panel_approved" ||
      draft.status === "school_released",
  ).length;
  const releasedCount = drafts.filter(
    (draft) => draft.status === "school_released",
  ).length;
  const panelApprovedCount = drafts.filter(
    (draft) => draft.status === "panel_approved",
  ).length;
  const waitingOnPanelCount = drafts.filter(
    (draft) => draft.status === "sent",
  ).length;
  const ownerWorkCount = drafts.filter((draft) =>
    ["error", "needs_generation", "ready"].includes(draft.status),
  ).length;
  const releaseCandidates = drafts.filter(
    (draft) => draft.status === "panel_approved",
  );
  const allReleaseCandidatesSelected =
    releaseCandidates.length > 0 &&
    releaseCandidates.every((draft) => selectedReleaseIds.has(draft.categoryId));
  const allCommentsExpanded =
    drafts.length > 0 &&
    drafts.every((draft) => expandedCategoryIds.has(draft.categoryId));
  const canSendAll =
    readyDrafts.length > 0 &&
    unresolvedDrafts.length === 0 &&
    readyDrafts.length + completedCount === drafts.length;

  const openReview = () => {
    setDrafts(initialDrafts);
    setMessage("");
    setSelectedReleaseIds(new Set());
    setExpandedCategoryIds(
      new Set(initialDrafts.slice(0, 1).map((draft) => draft.categoryId)),
    );
    setShowReleaseConfirmation(false);
    setOpen(true);
  };

  const generateAll = () => {
    setMessage("Generating all Owner drafts from the latest saved panel comments…");
    startGeneration(async () => {
      const result = await generateAllPanelNarrativesNow(applicationId);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      const resultByCategory = new Map(
        result.results.map((item) => [item.categoryId, item]),
      );
      setDrafts((current) =>
        current.map((draft) => {
          const generated = resultByCategory.get(draft.categoryId);
          if (!generated) return draft;
          if (generated.status === "skipped") {
            return draft.status === "panel_approved" ||
              draft.status === "school_released"
              ? { ...draft, error: "" }
              : { ...draft, error: "", status: "sent" };
          }
          if (generated.status === "error") {
            return {
              ...draft,
              error: generated.error ?? "Unable to generate this comment.",
              status: "error",
            };
          }

          return {
            ...draft,
            error: "",
            generatedAt: generated.generatedAt ?? "",
            status: "ready",
            value: generated.generatedComment ?? "",
          };
        }),
      );

      const generatedCount = result.results.filter(
        (item) => item.status === "generated",
      ).length;
      const errorCount = result.results.filter(
        (item) => item.status === "error",
      ).length;
      setMessage(
        errorCount
          ? `${generatedCount} comments generated. ${errorCount} need attention before everything can be sent.`
          : `${generatedCount} comments generated. Review the drafts, then send them to the panel.`,
      );
      router.refresh();
    });
  };

  const sendAll = () => {
    setMessage("Sending all reviewed comments to the panel…");
    startSending(async () => {
      const result = await sendAllPanelNarrativesToPanel(
        applicationId,
        readyDrafts.map((draft) => ({
          categoryId: draft.categoryId,
          finalComment: draft.value,
          generatedAt: draft.generatedAt,
        })),
      );
      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      const sentCategoryIds = new Set(
        readyDrafts.map((draft) => draft.categoryId),
      );
      setDrafts((current) =>
        current.map((draft) =>
          sentCategoryIds.has(draft.categoryId)
            ? { ...draft, error: "", status: "sent" }
            : draft,
        ),
      );
      setMessage(
        `${result.sentCount} comments were sent to the panel for review.`,
      );
      router.refresh();
    });
  };

  const releaseSelected = () => {
    const categoryIds = [...selectedReleaseIds];
    setShowReleaseConfirmation(false);
    setMessage("Releasing the selected comments to the school…");
    startRelease(async () => {
      const result = await releaseSelectedAdjudicationFeedback(
        applicationId,
        categoryIds,
      );
      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      const released = new Set(result.releasedCategoryIds);
      setDrafts((current) =>
        current.map((draft) =>
          released.has(draft.categoryId)
            ? { ...draft, error: "", status: "school_released" }
            : draft,
        ),
      );
      setSelectedReleaseIds(new Set());
      setMessage(
        `${result.releasedCount} ${
          result.releasedCount === 1 ? "comment is" : "comments are"
        } now visible to the school. Scores remain private.`,
      );
      router.refresh();
    });
  };

  const busy = isGenerating || isReleasing || isSending;

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="button button-dark"
        onClick={openReview}
        ref={triggerRef}
        type="button"
      >
        Review all comments
      </button>

      {open
        ? createPortal(
            <div
              className="application-reference-modal-backdrop"
              onMouseDown={(event) => {
                if (
                  event.currentTarget === event.target &&
                  !busy
                ) {
                  setOpen(false);
                }
              }}
              role="presentation"
            >
              <section
                aria-labelledby={titleId}
                aria-modal="true"
                className="application-reference-modal owner-comment-review-modal"
                role="dialog"
              >
                <header className="application-reference-modal-header">
                  <div>
                    <span className="eyebrow">Owner comment review</span>
                    <h2 id={titleId}>Panel comment review</h2>
                    <p>
                      Review panel comments and choose what the school can see
                      now. Scores stay private.
                    </p>
                  </div>
                  <button
                    aria-label="Close comment review"
                    className="application-reference-close"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                    ref={closeButtonRef}
                    type="button"
                  >
                    ×
                  </button>
                </header>

                <div className="application-reference-modal-body owner-comment-review-body">
                  <div className="owner-comment-review-overview">
                    <div
                      aria-label="Comment review status"
                      className="owner-comment-review-status-chips"
                    >
                      <span>
                        <strong>{drafts.length}</strong> Total
                      </span>
                      <span>
                        <strong>{ownerWorkCount}</strong> Owner work
                      </span>
                      <span>
                        <strong>{waitingOnPanelCount}</strong> With panel
                      </span>
                      <span className="is-approved">
                        <strong>{panelApprovedCount}</strong> Approved
                      </span>
                      <span className="is-released">
                        <strong>{releasedCount}</strong> Released
                      </span>
                    </div>
                    <div className="owner-comment-review-controls">
                      <button
                        className="button button-secondary button-compact"
                        disabled={busy || releaseCandidates.length === 0}
                        onClick={() => {
                          setSelectedReleaseIds(
                            allReleaseCandidatesSelected
                              ? new Set()
                              : new Set(
                                  releaseCandidates.map(
                                    (draft) => draft.categoryId,
                                  ),
                                ),
                          );
                        }}
                        type="button"
                      >
                        {allReleaseCandidatesSelected
                          ? "Clear selection"
                          : "Select all approved"}
                      </button>
                      <strong aria-live="polite">
                        {selectedReleaseIds.size} selected
                      </strong>
                      <span className="owner-comment-review-control-divider" />
                      <button
                        className="button button-secondary button-compact"
                        disabled={busy || drafts.length === 0}
                        onClick={() => {
                          setExpandedCategoryIds(
                            allCommentsExpanded
                              ? new Set()
                              : new Set(
                                  drafts.map((draft) => draft.categoryId),
                                ),
                          );
                        }}
                        type="button"
                      >
                        {allCommentsExpanded ? "Collapse all" : "Expand all"}
                      </button>
                      {ownerWorkCount > 0 ? (
                        <button
                          className="button button-dark button-compact"
                          disabled={busy}
                          onClick={generateAll}
                          type="button"
                        >
                          {isGenerating
                            ? "Generating…"
                            : "Generate Owner drafts"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {message ? (
                    <div
                      aria-live="polite"
                      className="owner-comment-review-message"
                    >
                      {message}
                    </div>
                  ) : null}

                  <div className="owner-comment-review-list">
                    {drafts.map((draft) => {
                      const editable = draft.status === "ready";
                      const canRelease = draft.status === "panel_approved";
                      const expanded = expandedCategoryIds.has(
                        draft.categoryId,
                      );
                      return (
                        <article
                          className={`owner-comment-review-item owner-comment-review-item-${draft.status}${
                            selectedReleaseIds.has(draft.categoryId)
                              ? " owner-comment-review-item-selected"
                              : ""
                          }`}
                          key={draft.categoryId}
                        >
                          <div className="owner-comment-review-item-header">
                            {canRelease ? (
                              <label
                                className="owner-comment-review-select"
                                title={`Select ${draft.title} for school release`}
                              >
                              <input
                                aria-label={`Select ${draft.title} for school release`}
                                checked={selectedReleaseIds.has(
                                  draft.categoryId,
                                )}
                                disabled={busy}
                                onChange={(event) => {
                                  const checked = event.currentTarget.checked;
                                  setSelectedReleaseIds((current) =>
                                    updateSelectedCategoryIds(
                                      current,
                                      draft.categoryId,
                                      checked,
                                    ),
                                  );
                                }}
                                type="checkbox"
                              />
                                <span aria-hidden="true" />
                              </label>
                            ) : draft.status === "school_released" ? (
                              <span
                                aria-label="Released to school"
                                className="owner-comment-review-state-icon is-released"
                                role="img"
                              >
                                ✓
                              </span>
                            ) : (
                              <span
                                aria-hidden="true"
                                className="owner-comment-review-state-icon"
                              >
                                •
                              </span>
                            )}
                            <button
                              aria-controls={`owner-comment-body-${draft.categoryId}`}
                              aria-expanded={expanded}
                              className="owner-comment-review-item-toggle"
                              onClick={() => {
                                setExpandedCategoryIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(draft.categoryId)) {
                                    next.delete(draft.categoryId);
                                  } else {
                                    next.add(draft.categoryId);
                                  }
                                  return next;
                                });
                              }}
                              type="button"
                            >
                              <span className="owner-comment-review-item-copy">
                                <strong>{draft.title}</strong>
                                <small>{statusDetail(draft.status)}</small>
                              </span>
                              <span
                                className={`badge ${
                                  draft.status === "panel_approved" ||
                                  draft.status === "school_released"
                                    ? "badge-complete"
                                    : "badge-warning"
                                }`}
                              >
                                {statusLabel(draft.status)}
                              </span>
                              <span
                                aria-hidden="true"
                                className={`owner-comment-review-chevron${
                                  expanded ? " is-expanded" : ""
                                }`}
                              >
                                ⌄
                              </span>
                            </button>
                          </div>
                          {expanded ? (
                            <div
                              className="owner-comment-review-item-body"
                              id={`owner-comment-body-${draft.categoryId}`}
                            >
                              {editable ? (
                                <>
                                  <label
                                    className="owner-comment-review-field-label"
                                    htmlFor={`owner-comment-${draft.categoryId}`}
                                  >
                                    School-facing comment
                                  </label>
                                  <textarea
                                    className="textarea owner-comment-review-textarea"
                                    disabled={busy}
                                    id={`owner-comment-${draft.categoryId}`}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setDrafts((current) =>
                                        current.map((item) =>
                                          item.categoryId === draft.categoryId
                                            ? { ...item, value }
                                            : item,
                                        ),
                                      );
                                    }}
                                    placeholder="Generate this category comment to begin review."
                                    value={draft.value}
                                  />
                                </>
                              ) : (
                                <>
                                  <span className="owner-comment-review-field-label">
                                    School-facing comment
                                  </span>
                                  <div className="owner-comment-review-comment-copy">
                                    {draft.value || "No comment available yet."}
                                  </div>
                                </>
                              )}
                              {draft.error ? (
                                <p className="form-error">{draft.error}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>

                  <footer className="owner-comment-review-footer">
                    <div className="owner-comment-review-footer-copy">
                      <strong>
                        {selectedReleaseIds.size > 0
                          ? `${selectedReleaseIds.size} ready to release`
                          : "Choose approved comments to release"}
                      </strong>
                      <span>Scores and unselected comments stay private.</span>
                    </div>
                    <div className="button-row">
                      <button
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setOpen(false)}
                        type="button"
                      >
                        Close
                      </button>
                      {readyDrafts.length > 0 ? (
                        <button
                          className="button button-dark"
                          disabled={!canSendAll || busy}
                          onClick={sendAll}
                          type="button"
                        >
                          {isSending
                            ? "Sending…"
                            : "Send ready set to panel"}
                        </button>
                      ) : null}
                      <button
                        className="button button-gold"
                        disabled={selectedReleaseIds.size === 0 || busy}
                        onClick={() => setShowReleaseConfirmation(true)}
                        type="button"
                      >
                        {isReleasing
                          ? "Releasing…"
                          : `Release selected (${selectedReleaseIds.size})`}
                      </button>
                    </div>
                  </footer>
                </div>
              </section>
            </div>,
            document.querySelector(".portal-shell") ?? document.body,
          )
        : null}

      <RegalConfirmDialog
        confirmLabel={`Release ${selectedReleaseIds.size} ${
          selectedReleaseIds.size === 1 ? "comment" : "comments"
        }`}
        description="The selected comments will become immediately visible to the school. Scores and unselected comments will remain private until a later release."
        onCancel={() => setShowReleaseConfirmation(false)}
        onConfirm={releaseSelected}
        open={showReleaseConfirmation}
        pending={isReleasing}
        title="Release selected comments to the school?"
      >
        <div className="owner-comment-release-confirmation">
          <strong>{selectedReleaseIds.size} selected</strong>
          <span>This does not release any scores.</span>
        </div>
      </RegalConfirmDialog>
    </>
  );
}

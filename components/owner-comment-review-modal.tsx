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
  const releaseCandidates = drafts.filter(
    (draft) => draft.status === "panel_approved",
  );
  const allReleaseCandidatesSelected =
    releaseCandidates.length > 0 &&
    releaseCandidates.every((draft) => selectedReleaseIds.has(draft.categoryId));
  const canSendAll =
    readyDrafts.length > 0 &&
    unresolvedDrafts.length === 0 &&
    readyDrafts.length + completedCount === drafts.length;

  const openReview = () => {
    setDrafts(initialDrafts);
    setMessage("");
    setSelectedReleaseIds(new Set());
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
                    <h2 id={titleId}>Review every panel comment</h2>
                    <p>
                      Generate every school-facing category comment, edit the
                      drafts together, send them to the panel, and release
                      selected panel-approved comments to the school.
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
                  <div className="owner-comment-review-summary">
                    <div>
                      <strong>{drafts.length}</strong>
                      <span>Category comments</span>
                    </div>
                    <div>
                      <strong>{readyDrafts.length}</strong>
                      <span>Ready to send</span>
                    </div>
                    <div>
                      <strong>{completedCount}</strong>
                      <span>Already with panel</span>
                    </div>
                    <div>
                      <strong>{releasedCount}</strong>
                      <span>Released to school</span>
                    </div>
                  </div>

                  <div className="owner-comment-review-toolbar">
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={generateAll}
                      type="button"
                    >
                      {isGenerating ? "Generating all comments…" : "Generate all comments"}
                    </button>
                    <p aria-live="polite">{message}</p>
                  </div>

                  <div className="owner-comment-school-release-toolbar">
                    <div>
                      <strong>Early school feedback</strong>
                      <p>
                        Select panel-approved comments to release now. Scores
                        and every unselected comment remain private.
                      </p>
                    </div>
                    <div className="button-row">
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
                      <span aria-live="polite">
                        {selectedReleaseIds.size} selected
                      </span>
                    </div>
                  </div>

                  <div className="owner-comment-review-list">
                    {drafts.map((draft) => {
                      const editable = draft.status === "ready";
                      const canRelease = draft.status === "panel_approved";
                      return (
                        <article
                          className={`owner-comment-review-item owner-comment-review-item-${draft.status}${
                            selectedReleaseIds.has(draft.categoryId)
                              ? " owner-comment-review-item-selected"
                              : ""
                          }`}
                          key={draft.categoryId}
                        >
                          <div className="panel-narrative-card-heading">
                            <h3>{draft.title}</h3>
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
                          </div>
                          {canRelease ? (
                            <label className="owner-comment-release-choice">
                              <input
                                checked={selectedReleaseIds.has(
                                  draft.categoryId,
                                )}
                                disabled={busy}
                                onChange={(event) => {
                                  setSelectedReleaseIds((current) => {
                                    const next = new Set(current);
                                    if (event.currentTarget.checked) {
                                      next.add(draft.categoryId);
                                    } else {
                                      next.delete(draft.categoryId);
                                    }
                                    return next;
                                  });
                                }}
                                type="checkbox"
                              />
                              <span>
                                <strong>Select for school release</strong>
                                <small>
                                  This comment has panel approval and is ready
                                  to share.
                                </small>
                              </span>
                            </label>
                          ) : draft.status === "school_released" ? (
                            <div className="owner-comment-release-complete">
                              <span aria-hidden="true">✓</span>
                              This comment is already visible to the school.
                            </div>
                          ) : null}
                          <label
                            className="owner-comment-review-field-label"
                            htmlFor={`owner-comment-${draft.categoryId}`}
                          >
                            School-facing comment
                          </label>
                          <textarea
                            className="textarea owner-comment-review-textarea"
                            disabled={!editable || busy}
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
                          {draft.error ? (
                            <p className="form-error">{draft.error}</p>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>

                  <footer className="owner-comment-review-footer">
                    <p>
                      Release panel-approved comments individually, or finish
                      every draft before sending the complete set to the panel.
                    </p>
                    <div className="button-row">
                      <button
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setOpen(false)}
                        type="button"
                      >
                        Close
                      </button>
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
                      <button
                        className="button button-dark"
                        disabled={!canSendAll || busy}
                        onClick={sendAll}
                        type="button"
                      >
                        {isSending
                          ? "Sending to panel…"
                          : "Send all comments to panel"}
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

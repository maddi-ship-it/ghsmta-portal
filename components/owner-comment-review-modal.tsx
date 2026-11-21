"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import {
  generateAllPanelNarrativesNow,
  releaseSelectedAdjudicationFeedback,
  sendAllPanelNarrativesToPanel,
  syncOwnerPanelFeedbackDraft,
} from "@/app/portal/adjudication/[id]/actions";
import {
  OPEN_OWNER_COMMENT_REVIEW_EVENT,
} from "@/components/application-reference-bar";
import { RegalConfirmDialog } from "@/components/regal-confirm-dialog";
import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import { updateSelectedCategoryIds } from "@/lib/adjudication-release";
import { acceptdPickSixOrder } from "@/lib/acceptd/pick-six";
import type {
  AdjudicationPanelFeedback,
  Profile,
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
  assignedWriter: string;
  categoryId: string;
  error: string;
  generatedAt: string;
  pickSixOrder: number | null;
  status: ReviewDraftStatus;
  title: string;
  value: string;
};

function createReviewDrafts({
  categories,
  acceptdPickSix,
  feedback,
  panelApprovedCategoryIds,
  profiles,
  releasedCategoryIds,
}: {
  categories: ScoringCategory[];
  acceptdPickSix: string[];
  feedback: AdjudicationPanelFeedback[];
  panelApprovedCategoryIds: Set<string>;
  profiles: Profile[];
  releasedCategoryIds: Set<string>;
}) {
  const feedbackByCategory = new Map(
    feedback.map((item) => [item.category_id, item]),
  );
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

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
      const assignedProfile = categoryFeedback?.assigned_to
        ? profileById.get(categoryFeedback.assigned_to)
        : undefined;

      return {
        assignedWriter:
          assignedProfile?.full_name?.trim() || assignedProfile?.email || "",
        categoryId: category.id,
        error: "",
        generatedAt: categoryFeedback?.generated_at ?? "",
        pickSixOrder: acceptdPickSixOrder(category, acceptdPickSix),
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
  acceptdPickSix = [],
  categories,
  feedback,
  panelApprovedCategoryIds,
  profiles,
  releasedCategoryIds,
  showTrigger = true,
}: {
  applicationId: string;
  acceptdPickSix?: string[];
  categories: ScoringCategory[];
  feedback: AdjudicationPanelFeedback[];
  panelApprovedCategoryIds: string[];
  profiles: Profile[];
  releasedCategoryIds: string[];
  showTrigger?: boolean;
}) {
  const router = useRouter();
  const reactId = useId();
  const titleId = `owner-comment-review-${reactId.replaceAll(":", "")}`;
  const pickSixTitleId = `acceptd-pick-six-${reactId.replaceAll(":", "")}`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const pickSixTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pickSixCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const releaseConfirmationRef = useRef(false);
  const pickSixOpenRef = useRef(false);
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
        acceptdPickSix,
        feedback,
        panelApprovedCategoryIds: approvedCategoryIds,
        profiles,
        releasedCategoryIds: releasedIds,
      }),
    [
      acceptdPickSix,
      approvedCategoryIds,
      categories,
      feedback,
      profiles,
      releasedIds,
    ],
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
  const [dirtyCategoryIds, setDirtyCategoryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showReleaseConfirmation, setShowReleaseConfirmation] = useState(false);
  const [pickSixOpen, setPickSixOpen] = useState(false);
  const [isGenerating, startGeneration] = useTransition();
  const [isReleasing, startRelease] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [isSending, startSending] = useTransition();

  useEffect(() => {
    releaseConfirmationRef.current = showReleaseConfirmation;
  }, [showReleaseConfirmation]);

  useEffect(() => {
    pickSixOpenRef.current = pickSixOpen;
    if (!pickSixOpen) return;

    const triggerElement = pickSixTriggerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      pickSixCloseButtonRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      triggerElement?.focus();
    };
  }, [pickSixOpen]);

  useEffect(() => {
    if (!open) return;

    const triggerElement = returnFocusRef.current ?? triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !releaseConfirmationRef.current) {
        if (pickSixOpenRef.current) {
          setPickSixOpen(false);
        } else {
          setOpen(false);
        }
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

  const openReview = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : triggerRef.current;
    setDrafts(initialDrafts);
    setMessage("");
    setSelectedReleaseIds(new Set());
    setDirtyCategoryIds(new Set());
    setExpandedCategoryIds(
      new Set(initialDrafts.slice(0, 1).map((draft) => draft.categoryId)),
    );
    setShowReleaseConfirmation(false);
    setPickSixOpen(false);
    setOpen(true);
  }, [initialDrafts]);

  useEffect(() => {
    window.addEventListener(OPEN_OWNER_COMMENT_REVIEW_EVENT, openReview);
    return () => {
      window.removeEventListener(OPEN_OWNER_COMMENT_REVIEW_EVENT, openReview);
    };
  }, [openReview]);

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
      setDirtyCategoryIds(new Set());

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
      setDirtyCategoryIds((current) => {
        const next = new Set(current);
        for (const categoryId of sentCategoryIds) next.delete(categoryId);
        return next;
      });
      setMessage(
        `${result.sentCount} comments were sent to the panel for review.`,
      );
      router.refresh();
    });
  };

  const persistDraftEdits = async (onlyCategoryIds?: Set<string>) => {
    const changedDrafts = drafts.filter(
      (draft) =>
        dirtyCategoryIds.has(draft.categoryId) &&
        (!onlyCategoryIds || onlyCategoryIds.has(draft.categoryId)),
    );
    if (changedDrafts.length === 0) return true;

    const invalidDrafts = changedDrafts.filter(
      (draft) => !draft.generatedAt || !draft.value.trim(),
    );
    if (invalidDrafts.length > 0) {
      const invalidIds = new Set(
        invalidDrafts.map((draft) => draft.categoryId),
      );
      setDrafts((current) =>
        current.map((draft) =>
          invalidIds.has(draft.categoryId)
            ? {
                ...draft,
                error: !draft.value.trim()
                  ? "The school-facing comment cannot be blank."
                  : "Generate this comment before editing it.",
              }
            : draft,
        ),
      );
      setMessage("Resolve the highlighted comment before saving.");
      return false;
    }

    const results = await Promise.all(
      changedDrafts.map(async (draft) => {
        const formData = new FormData();
        formData.set("final_comment", draft.value.trim());
        formData.set("source_generated_at", draft.generatedAt);
        if (
          draft.status === "sent" ||
          draft.status === "panel_approved" ||
          draft.status === "school_released"
        ) {
          formData.set("approved", "on");
        }
        const result = await syncOwnerPanelFeedbackDraft(
          applicationId,
          draft.categoryId,
          formData,
        );
        return { categoryId: draft.categoryId, result };
      }),
    );

    const savedIds = new Set(
      results
        .filter((item) => item.result.ok)
        .map((item) => item.categoryId),
    );
    const errorsByCategory = new Map<string, string>();
    for (const item of results) {
      if (!item.result.ok) {
        errorsByCategory.set(item.categoryId, item.result.message);
      }
    }

    setDrafts((current) =>
      current.map((draft) => ({
        ...draft,
        error: savedIds.has(draft.categoryId)
          ? ""
          : errorsByCategory.get(draft.categoryId) ?? draft.error,
      })),
    );
    setDirtyCategoryIds((current) => {
      const next = new Set(current);
      for (const categoryId of savedIds) next.delete(categoryId);
      return next;
    });

    if (errorsByCategory.size > 0) {
      setMessage(
        `${savedIds.size} ${savedIds.size === 1 ? "edit was" : "edits were"} saved. ${errorsByCategory.size} still need attention.`,
      );
      return false;
    }

    setMessage(
      `${savedIds.size} ${savedIds.size === 1 ? "comment edit was" : "comment edits were"} saved. Existing panel approvals were preserved.`,
    );
    router.refresh();
    return true;
  };

  const saveEdits = () => {
    startSaving(async () => {
      await persistDraftEdits();
    });
  };

  const releaseSelected = () => {
    const categoryIds = [...selectedReleaseIds];
    setShowReleaseConfirmation(false);
    setMessage("Releasing the selected comments to the school…");
    startRelease(async () => {
      const editsSaved = await persistDraftEdits(new Set(categoryIds));
      if (!editsSaved) return;

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
        } now visible to the school. Scores remain private. ${
          result.schoolChannelNotified
            ? "The school channel was notified."
            : "The comments were released, but the school-channel notice could not be posted."
        }`,
      );
      router.refresh();
    });
  };

  const busy = isGenerating || isReleasing || isSaving || isSending;

  return (
    <>
      {showTrigger ? (
        <button
          aria-haspopup="dialog"
          className="button button-dark"
          onClick={openReview}
          ref={triggerRef}
          type="button"
        >
          Review all comments
        </button>
      ) : null}

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
                aria-hidden={
                  pickSixOpen || showReleaseConfirmation || undefined
                }
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
                        aria-haspopup="dialog"
                        className="button button-secondary button-compact owner-comment-pick-six-trigger"
                        disabled={busy}
                        onClick={() => setPickSixOpen(true)}
                        ref={pickSixTriggerRef}
                        type="button"
                      >
                        Acceptd Pick 6
                        <span aria-label={`${acceptdPickSix.length} selections`}>
                          {acceptdPickSix.length}
                        </span>
                      </button>
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
                          disabled={busy || dirtyCategoryIds.size > 0}
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
                      const editable = Boolean(draft.generatedAt);
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
                            {draft.pickSixOrder ? (
                              <span
                                aria-label={`Pick 6 selection ${draft.pickSixOrder}`}
                                className="owner-comment-review-pick-six-marker"
                                title={`Pick 6 selection ${draft.pickSixOrder}`}
                              >
                                <small>Pick</small>
                                <strong>{draft.pickSixOrder}</strong>
                              </span>
                            ) : null}
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
                              <span className="owner-comment-review-item-status">
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
                                {draft.assignedWriter ? (
                                  <small>
                                    Writer: <strong>{draft.assignedWriter}</strong>
                                  </small>
                                ) : null}
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
                                    {dirtyCategoryIds.has(draft.categoryId) ? (
                                      <span>Unsaved changes</span>
                                    ) : null}
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
                                            ? { ...item, error: "", value }
                                            : item,
                                        ),
                                      );
                                      setDirtyCategoryIds((current) => {
                                        const next = new Set(current);
                                        next.add(draft.categoryId);
                                        return next;
                                      });
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
                      {dirtyCategoryIds.size > 0 ? (
                        <button
                          className="button button-dark"
                          disabled={busy}
                          onClick={saveEdits}
                          type="button"
                        >
                          {isSaving
                            ? "Saving…"
                            : `Save edits (${dirtyCategoryIds.size})`}
                        </button>
                      ) : null}
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

              {pickSixOpen ? (
                <div
                  className="acceptd-pick-six-backdrop"
                  onMouseDown={(event) => {
                    if (event.currentTarget === event.target) {
                      setPickSixOpen(false);
                    }
                  }}
                  role="presentation"
                >
                  <section
                    aria-labelledby={pickSixTitleId}
                    aria-modal="true"
                    className="acceptd-pick-six-modal"
                    role="dialog"
                  >
                    <header className="acceptd-pick-six-header">
                      <div>
                        <span className="eyebrow">Acceptd application</span>
                        <h2 id={pickSixTitleId}>Early feedback Pick 6</h2>
                        <p>
                          Categories the school selected to receive feedback on
                          within three weeks of adjudication.
                        </p>
                      </div>
                      <button
                        aria-label="Close Acceptd Pick 6"
                        className="application-reference-close"
                        onClick={() => setPickSixOpen(false)}
                        ref={pickSixCloseButtonRef}
                        type="button"
                      >
                        ×
                      </button>
                    </header>
                    <div className="acceptd-pick-six-body">
                      {acceptdPickSix.length > 0 ? (
                        <ol className="acceptd-pick-six-list">
                          {acceptdPickSix.map((selection, index) => (
                            <li key={`${index}-${selection}`}>
                              <span>{index + 1}</span>
                              <strong>{selection}</strong>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="acceptd-pick-six-empty">
                          <strong>No Pick 6 selections found</strong>
                          <p>
                            The latest synced Acceptd application does not
                            contain a Pick 6 selection yet.
                          </p>
                        </div>
                      )}
                    </div>
                    <footer className="acceptd-pick-six-footer">
                      <button
                        className="button button-dark"
                        onClick={() => setPickSixOpen(false)}
                        type="button"
                      >
                        Back to comment review
                      </button>
                    </footer>
                  </section>
                </div>
              ) : null}

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
            </div>,
            document.querySelector(".portal-shell") ?? document.body,
          )
        : null}
    </>
  );
}

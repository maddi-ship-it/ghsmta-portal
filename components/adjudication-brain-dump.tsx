"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  APPLY_ADJUDICATION_BRAIN_DUMP_EVENT,
  groupAdjudicationBrainDumpAssignments,
  RESTORE_ADJUDICATION_BRAIN_DUMP_EVENT,
  type AdjudicationBrainDumpReviewNote,
  type AdjudicationBrainDumpReviewStatus,
  type AdjudicationBrainDumpTarget,
} from "@/lib/adjudication-brain-dump";

type SortResponse = {
  context?: { productionTitle?: string };
  notes?: AdjudicationBrainDumpReviewNote[];
  targets?: AdjudicationBrainDumpTarget[];
  error?: string;
};

type EditableReviewNote = AdjudicationBrainDumpReviewNote & {
  applied: boolean;
  categoryId: string;
  selected: boolean;
};

type BrainDumpReview = {
  lastAppliedNoteIds: string[];
  notes: EditableReviewNote[];
  productionTitle: string;
  targets: AdjudicationBrainDumpTarget[];
  undoValues: Record<string, string> | null;
};

const REVIEW_SECTIONS: Array<{
  description: string;
  status: AdjudicationBrainDumpReviewStatus;
  title: string;
}> = [
  {
    status: "placed",
    title: "Placed",
    description:
      "High-confidence matches. They are selected, but nothing enters the scorecard until you apply them.",
  },
  {
    status: "needs_review",
    title: "Needs review",
    description:
      "Ambiguous or possibly repeated observations. Confirm or change the destination before applying.",
  },
  {
    status: "unsorted",
    title: "Unsorted",
    description:
      "No reliable destination was found. The complete source text remains visible here and in the brain dump.",
  },
];

function statusLabel(status: AdjudicationBrainDumpReviewStatus) {
  if (status === "needs_review") return "Needs review";
  if (status === "unsorted") return "Unsorted";
  return "Placed";
}

function isStoredReview(value: unknown): value is BrainDumpReview {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrainDumpReview>;
  return (
    typeof candidate.productionTitle === "string" &&
    Array.isArray(candidate.lastAppliedNoteIds) &&
    Array.isArray(candidate.notes) &&
    Array.isArray(candidate.targets) &&
    (candidate.undoValues === null ||
      (candidate.undoValues != null &&
        typeof candidate.undoValues === "object" &&
        !Array.isArray(candidate.undoValues)))
  );
}

function loadStoredReview(storageKey: string) {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    return isStoredReview(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildReview(payload: SortResponse): BrainDumpReview | null {
  if (!Array.isArray(payload.notes) || !Array.isArray(payload.targets)) {
    return null;
  }

  const targetByCriterionId = new Map(
    payload.targets.map((target) => [target.criterionId, target]),
  );

  return {
    productionTitle: payload.context?.productionTitle ?? "Untitled production",
    lastAppliedNoteIds: [],
    targets: payload.targets,
    undoValues: null,
    notes: payload.notes.map((note) => ({
      ...note,
      applied: false,
      categoryId: note.criterionId
        ? (targetByCriterionId.get(note.criterionId)?.categoryId ?? "")
        : "",
      selected: note.status === "placed" && Boolean(note.criterionId),
    })),
  };
}

function BrainDumpReviewModal({
  onApply,
  onClose,
  onNoteChange,
  onUndo,
  open,
  review,
}: {
  onApply: () => void;
  onClose: () => void;
  onNoteChange: (
    noteId: string,
    changes: Partial<EditableReviewNote>,
  ) => void;
  onUndo: () => void;
  open: boolean;
  review: BrainDumpReview | null;
}) {
  const reactId = useId();
  const titleId = `brain-dump-review-title-${reactId.replaceAll(":", "")}`;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  const categories = useMemo(() => {
    if (!review) return [];

    const byCategoryId = new Map<
      string,
      {
        id: string;
        order: number;
        subject: string;
        title: string;
      }
    >();
    for (const target of review.targets) {
      if (!byCategoryId.has(target.categoryId)) {
        byCategoryId.set(target.categoryId, {
          id: target.categoryId,
          order: target.categoryOrder,
          subject: target.subject,
          title: target.categoryTitle,
        });
      }
    }

    return [...byCategoryId.values()].sort(
      (left, right) => left.order - right.order,
    );
  }, [review]);

  const targetsByCategoryId = useMemo(() => {
    const grouped = new Map<string, AdjudicationBrainDumpTarget[]>();
    for (const target of review?.targets ?? []) {
      const targets = grouped.get(target.categoryId) ?? [];
      targets.push(target);
      grouped.set(target.categoryId, targets);
    }
    for (const targets of grouped.values()) {
      targets.sort(
        (left, right) => left.criterionOrder - right.criterionOrder,
      );
    }
    return grouped;
  }, [review]);

  if (!open || !review) return null;

  const selectedCount = review.notes.filter(
    (note) => note.selected && note.criterionId && !note.applied,
  ).length;
  const counts = Object.fromEntries(
    REVIEW_SECTIONS.map((section) => [
      section.status,
      review.notes.filter((note) => note.status === section.status).length,
    ]),
  ) as Record<AdjudicationBrainDumpReviewStatus, number>;

  return createPortal(
    <div
      className="application-reference-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="application-reference-modal brain-dump-review-modal"
        role="dialog"
      >
        <header className="application-reference-modal-header">
          <div>
            <span className="eyebrow">Review before applying</span>
            <h2 id={titleId}>Brain-dump sorting review</h2>
            <p>
              {review.productionTitle} · Every numbered source observation is
              shown. Confirm the destinations, then apply only the notes you
              want added to the scorecard.
            </p>
          </div>
          <button
            aria-label="Close brain-dump sorting review"
            className="application-reference-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="application-reference-modal-body brain-dump-review-body">
          <div className="brain-dump-review-summary" aria-label="Sort summary">
            {REVIEW_SECTIONS.map((section) => (
              <div data-status={section.status} key={section.status}>
                <strong>{counts[section.status]}</strong>
                <span>{section.title}</span>
              </div>
            ))}
          </div>

          {REVIEW_SECTIONS.map((section) => {
            const sectionNotes = review.notes.filter(
              (note) => note.status === section.status,
            );

            return (
              <section
                className="brain-dump-review-section"
                key={section.status}
              >
                <div className="brain-dump-review-section-heading">
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.description}</p>
                  </div>
                  <span className="badge">{sectionNotes.length}</span>
                </div>

                {sectionNotes.length === 0 ? (
                  <p className="brain-dump-review-empty">
                    No observations in this section.
                  </p>
                ) : (
                  <div className="brain-dump-review-list">
                    {sectionNotes.map((note) => {
                      const categoryTargets =
                        targetsByCategoryId.get(note.categoryId) ?? [];
                      const canSelect = Boolean(note.criterionId) && !note.applied;

                      return (
                        <article
                          className="brain-dump-review-note"
                          data-status={note.status}
                          key={note.id}
                        >
                          <div className="brain-dump-review-note-source">
                            <span className="brain-dump-review-note-number">
                              {note.number}
                            </span>
                            <div>
                              <p>{note.text}</p>
                              <div className="brain-dump-review-note-badges">
                                <span className="badge">
                                  {statusLabel(note.status)}
                                </span>
                                <span className="badge">
                                  {note.confidence} confidence
                                </span>
                                {note.duplicateOfNoteId ? (
                                  <span className="badge badge-warning">
                                    Possible duplicate of #
                                    {note.duplicateOfNoteId.replace("note-", "")}
                                  </span>
                                ) : null}
                                {note.applied ? (
                                  <span className="badge badge-complete">Applied</span>
                                ) : null}
                              </div>
                              <small>{note.rationale}</small>
                            </div>
                          </div>

                          <div className="brain-dump-review-destination">
                            <label htmlFor={`brain-category-${note.id}`}>
                              Category
                            </label>
                            <select
                              className="select"
                              disabled={note.applied}
                              id={`brain-category-${note.id}`}
                              onChange={(event) => {
                                onNoteChange(note.id, {
                                  categoryId: event.target.value,
                                  criterionId: null,
                                  confidence: "low",
                                  rationale: event.target.value
                                    ? "Category selected; choose the matching criterion."
                                    : "Left unsorted by the adjudicator.",
                                  selected: false,
                                  status: event.target.value
                                    ? note.status
                                    : "unsorted",
                                });
                              }}
                              value={note.categoryId}
                            >
                              <option value="">Leave unsorted</option>
                              {categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.order}. {category.title}
                                  {category.subject
                                    ? ` — ${category.subject}`
                                    : ""}
                                </option>
                              ))}
                            </select>

                            <label htmlFor={`brain-criterion-${note.id}`}>
                              Criterion
                            </label>
                            <select
                              className="select"
                              disabled={!note.categoryId || note.applied}
                              id={`brain-criterion-${note.id}`}
                              onChange={(event) => {
                                const criterionId = event.target.value || null;
                                onNoteChange(note.id, {
                                  criterionId,
                                  confidence: criterionId ? "high" : "low",
                                  rationale: criterionId
                                    ? "Destination confirmed by the adjudicator."
                                    : "Choose a criterion before applying this note.",
                                  selected: Boolean(criterionId),
                                  status: criterionId ? "placed" : "unsorted",
                                });
                              }}
                              value={note.criterionId ?? ""}
                            >
                              <option value="">Choose criterion</option>
                              {categoryTargets.map((target) => (
                                <option
                                  key={target.criterionId}
                                  value={target.criterionId}
                                >
                                  {target.criterionOrder}. {target.criterionTitle}
                                </option>
                              ))}
                            </select>

                            <label className="brain-dump-review-apply-choice">
                              <input
                                checked={note.selected}
                                disabled={!canSelect}
                                onChange={(event) => {
                                  onNoteChange(note.id, {
                                    selected: event.target.checked,
                                  });
                                }}
                                type="checkbox"
                              />
                              Add this observation
                            </label>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <footer className="brain-dump-review-footer">
          <div>
            {review.undoValues ? (
              <button
                className="button button-secondary"
                onClick={onUndo}
                type="button"
              >
                Undo latest apply
              </button>
            ) : null}
          </div>
          <div>
            <button
              className="button button-secondary"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button-gold"
              disabled={selectedCount === 0}
              onClick={onApply}
              type="button"
            >
              Apply {selectedCount} selected
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.querySelector(".portal-shell") ?? document.body,
  );
}

export function AdjudicationBrainDump({
  applicationId,
  defaultValue,
  canComment,
  readOnly,
}: {
  applicationId: string;
  defaultValue: string | null | undefined;
  canComment: boolean;
  readOnly: boolean;
}) {
  const storageKey = `ghsmta:brain-dump-sort-review:v2:${applicationId}`;
  const [value, setValue] = useState(defaultValue ?? "");
  const [expanded, setExpanded] = useState(!(defaultValue ?? "").trim());
  const [sorting, setSorting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<BrainDumpReview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const restoreFrame = window.requestAnimationFrame(() => {
      const storedReview = loadStoredReview(storageKey);
      if (storedReview) {
        setReview((currentReview) => currentReview ?? storedReview);
      }
    });

    return () => window.cancelAnimationFrame(restoreFrame);
  }, [storageKey]);

  const saveReview = (nextReview: BrainDumpReview | null) => {
    setReview(nextReview);
    try {
      if (nextReview) {
        window.sessionStorage.setItem(storageKey, JSON.stringify(nextReview));
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      // The review remains available in memory if browser storage is unavailable.
    }
  };

  const closeReview = useCallback(() => {
    setReviewOpen(false);
    window.requestAnimationFrame(() => sortButtonRef.current?.focus());
  }, []);

  const sortNotes = async () => {
    const notes = value.trim();
    if (!notes || sorting || readOnly || !canComment) return;

    setSorting(true);
    setMessage("Separating and reviewing every source observation…");

    try {
      const response = await fetch("/api/writing-assist/adjudication-sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, notes }),
      });
      const payload = (await response.json().catch(() => null)) as
        | SortResponse
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || "The notes could not be sorted.");
      }

      const nextReview = buildReview(payload ?? {});
      if (!nextReview || nextReview.notes.length === 0) {
        throw new Error("The sorter did not return a reviewable result.");
      }

      const placedCount = nextReview.notes.filter(
        (note) => note.status === "placed",
      ).length;
      const reviewCount = nextReview.notes.filter(
        (note) => note.status === "needs_review",
      ).length;
      const unsortedCount = nextReview.notes.filter(
        (note) => note.status === "unsorted",
      ).length;

      saveReview(nextReview);
      setMessage(
        `${nextReview.notes.length} source observations found: ${placedCount} placed, ${reviewCount} need review, and ${unsortedCount} unsorted. Nothing has been added yet.`,
      );
      setReviewOpen(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The notes could not be sorted.",
      );
    } finally {
      setSorting(false);
    }
  };

  const updateReviewNote = (
    noteId: string,
    changes: Partial<EditableReviewNote>,
  ) => {
    if (!review) return;
    saveReview({
      ...review,
      notes: review.notes.map((note) =>
        note.id === noteId ? { ...note, ...changes } : note,
      ),
    });
  };

  const applySelectedNotes = () => {
    if (!review) return;
    const selectedNotes = review.notes.filter(
      (note) => note.selected && note.criterionId && !note.applied,
    );
    const assignments = groupAdjudicationBrainDumpAssignments(selectedNotes);
    if (assignments.length === 0) return;

    const undoValues: Record<string, string> = {};
    for (const criterionId of new Set(
      assignments.map((assignment) => assignment.criterionId),
    )) {
      const fieldName = `observation_${criterionId}`;
      const field = document.getElementsByName(fieldName)[0];
      undoValues[fieldName] =
        field instanceof HTMLInputElement ? field.value : "";
    }

    window.dispatchEvent(
      new CustomEvent(APPLY_ADJUDICATION_BRAIN_DUMP_EVENT, {
        detail: { assignments },
      }),
    );

    const appliedNoteIds = new Set(selectedNotes.map((note) => note.id));
    const nextReview = {
      ...review,
      lastAppliedNoteIds: [...appliedNoteIds],
      undoValues,
      notes: review.notes.map((note) =>
        appliedNoteIds.has(note.id)
          ? { ...note, applied: true, selected: false }
          : note,
      ),
    };
    saveReview(nextReview);

    const remainingCount = nextReview.notes.filter(
      (note) => !note.applied,
    ).length;
    setMessage(
      `${assignments.length} selected observation${assignments.length === 1 ? " was" : "s were"} sent to the scorecard; existing exact duplicates were skipped. ${remainingCount} source observation${remainingCount === 1 ? " remains" : "s remain"} unapplied.`,
    );
    closeReview();
  };

  const undoLatestApply = () => {
    if (!review?.undoValues) return;
    const latestAppliedNoteIds = new Set(review.lastAppliedNoteIds);
    window.dispatchEvent(
      new CustomEvent(RESTORE_ADJUDICATION_BRAIN_DUMP_EVENT, {
        detail: { values: review.undoValues },
      }),
    );
    saveReview({
      ...review,
      lastAppliedNoteIds: [],
      undoValues: null,
      notes: review.notes.map((note) =>
        latestAppliedNoteIds.has(note.id)
          ? {
              ...note,
              applied: false,
              selected: note.status === "placed" && Boolean(note.criterionId),
            }
          : note,
      ),
    });
    setMessage(
      "The latest applied brain-dump comments were removed. The sorting review is still available.",
    );
  };

  return (
    <>
      <details
        className="panel adjudication-brain-dump"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        open={expanded}
      >
        <summary className="adjudication-brain-dump-summary">
          <span>
            <span className="eyebrow">Private working notes</span>
            <strong>Initial brain dump</strong>
          </span>
          <span className="adjudication-brain-dump-summary-hint">
            Expand / collapse
          </span>
        </summary>

        <div className="panel-body adjudication-brain-dump-body">
          <div className="field">
            <label htmlFor={canComment ? "scorecard_internal_notes" : undefined}>
              Dictate, scan, paste, or type everything you noticed
            </label>
            {canComment ? (
              <textarea
                className="textarea adjudication-brain-dump-input"
                disabled={readOnly}
                id="scorecard_internal_notes"
                maxLength={30000}
                name="scorecard_internal_notes"
                onChange={(event) => {
                  setValue(event.target.value);
                  setMessage(null);
                }}
                placeholder="Capture your unsorted observations here. Focus this box to use Dictate or Scan notes."
                value={value}
              />
            ) : (
              <div className="comment-readonly-surface">
                {value ||
                  "No private notes were entered before commenting was disabled."}
              </div>
            )}
            <small className="field-help">
              These private notes autosave with your scorecard. Auto-sort first
              opens a numbered review and never assigns scores or removes the
              original brain dump.
            </small>
          </div>

          {canComment && !readOnly ? (
            <div className="adjudication-brain-dump-actions">
              <button
                className="button button-gold"
                disabled={!value.trim() || sorting}
                onClick={() => void sortNotes()}
                ref={sortButtonRef}
                type="button"
              >
                {sorting ? "Reviewing…" : "Review auto-sort"}
              </button>
              {review ? (
                <button
                  className="button button-secondary"
                  onClick={() => setReviewOpen(true)}
                  type="button"
                >
                  Review last sort
                </button>
              ) : null}
              {review?.undoValues ? (
                <button
                  className="button button-secondary"
                  onClick={undoLatestApply}
                  type="button"
                >
                  Undo latest apply
                </button>
              ) : null}
              <small>Nothing is added until you review and apply it.</small>
            </div>
          ) : null}

          {message ? (
            <div
              aria-live="polite"
              className="notice adjudication-brain-dump-message"
            >
              {message}
            </div>
          ) : null}
        </div>
      </details>

      <BrainDumpReviewModal
        onApply={applySelectedNotes}
        onClose={closeReview}
        onNoteChange={updateReviewNote}
        onUndo={undoLatestApply}
        open={reviewOpen}
        review={review}
      />
    </>
  );
}

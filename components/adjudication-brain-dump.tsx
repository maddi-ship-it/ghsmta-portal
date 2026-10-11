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
  selectAutomaticallyApplicableBrainDumpNotes,
  type AdjudicationBrainDumpReviewNote,
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
  requiresManualPlacement: boolean;
  selected: boolean;
};

type BrainDumpReview = {
  lastAppliedNoteIds: string[];
  notes: EditableReviewNote[];
  productionTitle: string;
  targets: AdjudicationBrainDumpTarget[];
  undoValues: Record<string, string> | null;
};

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
      requiresManualPlacement: !note.criterionId,
      selected: false,
    })),
  };
}

function captureUndoValues(
  assignments: Array<{ criterionId: string }>,
): Record<string, string> {
  const undoValues: Record<string, string> = {};
  for (const criterionId of new Set(
    assignments.map((assignment) => assignment.criterionId),
  )) {
    const fieldName = `observation_${criterionId}`;
    const field = document.getElementsByName(fieldName)[0];
    undoValues[fieldName] = field instanceof HTMLInputElement ? field.value : "";
  }
  return undoValues;
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

  const unresolvedNotes = review.notes.filter(
    (note) => note.requiresManualPlacement && !note.applied,
  );
  if (unresolvedNotes.length === 0) return null;

  const selectedCount = unresolvedNotes.filter(
    (note) => note.selected && note.criterionId,
  ).length;

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
            <span className="eyebrow">Manual placement needed</span>
            <h2 id={titleId}>Uncategorized observations</h2>
            <p>
              {review.productionTitle} · The matched observations have already
              populated the scorecard. Choose a destination only for the
              observations the sorter could not categorize.
            </p>
          </div>
          <button
            aria-label="Close uncategorized observations"
            className="application-reference-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="application-reference-modal-body brain-dump-review-body">
          <div className="brain-dump-review-section-heading">
            <div>
              <h3>Could not be categorized</h3>
              <p>
                The original wording and source number are preserved. Select a
                category and criterion for any observation you want to add.
              </p>
            </div>
            <span className="badge">{unresolvedNotes.length}</span>
          </div>

          <div className="brain-dump-review-list">
            {unresolvedNotes.map((note) => {
              const categoryTargets =
                targetsByCategoryId.get(note.categoryId) ?? [];
              const canSelect = Boolean(note.criterionId);

              return (
                <article className="brain-dump-review-note" key={note.id}>
                  <div className="brain-dump-review-note-source">
                    <span className="brain-dump-review-note-number">
                      {note.number}
                    </span>
                    <div>
                      <p>{note.text}</p>
                      <small>{note.rationale}</small>
                    </div>
                  </div>

                  <div className="brain-dump-review-destination">
                    <label htmlFor={`brain-category-${note.id}`}>
                      Category
                    </label>
                    <select
                      className="select"
                      id={`brain-category-${note.id}`}
                      onChange={(event) => {
                        onNoteChange(note.id, {
                          categoryId: event.target.value,
                          criterionId: null,
                          confidence: "low",
                          rationale: event.target.value
                            ? "Category selected; choose the matching criterion."
                            : "No destination selected.",
                          selected: false,
                          status: "unsorted",
                        });
                      }}
                      value={note.categoryId}
                    >
                      <option value="">Choose category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.order}. {category.title}
                          {category.subject ? ` — ${category.subject}` : ""}
                        </option>
                      ))}
                    </select>

                    <label htmlFor={`brain-criterion-${note.id}`}>
                      Criterion
                    </label>
                    <select
                      className="select"
                      disabled={!note.categoryId}
                      id={`brain-criterion-${note.id}`}
                      onChange={(event) => {
                        const criterionId = event.target.value || null;
                        onNoteChange(note.id, {
                          criterionId,
                          confidence: criterionId ? "high" : "low",
                          rationale: criterionId
                            ? "Destination selected by the adjudicator."
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
              Close
            </button>
            <button
              className="button button-gold"
              disabled={selectedCount === 0}
              onClick={onApply}
              type="button"
            >
              Add {selectedCount} categorized
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
  const storageKey = `ghsmta:brain-dump-sort-review:v3:${applicationId}`;
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
    setMessage("Separating and categorizing every source observation…");

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

      const automaticallyPlaced =
        selectAutomaticallyApplicableBrainDumpNotes(nextReview.notes);
      const assignments =
        groupAdjudicationBrainDumpAssignments(automaticallyPlaced);
      const undoValues =
        assignments.length > 0 ? captureUndoValues(assignments) : null;

      if (assignments.length > 0) {
        window.dispatchEvent(
          new CustomEvent(APPLY_ADJUDICATION_BRAIN_DUMP_EVENT, {
            detail: { assignments },
          }),
        );
      }

      const appliedNoteIds = new Set(
        automaticallyPlaced.map((note) => note.id),
      );
      const populatedReview: BrainDumpReview = {
        ...nextReview,
        lastAppliedNoteIds: [...appliedNoteIds],
        undoValues,
        notes: nextReview.notes.map((note) =>
          appliedNoteIds.has(note.id)
            ? { ...note, applied: true, selected: false }
            : note,
        ),
      };
      const uncategorizedCount = populatedReview.notes.filter(
        (note) => note.requiresManualPlacement && !note.applied,
      ).length;
      const duplicateCount = populatedReview.notes.filter(
        (note) => Boolean(note.duplicateOfNoteId),
      ).length;

      saveReview(populatedReview);
      setMessage(
        `${assignments.length} categorized observation${assignments.length === 1 ? " was" : "s were"} added automatically. ${uncategorizedCount} observation${uncategorizedCount === 1 ? " could" : "s could"} not be categorized${uncategorizedCount > 0 ? " and need manual placement" : ""}.${duplicateCount > 0 ? ` ${duplicateCount} exact duplicate${duplicateCount === 1 ? " was" : "s were"} skipped.` : ""}`,
      );
      setReviewOpen(uncategorizedCount > 0);
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
      (note) =>
        note.requiresManualPlacement &&
        note.selected &&
        note.criterionId &&
        !note.applied,
    );
    const assignments = groupAdjudicationBrainDumpAssignments(selectedNotes);
    if (assignments.length === 0) return;

    const undoValues = captureUndoValues(assignments);

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
      (note) => note.requiresManualPlacement && !note.applied,
    ).length;
    setMessage(
      `${assignments.length} observation${assignments.length === 1 ? " was" : "s were"} added to the scorecard. ${remainingCount} uncategorized observation${remainingCount === 1 ? " still needs" : "s still need"} a destination.`,
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
              selected:
                note.requiresManualPlacement && Boolean(note.criterionId),
            }
          : note,
      ),
    });
    setMessage(
      "The latest applied brain-dump comments were removed. The sorting review is still available.",
    );
  };

  const uncategorizedCount =
    review?.notes.filter(
      (note) => note.requiresManualPlacement && !note.applied,
    ).length ?? 0;

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
              These private notes autosave with your scorecard. Auto-sort adds
              matched observations to their criterion comments and opens a
              placement window only for observations it cannot categorize. It
              never assigns scores or removes the original brain dump.
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
                {sorting ? "Sorting…" : "Auto-sort comments"}
              </button>
              {uncategorizedCount > 0 ? (
                <button
                  className="button button-secondary"
                  onClick={() => setReviewOpen(true)}
                  type="button"
                >
                  Place {uncategorizedCount} uncategorized
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
              <small>
                Matched comments populate automatically; only unmatched notes
                need your review.
              </small>
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

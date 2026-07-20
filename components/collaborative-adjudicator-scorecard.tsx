"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { respondCategoryProposal } from "@/app/portal/adjudication/[id]/workflow-actions";
import { CategoryScoringControls } from "@/components/category-scoring-controls";
import { RichTextField } from "@/components/rich-text-field";
import { createClient } from "@/lib/supabase/client";
import {
  richTextHasContent,
  sanitizeRichTextHtml,
} from "@/lib/rich-text";
import type {
  AdjudicationCategoryComment,
  AdjudicationScore,
  ScoringCategory,
  ScoringCriterion,
} from "@/lib/types";

type PanelObservationRow = {
  panel_order: number;
  adjudicator_user_id: string;
  adjudicator_name: string;
  criterion_id: string | null;
  observation: string | null;
  updated_at: string | null;
};

type ScoreOption = {
  value: number;
  label: string | null;
};

type PanelMember = {
  userId: string;
  name: string;
  panelOrder: number;
};

type CategoryDecision = {
  eligible: boolean;
  rangeStart: number | null;
};

type CategoryProposal = {
  id: string;
  category_id: string;
  is_eligible: boolean;
  range_min: number | null;
  range_max: number | null;
  status: string;
  advisory_note: string | null;
};

type CategoryApproval = {
  proposal_id: string;
  adjudicator_user_id: string;
  response: string;
  comment: string | null;
};

function RichTextPreview({
  value,
}: {
  value: string | null | undefined;
}) {
  if (!richTextHasContent(value)) {
    return (
      <span className="panel-comment-empty">
        No comment saved yet.
      </span>
    );
  }

  return (
    <div
      className="rich-text-preview panel-criterion-comment-preview"
      dangerouslySetInnerHTML={{
        __html: sanitizeRichTextHtml(value),
      }}
    />
  );
}

function panelMembersFromRows(
  rows: PanelObservationRow[],
  currentUserId: string,
  currentUserName: string,
): PanelMember[] {
  const members = new Map<string, PanelMember>();

  for (const row of rows) {
    if (!members.has(row.adjudicator_user_id)) {
      members.set(row.adjudicator_user_id, {
        userId: row.adjudicator_user_id,
        name: row.adjudicator_name,
        panelOrder: Number(row.panel_order),
      });
    }
  }

  if (!members.has(currentUserId)) {
    members.set(currentUserId, {
      userId: currentUserId,
      name: currentUserName,
      panelOrder: members.size + 1,
    });
  }

  return [...members.values()].sort(
    (a, b) => a.panelOrder - b.panelOrder,
  );
}

function formatAverage(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

function CategoryAverageSummary({
  average,
  allScoresEntered,
  decision,
  rangeMismatch,
  onReviewScores,
}: {
  average: number | null;
  allScoresEntered: boolean;
  decision: CategoryDecision;
  rangeMismatch: boolean;
  onReviewScores: () => void;
}) {
  const rangeEnd =
    decision.rangeStart == null
      ? null
      : Number((decision.rangeStart + 2).toFixed(2));

  return (
    <div
      className={[
        "category-average-summary",
        rangeMismatch ? "category-average-summary-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span>Your category average</span>
      <strong>{formatAverage(average)}</strong>

      {!decision.eligible ? (
        <small>Category marked ineligible</small>
      ) : decision.rangeStart == null || rangeEnd == null ? (
        <small>Select a 2-point range</small>
      ) : !allScoresEntered ? (
        <small>
          Target {decision.rangeStart.toFixed(2)}–{rangeEnd.toFixed(2)} ·
          complete all scores
        </small>
      ) : rangeMismatch ? (
        <>
          <small>
            OUTSIDE {decision.rangeStart.toFixed(2)}–{rangeEnd.toFixed(2)}
            RANGE
          </small>
          <button
            className="category-average-review-button"
            onClick={onReviewScores}
            type="button"
          >
            Modify scores
          </button>
        </>
      ) : (
        <small>
          Within {decision.rangeStart.toFixed(2)}–{rangeEnd.toFixed(2)}
          range
        </small>
      )}
    </div>
  );
}

function CategoryScoreSection({
  category,
  categoryIndex,
  categoryCriteria,
  categoryComment,
  categorySubjectName,
  officialProposal,
  ownApproval,
  applicationId,
  panelMembers,
  observationMap,
  ownScoreMap,
  scoreOptions,
  readOnly,
  currentUserId,
  commentColumnsStyle,
}: {
  category: ScoringCategory;
  categoryIndex: number;
  categoryCriteria: ScoringCriterion[];
  categoryComment: AdjudicationCategoryComment | undefined;
  categorySubjectName: string;
  officialProposal?: CategoryProposal;
  ownApproval?: CategoryApproval;
  applicationId: string;
  panelMembers: PanelMember[];
  observationMap: Map<string, string | null>;
  ownScoreMap: Map<string, AdjudicationScore>;
  scoreOptions: ScoreOption[];
  readOnly: boolean;
  currentUserId: string;
  commentColumnsStyle: CSSProperties;
}) {
  const initialEligible =
    officialProposal?.is_eligible ??
    categoryComment?.is_eligible ??
    categoryComment?.is_applicable ??
    true;

  const [expanded, setExpanded] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(
    ownApproval?.response === "disputed",
  );
  const previousMismatchRef = useRef(false);
  const [decision, setDecision] = useState<CategoryDecision>({
    eligible: initialEligible,
    rangeStart:
      officialProposal?.range_min != null
        ? Number(officialProposal.range_min)
        : categoryComment?.score_range_min == null
          ? null
          : Number(categoryComment.score_range_min),
  });
  const [scoreValues, setScoreValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        categoryCriteria.map((criterion) => {
          const savedScore = ownScoreMap.get(criterion.id)?.score;
          return [
            criterion.id,
            savedScore == null ? "" : String(savedScore),
          ];
        }),
      ),
  );

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === `#category-${category.id}`) {
        setExpanded(true);
      }
    };

    openFromHash();
    window.addEventListener("hashchange", openFromHash);

    return () => {
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [category.id]);

  const numericScores = categoryCriteria
    .map((criterion) => Number(scoreValues[criterion.id]))
    .filter((value) => Number.isFinite(value) && value > 0);

  const allScoresEntered =
    categoryCriteria.length > 0 &&
    numericScores.length === categoryCriteria.length;

  const average =
    numericScores.length === 0
      ? null
      : numericScores.reduce((sum, score) => sum + score, 0) /
        numericScores.length;

  const rangeEnd =
    decision.rangeStart == null
      ? null
      : Number((decision.rangeStart + 2).toFixed(2));

  const rangeMismatch = Boolean(
    decision.eligible &&
      allScoresEntered &&
      average != null &&
      decision.rangeStart != null &&
      rangeEnd != null &&
      (average < decision.rangeStart - 0.0001 ||
        average > rangeEnd + 0.0001),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (rangeMismatch && !previousMismatchRef.current && !readOnly) {
        setReviewOpen(true);
      }

      if (!rangeMismatch) {
        setReviewOpen(false);
      }

      previousMismatchRef.current = rangeMismatch;
    }, 0);

    return () => window.clearTimeout(timer);
  }, [rangeMismatch, readOnly]);

  const updateScore = (criterionId: string, nextValue: string) => {
    setScoreValues((current) => ({
      ...current,
      [criterionId]: nextValue,
    }));
  };

  const decisionResponseState =
    !officialProposal
      ? "awaiting"
      : officialProposal.status === "overridden"
        ? "approved"
        : ownApproval?.response === "approved"
          ? "approved"
          : ownApproval?.response === "disputed"
            ? "disputed"
            : "pending";

  const decisionResponseLabel =
    decisionResponseState === "approved"
      ? officialProposal?.status === "overridden"
        ? "Owner override"
        : "Approved"
      : decisionResponseState === "disputed"
        ? "Disputed"
        : decisionResponseState === "pending"
          ? "Needs approval"
          : "Awaiting panel decision";

  const decisionResponseDetail =
    decisionResponseState === "approved"
      ? officialProposal?.status === "overridden"
        ? "The Owner finalized this eligibility and range."
        : "You approved the eligibility and 2-point range."
      : decisionResponseState === "disputed"
        ? "You disputed the eligibility or 2-point range."
        : decisionResponseState === "pending"
          ? "Review and approve or dispute this panel decision."
          : "The Advisory Committee has not finalized this category.";

  return (
    <section
      className={[
        "panel score-category-panel",
        expanded ? "score-category-panel-expanded" : "score-category-panel-collapsed",
        rangeMismatch ? "score-category-panel-range-error" : "",
        `score-category-panel-decision-${decisionResponseState}`,
      ]
        .filter(Boolean)
        .join(" ")}
      id={`category-${category.id}`}
    >
      <div className="panel-header scoring-category-header">
        <button
          aria-expanded={expanded}
          className="category-collapse-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <span className="category-collapse-icon" aria-hidden="true">
            {expanded ? "−" : "+"}
          </span>
          <span className="scoring-category-heading-copy">
            <span className="section-order">
              Category {categoryIndex + 1}
            </span>
            <strong className="category-collapse-title">{category.title}</strong>
            {category.guidance && <small>{category.guidance}</small>}
          </span>
        </button>

        <div className="scoring-category-header-actions">
          <CategoryAverageSummary
            allScoresEntered={allScoresEntered}
            average={average}
            decision={decision}
            onReviewScores={() => {
              setExpanded(true);
              setReviewOpen(true);
            }}
            rangeMismatch={rangeMismatch}
          />

          <div className="category-decision-controls-stack">
            <CategoryScoringControls
              categoryId={category.id}
              defaultEligible={initialEligible}
              defaultRangeStart={
                officialProposal?.range_min ?? categoryComment?.score_range_min
              }
              disabled={readOnly}
              locked={Boolean(officialProposal)}
              onStateChange={setDecision}
              scoreValues={scoreOptions.map((option) => option.value)}
            />

            <div
              className={[
                "category-decision-response-card",
                `category-decision-response-${decisionResponseState}`,
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className="category-decision-state-dot"
              />

              <div className="category-decision-response-copy">
                <span>Eligibility and 2-point range</span>
                <strong>{decisionResponseLabel}</strong>
                <small>{decisionResponseDetail}</small>
              </div>

              <div className="category-decision-response-status">
                <span
                  className={`badge badge-decision-${decisionResponseState}`}
                >
                  {decisionResponseLabel}
                </span>
              </div>

              {officialProposal &&
                officialProposal.status !== "overridden" && (
                  <div className="category-decision-response-actions">
                    <button
                      className="button button-gold button-compact"
                      formAction={respondCategoryProposal.bind(
                        null,
                        applicationId,
                        officialProposal.id,
                        "approved",
                        `proposal_comment_${category.id}`,
                      )}
                      formNoValidate
                      type="submit"
                    >
                      Approve
                    </button>
                    <button
                      aria-expanded={disputeOpen}
                      className="button button-danger button-compact"
                      onClick={() =>
                        setDisputeOpen((current) => !current)
                      }
                      type="button"
                    >
                      Dispute
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>

      <div className="panel-body" hidden={!expanded}>
        {officialProposal &&
          officialProposal.status !== "overridden" &&
          disputeOpen && (
            <section className="category-dispute-editor">
              <div>
                <p className="eyebrow">Dispute panel decision</p>
                <strong>{officialProposal.is_eligible ? "Eligible" : "Not eligible"}</strong>
                <small>
                  {officialProposal.is_eligible &&
                  officialProposal.range_min != null &&
                  officialProposal.range_max != null
                    ? `${Number(officialProposal.range_min).toFixed(2)}–${Number(officialProposal.range_max).toFixed(2)} range`
                    : "No score range applies"}
                </small>
              </div>

              <div className="field category-dispute-comment-field">
                <label htmlFor={`proposal_comment_${category.id}`}>
                  Why do you disagree?
                </label>
                <input
                  className="input"
                  defaultValue={ownApproval?.comment ?? ""}
                  id={`proposal_comment_${category.id}`}
                  minLength={3}
                  name={`proposal_comment_${category.id}`}
                  placeholder="Explain the eligibility or range concern"
                  required
                />
              </div>

              <div className="category-dispute-editor-actions">
                <button
                  className="button button-danger button-compact"
                  formAction={respondCategoryProposal.bind(
                    null,
                    applicationId,
                    officialProposal.id,
                    "disputed",
                    `proposal_comment_${category.id}`,
                  )}
                  formNoValidate
                  type="submit"
                >
                  Submit dispute
                </button>
                <button
                  className="button button-secondary button-compact"
                  onClick={() => setDisputeOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
        {category.subject_label && (
          <div className="field category-subject-field">
            <label htmlFor={`subject_name_${category.id}`}>
              {category.subject_label}
            </label>
            <input
              className="input category-subject-input"
              id={`subject_name_${category.id}`}
              name={`subject_name_${category.id}`}
              readOnly
              value={
                categoryComment?.subject_name ??
                categorySubjectName
              }
            />
            <small className="field-help">
              Pulled automatically from the school application.
            </small>
          </div>
        )}

        <div className="collaborative-criterion-table">
          <div className="collaborative-criterion-table-header">
            <span>Criterion</span>

            <div
              className="panel-comment-columns panel-comment-column-headings"
              style={commentColumnsStyle}
            >
              {panelMembers.map((member) => (
                <span key={member.userId}>
                  {member.userId === currentUserId
                    ? `${member.name} · You`
                    : member.name}
                </span>
              ))}
            </div>

            <span className="personal-score-heading">Your score</span>
          </div>

          {categoryCriteria.map((criterion) => {
            const savedScore = ownScoreMap.get(criterion.id);

            return (
              <article
                className="collaborative-criterion-row"
                key={criterion.id}
              >
                <div className="criterion-copy">
                  <h3>{criterion.title}</h3>
                  {criterion.description && <p>{criterion.description}</p>}
                </div>

                <div
                  className="panel-comment-columns"
                  style={commentColumnsStyle}
                >
                  {panelMembers.map((member) => {
                    const isCurrentUser = member.userId === currentUserId;
                    const sharedObservation = observationMap.get(
                      `${member.userId}:${criterion.id}`,
                    );

                    return (
                      <div
                        className={[
                          "panel-criterion-comment",
                          isCurrentUser
                            ? "panel-criterion-comment-own"
                            : "panel-criterion-comment-peer",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={member.userId}
                      >
                        {isCurrentUser ? (
                          <RichTextField
                            defaultValue={savedScore?.observation}
                            disabled={readOnly}
                            id={`observation_${criterion.id}`}
                            label={`${member.name} · Your comment`}
                            name={`observation_${criterion.id}`}
                            placeholder="Enter your observable notes for this criterion"
                          />
                        ) : (
                          <>
                            <strong className="mobile-panel-comment-label">
                              {member.name}
                            </strong>
                            <RichTextPreview value={sharedObservation} />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="personal-score-column">
                  <label htmlFor={`score_${criterion.id}`}>Your score</label>
                  <select
                    className="select score-select"
                    disabled={readOnly}
                    id={`score_${criterion.id}`}
                    name={`score_${criterion.id}`}
                    onChange={(event) =>
                      updateScore(criterion.id, event.target.value)
                    }
                    value={scoreValues[criterion.id] ?? ""}
                  >
                    <option value="">—</option>

                    {scoreOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value.toFixed(2)}
                        {option.label ? ` — ${option.label}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </article>
            );
          })}
        </div>

        <details className="private-category-notes">
          <summary>Optional private category notes</summary>
          <div className="field">
            <label htmlFor={`private_notes_${category.id}`}>
              Private adjudicator notes
            </label>
            <textarea
              className="textarea compact-textarea"
              defaultValue={categoryComment?.private_notes ?? ""}
              disabled={readOnly}
              id={`private_notes_${category.id}`}
              name={`private_notes_${category.id}`}
            />
            <small className="field-help">
              Private notes are never included in the school release or sent to
              OpenAI.
            </small>
          </div>
        </details>

      </div>

      {reviewOpen && !readOnly && (
        <div
          className="score-range-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setReviewOpen(false);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby={`range-review-title-${category.id}`}
            aria-modal="true"
            className="score-range-modal"
            role="dialog"
          >
            <div className="score-range-modal-heading">
              <div>
                <span className="eyebrow">Score range check</span>
                <h2 id={`range-review-title-${category.id}`}>
                  Modify {category.title} scores
                </h2>
                <p>
                  Your average is <strong>{formatAverage(average)}</strong>. It
                  must fall within {decision.rangeStart?.toFixed(2)}–
                  {rangeEnd?.toFixed(2)}.
                </p>
              </div>
              <button
                aria-label="Close score review"
                className="score-range-modal-close"
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="score-range-modal-average">
              <span>Current average</span>
              <strong>{formatAverage(average)}</strong>
              <small>
                Required range {decision.rangeStart?.toFixed(2)}–
                {rangeEnd?.toFixed(2)}
              </small>
            </div>

            <div className="score-range-modal-list">
              {categoryCriteria.map((criterion) => (
                <label key={criterion.id}>
                  <span>{criterion.title}</span>
                  <select
                    className="select"
                    onChange={(event) =>
                      updateScore(criterion.id, event.target.value)
                    }
                    value={scoreValues[criterion.id] ?? ""}
                  >
                    <option value="">—</option>
                    {scoreOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value.toFixed(2)}
                        {option.label ? ` — ${option.label}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="score-range-modal-actions">
              {rangeMismatch ? (
                <strong>
                  Adjust the category scores until the average is within the
                  selected range.
                </strong>
              ) : (
                <strong className="score-range-modal-resolved">
                  The category average is now within range.
                </strong>
              )}
              <button
                className="button button-dark"
                disabled={rangeMismatch}
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                Return to scorecard
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export function CollaborativeAdjudicatorScorecard({
  applicationId,
  currentUserId,
  currentUserName,
  categories,
  categorySubjectDefaults,
  criteria,
  ownScores,
  ownComments,
  categoryProposals,
  categoryApprovals,
  initialPanelRows,
  scoreOptions,
  readOnly,
}: {
  applicationId: string;
  currentUserId: string;
  currentUserName: string;
  categories: ScoringCategory[];
  categorySubjectDefaults: Record<string, string>;
  criteria: ScoringCriterion[];
  ownScores: AdjudicationScore[];
  ownComments: AdjudicationCategoryComment[];
  categoryProposals: CategoryProposal[];
  categoryApprovals: CategoryApproval[];
  initialPanelRows: PanelObservationRow[];
  scoreOptions: ScoreOption[];
  readOnly: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [panelRows, setPanelRows] = useState(initialPanelRows);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshError, setRefreshError] = useState(false);

  useEffect(() => {
    let active = true;

    const refreshPanelComments = async () => {
      const { data, error } = await supabase.rpc(
        "get_shared_adjudication_observations",
        { p_application_id: applicationId },
      );

      if (!active) return;

      if (error) {
        setRefreshError(true);
        return;
      }

      setPanelRows((data ?? []) as PanelObservationRow[]);
      setLastRefreshed(new Date());
      setRefreshError(false);
    };

    const timer = window.setInterval(refreshPanelComments, 3000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [applicationId, supabase]);

  const panelMembers = useMemo(
    () =>
      panelMembersFromRows(panelRows, currentUserId, currentUserName),
    [currentUserId, currentUserName, panelRows],
  );

  const observationMap = useMemo(
    () =>
      new Map(
        panelRows
          .filter((row) => row.criterion_id)
          .map((row) => [
            `${row.adjudicator_user_id}:${row.criterion_id}`,
            row.observation,
          ]),
      ),
    [panelRows],
  );

  const ownScoreMap = useMemo(
    () =>
      new Map(ownScores.map((score) => [score.criterion_id, score])),
    [ownScores],
  );

  const ownCommentMap = useMemo(
    () =>
      new Map(
        ownComments.map((comment) => [comment.category_id, comment]),
      ),
    [ownComments],
  );

  const proposalMap = useMemo(
    () => new Map(categoryProposals.map((proposal) => [proposal.category_id, proposal])),
    [categoryProposals],
  );

  const approvalMap = useMemo(
    () => new Map(categoryApprovals.filter((approval) => approval.adjudicator_user_id === currentUserId).map((approval) => [approval.proposal_id, approval])),
    [categoryApprovals, currentUserId],
  );

  const commentColumnsStyle = {
    "--panel-comment-count": Math.max(panelMembers.length, 1),
  } as CSSProperties;

  return (
    <>
      <div
        className={[
          "panel-comment-sync-status",
          refreshError ? "panel-comment-sync-status-error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="status-dot" />
        <div>
          <strong>
            {refreshError
              ? "Unable to refresh panel comments"
              : "Panel comments refresh automatically"}
          </strong>
          <small>
            {lastRefreshed
              ? `Last refreshed ${lastRefreshed.toLocaleTimeString()}`
              : "Waiting for the next panel update…"}
          </small>
        </div>
      </div>

      {categories.map((category, categoryIndex) => (
        <CategoryScoreSection
          category={category}
          categoryComment={ownCommentMap.get(category.id)}
          categoryCriteria={criteria.filter(
            (criterion) => criterion.category_id === category.id,
          )}
          categoryIndex={categoryIndex}
          categorySubjectName={
            categorySubjectDefaults[category.category_key] ?? ""
          }
          officialProposal={proposalMap.get(category.id)}
          ownApproval={proposalMap.get(category.id) ? approvalMap.get(proposalMap.get(category.id)!.id) : undefined}
          applicationId={applicationId}
          commentColumnsStyle={commentColumnsStyle}
          currentUserId={currentUserId}
          key={category.id}
          observationMap={observationMap}
          ownScoreMap={ownScoreMap}
          panelMembers={panelMembers}
          readOnly={readOnly}
          scoreOptions={scoreOptions}
        />
      ))}
    </>
  );
}

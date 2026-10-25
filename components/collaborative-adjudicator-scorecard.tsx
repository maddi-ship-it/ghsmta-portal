"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { respondCategoryProposal } from "@/app/portal/adjudication/[id]/workflow-actions";
import {
  OPEN_CATEGORY_REVIEW_EVENT,
  PANEL_COMMENT_VISIBILITY_EVENT,
  panelCommentVisibilityStorageKey,
  type PanelCommentVisibilityDetail,
} from "@/components/application-reference-bar";
import { CriterionScoringGuideButton } from "@/components/criterion-scoring-guide-button";
import { PanelNarrativeReviewEditor } from "@/components/panel-narrative-review-editor";
import { RichTextField } from "@/components/rich-text-field";
import {
  ADJUDICATION_CATEGORY_COMPLETION_EVENT,
  isAdjudicationCategoryComplete,
} from "@/lib/adjudication-category-completion";
import { categoryDecisionApprovedForUser } from "@/lib/adjudication-category-decisions";
import {
  ADJUDICATION_SCORE_CHANGE_EVENT,
  type AdjudicationScoreChangeDetail,
} from "@/lib/adjudication-score-events";
import { isValidTwoPointRange } from "@/lib/adjudication-ranges";
import {
  calculateOverallProductionScore,
  OVERALL_PRODUCTION_CATEGORY_KEY,
  type OverallProductionScore,
} from "@/lib/adjudication-overall-score";
import { createClient } from "@/lib/supabase/client";
import { roundScoreAverage } from "@/lib/adjudication";
import {
  richTextHasContent,
  sanitizeRichTextHtml,
} from "@/lib/rich-text";
import type {
  AdjudicationCategoryComment,
  AdjudicationPanelFeedback,
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

type PanelNarrativeReviewer = {
  id: string;
  name: string;
  role: "adjudicator" | "advisory_member";
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
  const rounded = roundScoreAverage(value);
  return rounded == null ? "—" : rounded.toFixed(5);
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

      {decision.rangeStart == null || rangeEnd == null ? (
        <small>Awaiting the Committee&apos;s 2-point range</small>
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

function InlinePanelNarrativeReview({
  applicationId,
  category,
  feedback,
  assignedReviewerName,
  currentUserId,
  canComment,
  panelApproved,
  reviewStatus,
}: {
  applicationId: string;
  category: ScoringCategory;
  feedback: AdjudicationPanelFeedback | undefined;
  assignedReviewerName: string | undefined;
  currentUserId: string;
  canComment: boolean;
  panelApproved: boolean;
  reviewStatus: string;
}) {
  const sentToOwners = ["ready_for_owner", "owner_review", "released"].includes(
    reviewStatus,
  );
  const ownerSentComment = Boolean(feedback?.final_comment?.trim());
  const canEdit = Boolean(
    canComment &&
      ownerSentComment &&
      !panelApproved &&
      !sentToOwners &&
      feedback?.assigned_to === currentUserId,
  );

  return (
    <section className="panel-narrative-card inline-panel-narrative-review">
      <div className="panel-narrative-card-heading">
        <div>
          <span className="section-order">Final school-facing comment</span>
          <h3>Final comment for {category.title}</h3>
          <p>
            The final comment stays beside the live brain-dump notes for this
            category.
          </p>
        </div>
        <span
          className={`badge ${panelApproved ? "badge-complete" : "badge-warning"}`}
        >
          {panelApproved
            ? "Panel approved"
            : assignedReviewerName
              ? `Assigned to ${assignedReviewerName}`
              : ownerSentComment
                ? "Needs assignment"
                : "Waiting for Owner"}
        </span>
      </div>

      {assignedReviewerName && (
        <div className="final-comment-assignee">
          <span>Assigned final comment writer</span>
          <strong>{assignedReviewerName}</strong>
        </div>
      )}

      {!ownerSentComment ? (
        <div className="comment-readonly-surface">
          The Owner draft will appear here after an Owner sends it to the
          panel.
        </div>
      ) : canEdit ? (
        <PanelNarrativeReviewEditor
          applicationId={applicationId}
          categoryId={category.id}
          currentUserId={currentUserId}
          generatedAt={feedback?.generated_at ?? ""}
          initialValue={feedback?.final_comment ?? ""}
        />
      ) : (
        <>
          <div className="comment-readonly-surface panel-narrative-preview">
            {feedback?.final_comment}
          </div>
          {!panelApproved && !assignedReviewerName && (
            <p className="field-help">
              An Advisory Committee member must assign a writer before this
              comment can be edited and approved.
            </p>
          )}
          {!panelApproved &&
            assignedReviewerName &&
            feedback?.assigned_to !== currentUserId && (
              <p className="field-help">
                {assignedReviewerName} is responsible for this final comment.
              </p>
            )}
        </>
      )}

    </section>
  );
}

function CategoryScoreSection({
  category,
  categoryCriteria,
  categoryComment,
  categorySubjectName,
  officialProposal,
  ownApproval,
  panelFeedback,
  assignedReviewerName,
  panelApproved,
  reviewStatus,
  applicationId,
  panelMembers,
  observationMap,
  ownScoreMap,
  scoreOptions,
  canComment,
  readOnly,
  currentUserId,
  commentColumnsStyle,
  overallProductionScore,
  productionTitle,
  onScoreChange,
  onPracticeProposalResponse,
  practiceMode,
}: {
  category: ScoringCategory;
  categoryCriteria: ScoringCriterion[];
  categoryComment: AdjudicationCategoryComment | undefined;
  categorySubjectName: string;
  officialProposal?: CategoryProposal;
  ownApproval?: CategoryApproval;
  panelFeedback?: AdjudicationPanelFeedback;
  assignedReviewerName?: string;
  panelApproved: boolean;
  reviewStatus: string;
  applicationId: string;
  panelMembers: PanelMember[];
  observationMap: Map<string, string | null>;
  ownScoreMap: Map<string, AdjudicationScore>;
  scoreOptions: ScoreOption[];
  canComment: boolean;
  readOnly: boolean;
  currentUserId: string;
  commentColumnsStyle: CSSProperties;
  overallProductionScore: OverallProductionScore;
  productionTitle: string;
  onScoreChange: (criterionId: string, value: number | null) => void;
  onPracticeProposalResponse?: (
    proposalId: string,
    response: "approved" | "disputed",
    comment: string | null,
  ) => void;
  practiceMode: boolean;
}) {
  const isOverallProduction =
    category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY;

  const [collapsed, setCollapsed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(
    ownApproval?.response === "disputed",
  );
  const previousMismatchRef = useRef(false);
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
  const [commentValues, setCommentValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        categoryCriteria.map((criterion) => [
          criterion.id,
          ownScoreMap.get(criterion.id)?.observation ?? "",
        ]),
      ),
  );

  const numericScores = categoryCriteria
    .map((criterion) => Number(scoreValues[criterion.id]))
    .filter((value) => Number.isFinite(value) && value > 0);

  const allScoresEntered =
    categoryCriteria.length > 0 &&
    numericScores.length === categoryCriteria.length;

  const average =
    isOverallProduction
      ? overallProductionScore.score
      : numericScores.length === 0
      ? null
      : roundScoreAverage(
          numericScores.reduce((sum, score) => sum + score, 0) /
            numericScores.length,
        );

  const currentDecision: CategoryDecision = {
    rangeStart:
      officialProposal?.range_min == null
        ? null
        : Number(officialProposal.range_min),
  };

  const rangeEnd =
    currentDecision.rangeStart == null
      ? null
      : Number((currentDecision.rangeStart + 2).toFixed(2));

  const rangeMismatch = Boolean(
    !isOverallProduction &&
      allScoresEntered &&
      average != null &&
      currentDecision.rangeStart != null &&
      rangeEnd != null &&
      (average < currentDecision.rangeStart - 0.0001 ||
        average > rangeEnd + 0.0001),
  );

  const proposalRangeIsValid = isValidTwoPointRange(
    officialProposal?.range_min,
    officialProposal?.range_max,
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
    const numericValue = nextValue ? Number(nextValue) : null;
    onScoreChange(
      criterionId,
      numericValue != null && Number.isFinite(numericValue)
        ? numericValue
        : null,
    );
  };

  const updateComment = (criterionId: string, nextValue: string) => {
    setCommentValues((current) => ({
      ...current,
      [criterionId]: nextValue,
    }));
  };

  const decisionResponseState =
    !officialProposal || !proposalRangeIsValid
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
          : "Awaiting Committee";

  const decisionResponseDetail =
    decisionResponseState === "approved"
      ? officialProposal?.status === "overridden"
        ? "The Owner finalized this eligibility and range."
        : "You approved the eligibility and 2-point range."
      : decisionResponseState === "disputed"
        ? "You disputed the eligibility or 2-point range."
      : decisionResponseState === "pending"
          ? "Review and approve or dispute this panel decision."
          : officialProposal
            ? "The Advisory Committee must add a valid 2-point range before this decision can be approved."
            : "The Advisory Committee has not pushed this category decision for approval.";

  const categoryComplete = isAdjudicationCategoryComplete({
    comments: categoryCriteria.map(
      (criterion) => commentValues[criterion.id],
    ),
    requireComments: canComment,
    scores: categoryCriteria.map((criterion) => scoreValues[criterion.id]),
  });

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(ADJUDICATION_CATEGORY_COMPLETION_EVENT, {
        detail: {
          categoryId: category.id,
          complete: categoryComplete,
        },
      }),
    );
  }, [category.id, categoryComplete]);

  return (
    <section
      className={[
        "panel score-category-panel",
        collapsed
          ? "score-category-panel-collapsed"
          : "score-category-panel-expanded",
        rangeMismatch ? "score-category-panel-range-error" : "",
        `score-category-panel-decision-${decisionResponseState}`,
      ]
        .filter(Boolean)
        .join(" ")}
      id={`category-${category.id}`}
    >
      {!isOverallProduction &&
        proposalRangeIsValid &&
        officialProposal?.range_min != null && (
          <input
            name={`score_range_start_${category.id}`}
            type="hidden"
            value={Number(officialProposal.range_min).toFixed(2)}
          />
        )}
      {!isOverallProduction &&
        proposalRangeIsValid &&
        officialProposal &&
        categoryDecisionApprovedForUser({
          proposalStatus: officialProposal.status,
          ownResponse: ownApproval?.response,
        }) && (
          <input
            name={`category_decision_finalized_${category.id}`}
            type="hidden"
            value="1"
          />
        )}

      <div className="panel-header scoring-category-header">
        <button
          aria-controls={`category-body-${category.id}`}
          aria-expanded={!collapsed}
          className="category-collapse-toggle"
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          <span aria-hidden="true" className="category-collapse-icon">
            {collapsed ? "+" : "−"}
          </span>
          <span className="scoring-category-heading-copy scoring-category-context">
            <span className="category-collapse-title">{category.title}</span>
            {category.guidance && <small>{category.guidance}</small>}
          </span>
        </button>

        <div className="scoring-category-header-actions">
          {isOverallProduction ? (
            <div className="category-average-summary category-overall-summary">
              <span>Your derived overall score</span>
              <strong>{formatAverage(overallProductionScore.score)}</strong>
              <small>
                Based on {overallProductionScore.completedCategoryCount} of{" "}
                {overallProductionScore.scoreableCategoryCount} applicable
                categories
              </small>
            </div>
          ) : (
            <CategoryAverageSummary
              allScoresEntered={allScoresEntered}
              average={average}
              decision={currentDecision}
              onReviewScores={() => {
                setReviewOpen(true);
              }}
              rangeMismatch={rangeMismatch}
            />
          )}

          {!isOverallProduction && (
            <section
              aria-labelledby={`category-decision-${category.id}`}
              className={[
                "category-decision-response-card",
                "category-decision-response-header",
                `category-decision-response-${decisionResponseState}`,
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className="category-decision-state-dot"
              />

              <div className="category-decision-response-copy">
                <span>Committee decision for your approval</span>
                <strong id={`category-decision-${category.id}`}>
                  {officialProposal
                    ? officialProposal.is_eligible
                      ? "Eligible"
                      : "Not eligible"
                    : decisionResponseLabel}
                </strong>
                <small>
                  {proposalRangeIsValid && officialProposal
                    ? `${Number(officialProposal.range_min).toFixed(2)}–${Number(
                        officialProposal.range_max,
                      ).toFixed(2)} required range · ${decisionResponseDetail}`
                    : decisionResponseDetail}
                </small>
              </div>

              <div className="category-decision-response-status">
                <span
                  className={`badge badge-decision-${decisionResponseState}`}
                >
                  {decisionResponseLabel}
                </span>
              </div>

              {officialProposal &&
                proposalRangeIsValid &&
                officialProposal.status !== "overridden" && (
                  <div className="category-decision-response-actions">
                    {decisionResponseState === "approved" ? (
                      <button
                        className="button button-gold button-compact"
                        onClick={() =>
                          window.dispatchEvent(
                            new Event(OPEN_CATEGORY_REVIEW_EVENT),
                          )
                        }
                        type="button"
                      >
                        Review all categories
                      </button>
                    ) : practiceMode ? (
                      <button
                        className="button button-gold button-compact"
                        disabled={readOnly}
                        onClick={() =>
                          onPracticeProposalResponse?.(
                            officialProposal.id,
                            "approved",
                            null,
                          )
                        }
                        type="button"
                      >
                        Approve range
                      </button>
                    ) : (
                      <button
                        className="button button-gold button-compact"
                        disabled={readOnly}
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
                        Approve range
                      </button>
                    )}
                    {canComment && (
                      <button
                        aria-expanded={disputeOpen}
                        className="button button-danger button-compact"
                        disabled={readOnly}
                        onClick={() =>
                          setDisputeOpen((current) => !current)
                        }
                        type="button"
                      >
                        Dispute
                      </button>
                    )}
                  </div>
                )}
            </section>
          )}
        </div>
      </div>

      <div
        className="panel-body"
        hidden={collapsed}
        id={`category-body-${category.id}`}
      >
        {category.subject_label && (
          <div className="field category-subject-field">
            <label htmlFor={`subject_name_display_${category.id}`}>
              {category.subject_label}
            </label>
            <output
              className="category-subject-display"
              id={`subject_name_display_${category.id}`}
            >
              {categorySubjectName ||
                categoryComment?.subject_name ||
                "Not provided in the school application."}
            </output>
            <input
              name={`subject_name_${category.id}`}
              type="hidden"
              value={
                categorySubjectName ||
                categoryComment?.subject_name ||
                ""
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
                        {isCurrentUser && canComment ? (
                          <RichTextField
                            defaultValue={savedScore?.observation}
                            disabled={readOnly}
                            id={`observation_${criterion.id}`}
                            label={`${member.name} · Your comment`}
                            name={`observation_${criterion.id}`}
                            onValueChange={(value) =>
                              updateComment(criterion.id, value)
                            }
                            placeholder="Enter your observable notes for this criterion"
                          />
                        ) : isCurrentUser ? (
                          <div className="comment-readonly-surface comment-readonly-observation">
                            <strong className="mobile-panel-comment-label">
                              {member.name} · You
                            </strong>
                            <RichTextPreview value={savedScore?.observation} />
                            <small>Commenting is disabled for this assignment.</small>
                          </div>
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
                  {isOverallProduction ? (
                    <output
                      aria-label="Automatically calculated overall production score"
                      className="derived-score-output"
                    >
                      {formatAverage(overallProductionScore.score)}
                    </output>
                  ) : (
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
                  )}
                  {!isOverallProduction ? (
                    <CriterionScoringGuideButton
                      categoryTitle={category.title}
                      criterionId={criterion.id}
                      criterionTitle={criterion.title}
                      productionTitle={productionTitle}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {canComment &&
          officialProposal &&
          proposalRangeIsValid &&
          officialProposal.status !== "overridden" &&
          disputeOpen && (
            <section className="category-dispute-editor">
              <div>
                <p className="eyebrow">Dispute Committee decision</p>
                <strong>
                  {officialProposal.is_eligible ? "Eligible" : "Not eligible"}
                </strong>
                <small>
                  {Number(officialProposal.range_min).toFixed(2)}–
                  {Number(officialProposal.range_max).toFixed(2)} range
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
                {practiceMode ? (
                  <button
                    className="button button-danger button-compact"
                    onClick={() => {
                      const field = document.getElementById(
                        `proposal_comment_${category.id}`,
                      );
                      if (!(field instanceof HTMLInputElement)) return;
                      if (!field.reportValidity()) return;
                      onPracticeProposalResponse?.(
                        officialProposal.id,
                        "disputed",
                        field.value.trim(),
                      );
                      setDisputeOpen(false);
                    }}
                    type="button"
                  >
                    Submit dispute
                  </button>
                ) : (
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
                )}
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

        {!isOverallProduction && <InlinePanelNarrativeReview
          applicationId={applicationId}
          assignedReviewerName={assignedReviewerName}
          canComment={canComment}
          category={category}
          currentUserId={currentUserId}
          feedback={panelFeedback}
          panelApproved={panelApproved}
          reviewStatus={reviewStatus}
        />}

      </div>

      {reviewOpen && !readOnly && !isOverallProduction && (
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
                  must fall within {currentDecision.rangeStart?.toFixed(2)}–
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

            <div
              className={[
                "score-range-modal-average",
                rangeMismatch
                  ? "score-range-modal-average-error"
                  : "score-range-modal-average-resolved",
              ].join(" ")}
            >
              <span>Current average</span>
              <strong>{formatAverage(average)}</strong>
              <small>
                Required range {currentDecision.rangeStart?.toFixed(2)}–
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
  panelFeedback,
  panelReviewers,
  panelApprovedCategoryIds,
  reviewStatus,
  initialPanelRows,
  activePanelUserIds,
  scoreOptions,
  canComment,
  readOnly,
  afterCategory,
  afterCategoryTitle,
  productionTitle,
  onPracticeProposalResponse,
  practiceMode = false,
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
  panelFeedback: AdjudicationPanelFeedback[];
  panelReviewers: PanelNarrativeReviewer[];
  panelApprovedCategoryIds: string[];
  reviewStatus: string;
  initialPanelRows: PanelObservationRow[];
  activePanelUserIds?: string[];
  scoreOptions: ScoreOption[];
  canComment: boolean;
  readOnly: boolean;
  afterCategory?: ReactNode;
  afterCategoryTitle?: string;
  productionTitle: string;
  onPracticeProposalResponse?: (
    proposalId: string,
    response: "approved" | "disputed",
    comment: string | null,
  ) => void;
  practiceMode?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [panelRows, setPanelRows] = useState(initialPanelRows);
  const [liveCategoryProposals, setLiveCategoryProposals] =
    useState(categoryProposals);
  const [liveCategoryApprovals, setLiveCategoryApprovals] =
    useState(categoryApprovals);
  const [livePanelFeedback, setLivePanelFeedback] = useState(panelFeedback);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [liveConnection, setLiveConnection] = useState(false);
  const [showPeerComments, setShowPeerComments] = useState(true);
  const [liveOwnScoreValues, setLiveOwnScoreValues] = useState<
    Record<string, number | null>
  >(() =>
    Object.fromEntries(
      ownScores.map((score) => [score.criterion_id, score.score]),
    ),
  );
  const refreshTimer = useRef<number | null>(null);

  const refreshWorkspace = useCallback(async () => {
    if (practiceMode) return;

    const [panelResult, proposalResult, feedbackResult] = await Promise.all([
      supabase.rpc("get_shared_adjudication_observations", {
        p_application_id: applicationId,
      }),
      supabase
        .from("adjudication_category_proposals")
        .select(
          "id,category_id,is_eligible,range_min,range_max,status,advisory_note",
        )
        .eq("application_id", applicationId)
        .neq("status", "draft"),
      canComment
        ? supabase
            .from("adjudication_panel_feedback")
            .select("*")
            .eq("application_id", applicationId)
            .eq("status", "approved")
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (panelResult.error || proposalResult.error || feedbackResult.error) {
      setRefreshError(true);
      return;
    }

    const nextProposals = (proposalResult.data ?? []) as CategoryProposal[];
    const proposalIds = nextProposals.map((proposal) => proposal.id);
    const approvalResult = proposalIds.length
      ? await supabase
          .from("adjudication_category_approvals")
          .select("proposal_id,adjudicator_user_id,response,comment")
          .in("proposal_id", proposalIds)
      : { data: [], error: null };

    if (approvalResult.error) {
      setRefreshError(true);
      return;
    }

    setPanelRows((panelResult.data ?? []) as PanelObservationRow[]);
    setLiveCategoryProposals(nextProposals);
    setLiveCategoryApprovals(
      (approvalResult.data ?? []) as CategoryApproval[],
    );
    if (canComment && feedbackResult.data) {
      setLivePanelFeedback(
        feedbackResult.data as AdjudicationPanelFeedback[],
      );
    }
    setLastRefreshed(new Date());
    setRefreshError(false);
  }, [applicationId, canComment, practiceMode, supabase]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(
      () => void refreshWorkspace(),
      100,
    );
  }, [refreshWorkspace]);

  useEffect(() => {
    if (practiceMode) return;

    const initialRefreshTimer = window.setTimeout(
      () => void refreshWorkspace(),
      0,
    );
    const timer = window.setInterval(() => void refreshWorkspace(), 3000);
    const channel = supabase
      .channel(`adjudication-workspace:${applicationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "adjudication_category_proposals",
          filter: `application_id=eq.${applicationId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "adjudication_panel_feedback",
          filter: `application_id=eq.${applicationId}`,
        },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLiveConnection(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLiveConnection(false);
        }
      });

    return () => {
      window.clearTimeout(initialRefreshTimer);
      window.clearInterval(timer);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [applicationId, practiceMode, refreshWorkspace, scheduleRefresh, supabase]);

  const effectiveCategoryProposals = practiceMode
    ? categoryProposals
    : liveCategoryProposals;
  const effectiveCategoryApprovals = practiceMode
    ? categoryApprovals
    : liveCategoryApprovals;
  const effectivePanelFeedback = practiceMode
    ? panelFeedback
    : livePanelFeedback;

  const activePanelUserIdSet = useMemo(
    () =>
      activePanelUserIds
        ? new Set([...activePanelUserIds, currentUserId])
        : null,
    [activePanelUserIds, currentUserId],
  );

  const activePanelRows = useMemo(
    () =>
      activePanelUserIdSet
        ? panelRows.filter((row) =>
            activePanelUserIdSet.has(row.adjudicator_user_id),
          )
        : panelRows,
    [activePanelUserIdSet, panelRows],
  );

  const panelMembers = useMemo(
    () =>
      panelMembersFromRows(
        activePanelRows,
        currentUserId,
        currentUserName,
      ),
    [activePanelRows, currentUserId, currentUserName],
  );

  const visiblePanelMembers = useMemo(
    () =>
      showPeerComments
        ? panelMembers
        : panelMembers.filter((member) => member.userId === currentUserId),
    [currentUserId, panelMembers, showPeerComments],
  );

  useEffect(() => {
    const savedPreference = window.localStorage.getItem(
      panelCommentVisibilityStorageKey(currentUserId),
    );
    const preferenceTimer = window.setTimeout(() => {
      if (savedPreference === "hidden") setShowPeerComments(false);
    }, 0);

    const updatePanelCommentVisibility = (event: Event) => {
      const detail = (event as CustomEvent<PanelCommentVisibilityDetail>)
        .detail;
      if (detail.currentUserId !== currentUserId) return;
      setShowPeerComments(detail.showPeerComments);
    };
    window.addEventListener(
      PANEL_COMMENT_VISIBILITY_EVENT,
      updatePanelCommentVisibility,
    );

    return () => {
      window.clearTimeout(preferenceTimer);
      window.removeEventListener(
        PANEL_COMMENT_VISIBILITY_EVENT,
        updatePanelCommentVisibility,
      );
    };
  }, [currentUserId]);

  const observationMap = useMemo(
    () =>
      new Map(
        activePanelRows
          .filter((row) => row.criterion_id)
          .map((row) => [
            `${row.adjudicator_user_id}:${row.criterion_id}`,
            row.observation,
          ]),
      ),
    [activePanelRows],
  );

  const ownScoreMap = useMemo(
    () =>
      new Map(ownScores.map((score) => [score.criterion_id, score])),
    [ownScores],
  );

  const overallProductionScore = useMemo(
    () =>
      calculateOverallProductionScore({
        categories,
        criteria,
        scores: new Map(Object.entries(liveOwnScoreValues)),
      }),
    [categories, criteria, liveOwnScoreValues],
  );

  const updateLiveOwnScore = useCallback(
    (criterionId: string, value: number | null) => {
      setLiveOwnScoreValues((current) => ({
        ...current,
        [criterionId]: value,
      }));
      window.dispatchEvent(
        new CustomEvent<AdjudicationScoreChangeDetail>(
          ADJUDICATION_SCORE_CHANGE_EVENT,
          { detail: { criterionId, value } },
        ),
      );
    },
    [],
  );

  const ownCommentMap = useMemo(
    () =>
      new Map(
        ownComments.map((comment) => [comment.category_id, comment]),
      ),
    [ownComments],
  );

  const proposalMap = useMemo(
    () => new Map(effectiveCategoryProposals.map((proposal) => [proposal.category_id, proposal])),
    [effectiveCategoryProposals],
  );

  const approvalMap = useMemo(
    () => new Map(effectiveCategoryApprovals.filter((approval) => approval.adjudicator_user_id === currentUserId).map((approval) => [approval.proposal_id, approval])),
    [currentUserId, effectiveCategoryApprovals],
  );

  const feedbackMap = useMemo(
    () =>
      new Map(effectivePanelFeedback.map((item) => [item.category_id, item])),
    [effectivePanelFeedback],
  );

  const reviewerMap = useMemo(
    () => new Map(panelReviewers.map((reviewer) => [reviewer.id, reviewer])),
    [panelReviewers],
  );

  const panelApprovedCategories = useMemo(
    () => new Set(panelApprovedCategoryIds),
    [panelApprovedCategoryIds],
  );

  const commentColumnsStyle = {
    "--panel-comment-count": Math.max(visiblePanelMembers.length, 1),
  } as CSSProperties;
  const normalizedAfterCategoryTitle =
    afterCategoryTitle?.trim().toLocaleLowerCase();

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
            {practiceMode
              ? "Practice workspace"
              : refreshError
              ? "Live refresh interrupted"
              : liveConnection
                ? "Two-point ranges update live"
                : "Comments and two-point ranges refresh automatically"}
          </strong>
          <small>
            {practiceMode
              ? "Entries stay in this browser and are never saved to a school."
              : lastRefreshed
              ? `Last refreshed ${lastRefreshed.toLocaleTimeString()}`
              : "Waiting for the next panel update…"}
          </small>
        </div>
      </div>

      {categories.map((category) => (
        <Fragment key={category.id}>
          <CategoryScoreSection
            category={category}
            categoryComment={ownCommentMap.get(category.id)}
            categoryCriteria={criteria.filter(
              (criterion) => criterion.category_id === category.id,
            )}
            categorySubjectName={
              categorySubjectDefaults[category.category_key] ?? ""
            }
            officialProposal={proposalMap.get(category.id)}
            ownApproval={proposalMap.get(category.id) ? approvalMap.get(proposalMap.get(category.id)!.id) : undefined}
            panelFeedback={feedbackMap.get(category.id)}
            assignedReviewerName={
              feedbackMap.get(category.id)?.assigned_to
                ? reviewerMap.get(feedbackMap.get(category.id)!.assigned_to!)?.name
                : undefined
            }
            panelApproved={panelApprovedCategories.has(category.id)}
            reviewStatus={reviewStatus}
            applicationId={applicationId}
            commentColumnsStyle={commentColumnsStyle}
            currentUserId={currentUserId}
            observationMap={observationMap}
            ownScoreMap={ownScoreMap}
            panelMembers={visiblePanelMembers}
            canComment={canComment}
            readOnly={readOnly}
            scoreOptions={scoreOptions}
            overallProductionScore={overallProductionScore}
            productionTitle={productionTitle}
            onScoreChange={updateLiveOwnScore}
            onPracticeProposalResponse={onPracticeProposalResponse}
            practiceMode={practiceMode}
          />
          {afterCategory &&
          category.title.trim().toLocaleLowerCase() ===
            normalizedAfterCategoryTitle
            ? afterCategory
            : null}
        </Fragment>
      ))}
      {afterCategory &&
      !categories.some(
        (category) =>
          category.title.trim().toLocaleLowerCase() ===
          normalizedAfterCategoryTitle,
      )
        ? afterCategory
        : null}
    </>
  );
}

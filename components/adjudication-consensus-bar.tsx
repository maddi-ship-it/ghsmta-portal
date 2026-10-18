"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ownerUpdateAdjudicationReview,
  respondCategoryProposal,
  saveAllCategoryProposals,
  sendPanelNarrativeAssignmentsToChannel,
  submitPanelForOwnerReview,
  type CategoryProposalSaveResult,
  type PanelAssignmentAnnouncementResult,
} from "@/app/portal/adjudication/[id]/workflow-actions";
import { ActingCandidateReviewPanel } from "@/components/acting-candidate-review-panel";
import { ScheduleSubmitButton } from "@/components/schedule-submit-button";
import {
  OPEN_CATEGORY_REVIEW_EVENT,
  OPEN_PANEL_REVIEW_EVENT,
} from "@/components/application-reference-bar";
import {
  deriveNaturalTwoPointRange,
  formatTwoPointRangeStart,
  isValidTwoPointRange,
} from "@/lib/adjudication-ranges";
import { createClient } from "@/lib/supabase/client";
import type {
  ActingCandidateReviewer,
  ActingCandidateReviewState,
} from "@/lib/acting-candidate-review";
import type { AppRole, ScoringCategory } from "@/lib/types";

type Proposal = {
  id: string;
  application_id: string;
  category_id: string;
  proposed_by: string;
  is_eligible: boolean;
  range_min: number | null;
  range_max: number | null;
  status: string;
  advisory_note: string | null;
  owner_override_note: string | null;
};

type Review = { status: string; owner_note: string | null } | null;

type PanelReviewer = {
  id: string;
  name: string;
  role: "adjudicator" | "advisory_member";
};

type NarrativeAssignment = {
  category_id: string;
  assigned_to: string | null;
};

type CategoryScoreability = {
  category_id: string;
  is_scoreable: boolean;
  reason: string | null;
};

type CategoryApproval = {
  id: string;
  proposal_id: string;
  adjudicator_user_id: string;
  response: string;
  comment: string | null;
};

type LivePanelScoreSpread = {
  category_id: string;
  average_score: number | string | null;
  minimum_member_average: number | string | null;
  maximum_member_average: number | string | null;
  score_count: number | string;
  scoring_member_count: number | string;
  assigned_scorer_count: number | string;
  updated_at: string | null;
};

type AdjudicatorCategoryScoreSource = {
  category_id: string;
  criteria: Array<{
    criterion_id: string;
    score: number | null;
  }>;
};

type AdjudicatorCategoryAverage = {
  category_id: string;
  average_score: number | null;
  score_count: number;
  criterion_count: number;
};

function calculateAdjudicatorCategoryAverage(
  source: AdjudicatorCategoryScoreSource,
  useScorecardControls = false,
): AdjudicatorCategoryAverage {
  const scores = source.criteria.flatMap((criterion) => {
    const control = useScorecardControls
      ? document.getElementById(`score_${criterion.criterion_id}`)
      : null;
    const rawValue =
      control instanceof HTMLSelectElement ? control.value : criterion.score;
    const score = rawValue === "" || rawValue == null ? null : Number(rawValue);

    return score != null && Number.isFinite(score) ? [score] : [];
  });

  return {
    category_id: source.category_id,
    average_score:
      scores.length === 0
        ? null
        : scores.reduce((total, score) => total + score, 0) / scores.length,
    score_count: scores.length,
    criterion_count: source.criteria.length,
  };
}

function statusLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function proposalHasValidRange(proposal: Proposal | undefined) {
  return isValidTwoPointRange(proposal?.range_min, proposal?.range_max);
}

function initialRangeSelections(categories: ScoringCategory[], proposals: Proposal[]) {
  const proposalByCategory = new Map(
    proposals.map((proposal) => [proposal.category_id, proposal]),
  );

  return Object.fromEntries(
    categories.map((category) => [
      category.id,
      formatTwoPointRangeStart(
        proposalByCategory.get(category.id)?.range_min,
      ),
    ]),
  );
}

const rangeOptions = Array.from(
  { length: 29 },
  (_, index) => 1 + index * 0.25,
).filter((value) => value <= 8);

const initialCategorySaveResult: CategoryProposalSaveResult = { ok: false };
const initialAssignmentAnnouncementResult: PanelAssignmentAnnouncementResult = {
  ok: false,
};

export function AdjudicationConsensusBar({
  actingCandidateReview,
  actingCandidateReviewers,
  applicationId,
  categories,
  narrativeAssignments,
  narrativesReady,
  panelReviewers,
  proposals,
  scoreability,
  review,
  role,
  currentUserId,
  approvals,
  adjudicatorCategoryScores = [],
  compact = false,
}: {
  applicationId: string;
  actingCandidateReview: ActingCandidateReviewState;
  actingCandidateReviewers: ActingCandidateReviewer[];
  role: AppRole;
  currentUserId: string;
  categories: ScoringCategory[];
  proposals: Proposal[];
  scoreability: CategoryScoreability[];
  approvals: CategoryApproval[];
  adjudicatorCategoryScores?: AdjudicatorCategoryScoreSource[];
  review: Review;
  narrativesReady: boolean;
  narrativeAssignments: NarrativeAssignment[];
  panelReviewers: PanelReviewer[];
  compact?: boolean;
}) {
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [rangeReviewOpen, setRangeReviewOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [livePanelAverages, setLivePanelAverages] = useState<
    LivePanelScoreSpread[]
  >([]);
  const [rangeSelections, setRangeSelections] = useState<Record<string, string>>(
    () => initialRangeSelections(categories, proposals),
  );
  const touchedRangeSelections = useRef(new Set<string>());
  const autoSuggestedRanges = useRef(new Map<string, string>());
  const [liveAverageStatus, setLiveAverageStatus] = useState<
    "loading" | "live" | "error"
  >("loading");
  const [liveAverageUpdatedAt, setLiveAverageUpdatedAt] =
    useState<Date | null>(null);
  const [adjudicatorCategoryAverages, setAdjudicatorCategoryAverages] =
    useState<AdjudicatorCategoryAverage[]>(() =>
      adjudicatorCategoryScores.map((source) =>
        calculateAdjudicatorCategoryAverage(source),
      ),
    );
  const supabase = useMemo(() => createClient(), []);
  const saveCategoryAction = useCallback(
    async (
      previous: CategoryProposalSaveResult,
      formData: FormData,
    ) => {
      const result = await saveAllCategoryProposals(
        applicationId,
        previous,
        formData,
      );
      if (result.ok && result.intent === "draft") {
        setMatrixOpen(false);
      }
      return result;
    },
    [applicationId],
  );
  const [categorySaveResult, categorySaveAction] = useActionState(
    saveCategoryAction,
    initialCategorySaveResult,
  );
  const sendAssignmentsAction = useMemo(
    () => sendPanelNarrativeAssignmentsToChannel.bind(null, applicationId),
    [applicationId],
  );
  const [assignmentAnnouncementResult, sendAssignments] = useActionState(
    sendAssignmentsAction,
    initialAssignmentAnnouncementResult,
  );
  const proposalByCategory = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.category_id, proposal])),
    [proposals],
  );
  const scoreabilityByCategory = useMemo(
    () =>
      new Map(
        scoreability.map((decision) => [decision.category_id, decision]),
      ),
    [scoreability],
  );
  const assignmentByCategory = useMemo(
    () =>
      new Map(
        narrativeAssignments.map((assignment) => [
          assignment.category_id,
          assignment.assigned_to,
        ]),
      ),
    [narrativeAssignments],
  );
  const reviewerById = useMemo(
    () => new Map(panelReviewers.map((reviewer) => [reviewer.id, reviewer])),
    [panelReviewers],
  );
  const approvalByProposal = useMemo(
    () =>
      new Map(
        approvals
          .filter(
            (approval) => approval.adjudicator_user_id === currentUserId,
          )
          .map((approval) => [approval.proposal_id, approval]),
      ),
    [approvals, currentUserId],
  );
  const panelAverageByCategory = useMemo(
    () =>
      new Map(
        livePanelAverages.map((average) => [average.category_id, average]),
      ),
    [livePanelAverages],
  );
  const adjudicatorAverageByCategory = useMemo(
    () =>
      new Map(
        adjudicatorCategoryAverages.map((average) => [
          average.category_id,
          average,
        ]),
      ),
    [adjudicatorCategoryAverages],
  );
  const unresolved = categories.filter((category) => {
    const proposal = proposalByCategory.get(category.id);
    return (
      !proposal ||
      !proposalHasValidRange(proposal) ||
      !["approved", "overridden"].includes(proposal.status)
    );
  }).length;
  const disputed = proposals.filter(
    (proposal) => proposal.status === "disputed",
  ).length;
  const candidateApprovalComplete =
    actingCandidateReview.status === "approved";
  const canSetDecisions = role === "advisory_member" || role === "owner";
  const canReviewRanges = role === "adjudicator";
  const openDecisionMatrix = useCallback(() => {
    touchedRangeSelections.current.clear();
    autoSuggestedRanges.current.clear();
    setRangeSelections(initialRangeSelections(categories, proposals));
    setMatrixOpen(true);
  }, [categories, proposals]);
  const openRangeReview = useCallback(() => {
    setAdjudicatorCategoryAverages(
      adjudicatorCategoryScores.map((source) =>
        calculateAdjudicatorCategoryAverage(source, true),
      ),
    );
    setRangeReviewOpen(true);
  }, [adjudicatorCategoryScores]);

  useEffect(() => {
    if (!compact) return;

    const openCategoryReview = () => {
      if (canReviewRanges) {
        openRangeReview();
      } else if (canSetDecisions) {
        openDecisionMatrix();
      }
    };
    const openPanelReview = () => {
      if (canSetDecisions) setReviewOpen(true);
    };

    window.addEventListener(OPEN_CATEGORY_REVIEW_EVENT, openCategoryReview);
    window.addEventListener(OPEN_PANEL_REVIEW_EVENT, openPanelReview);

    return () => {
      window.removeEventListener(OPEN_CATEGORY_REVIEW_EVENT, openCategoryReview);
      window.removeEventListener(OPEN_PANEL_REVIEW_EVENT, openPanelReview);
    };
  }, [
    canReviewRanges,
    canSetDecisions,
    compact,
    openDecisionMatrix,
    openRangeReview,
  ]);

  useEffect(() => {
    const shouldLoadLiveAverages = matrixOpen && canSetDecisions;
    if (!shouldLoadLiveAverages) return;

    let disposed = false;
    let requestInFlight = false;

    const loadPanelAverages = async (showLoading: boolean) => {
      if (requestInFlight) return;
      requestInFlight = true;
      if (showLoading) setLiveAverageStatus("loading");

      const { data, error } = await supabase.rpc(
        "get_live_panel_category_score_spreads",
        { p_application_id: applicationId },
      );
      requestInFlight = false;

      if (disposed) return;

      if (error) {
        setLiveAverageStatus("error");
        return;
      }

      const scoreSpreads = (data ?? []) as LivePanelScoreSpread[];
      setLivePanelAverages(scoreSpreads);
      setRangeSelections((current) => {
        const next = { ...current };

        for (const spread of scoreSpreads) {
          const savedRangeStart = formatTwoPointRangeStart(
            proposalByCategory.get(spread.category_id)?.range_min,
          );
          if (
            touchedRangeSelections.current.has(spread.category_id) ||
            savedRangeStart
          ) {
            continue;
          }

          const minimum =
            spread.minimum_member_average == null
              ? null
              : Number(spread.minimum_member_average);
          const maximum =
            spread.maximum_member_average == null
              ? null
              : Number(spread.maximum_member_average);
          const suggestedRange =
            Number(spread.scoring_member_count) >= 2
              ? deriveNaturalTwoPointRange([minimum, maximum])
              : null;
          const previousSuggestion = autoSuggestedRanges.current.get(
            spread.category_id,
          );
          const currentIsAutomatic =
            previousSuggestion != null &&
            next[spread.category_id] === previousSuggestion;

          if (suggestedRange) {
            const suggestedStart = suggestedRange.rangeMinimum.toFixed(2);
            if (!next[spread.category_id] || currentIsAutomatic) {
              next[spread.category_id] = suggestedStart;
            }
            autoSuggestedRanges.current.set(
              spread.category_id,
              suggestedStart,
            );
          } else {
            if (currentIsAutomatic) next[spread.category_id] = "";
            autoSuggestedRanges.current.delete(spread.category_id);
          }
        }

        return next;
      });
      setLiveAverageUpdatedAt(new Date());
      setLiveAverageStatus("live");
    };

    void loadPanelAverages(true);
    const timer = window.setInterval(() => {
      void loadPanelAverages(false);
    }, 3_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    applicationId,
    canReviewRanges,
    canSetDecisions,
    matrixOpen,
    proposalByCategory,
    rangeReviewOpen,
    supabase,
  ]);

  return (
    <>
      {!compact ? (
      <div className="adjudication-consensus-bar consolidated-consensus-bar">
        <div className="consensus-summary">
          <strong>Eligibility, applicability &amp; two-point ranges</strong>
          <span
            className={unresolved ? "badge badge-warning" : "badge badge-complete"}
          >
            {unresolved ? `${unresolved} unresolved` : "All approved"}
          </span>
          {disputed > 0 && (
            <span className="badge badge-warning">{disputed} disputed</span>
          )}
          {!candidateApprovalComplete && (
            <span className="badge badge-warning">
              Acting candidates pending
            </span>
          )}
          {review && <span className="badge">{statusLabel(review.status)}</span>}
        </div>
        <div className="consensus-main-actions">
          {canReviewRanges && (
            <button
              className="button button-secondary button-compact"
              onClick={openRangeReview}
              type="button"
            >
              Review ranges
            </button>
          )}
          {canSetDecisions && (
            <button
              className="button button-secondary button-compact"
              onClick={openDecisionMatrix}
              type="button"
            >
              Review all categories
            </button>
          )}
          {canSetDecisions && (
            <button
              className="button button-dark button-compact"
              onClick={() => setReviewOpen(true)}
              type="button"
            >
              Panel review
            </button>
          )}
        </div>
      </div>
      ) : null}

      {categorySaveResult.ok && categorySaveResult.message && (
        <div
          aria-live="polite"
          className="notice-banner success-banner page-message"
          role="status"
        >
          {categorySaveResult.message}
        </div>
      )}

      {rangeReviewOpen && canReviewRanges && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setRangeReviewOpen(false);
            }
          }}
        >
          <div
            aria-labelledby="range-review-title"
            aria-modal="true"
            className="modal-card consensus-matrix-modal range-review-modal"
            role="dialog"
          >
            <form>
              <div className="modal-header sticky-modal-header">
                <div>
                  <p className="eyebrow">Adjudicator review</p>
                  <h2 id="range-review-title">Review all categories</h2>
                  <p>
                    Approve the acting candidates, then compare every proposed
                    range with your category average.
                  </p>
                </div>
                <button
                  aria-label="Close range review"
                  className="modal-close"
                  onClick={() => setRangeReviewOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>

              <ActingCandidateReviewPanel
                applicationId={applicationId}
                currentUserId={currentUserId}
                reviewers={actingCandidateReviewers}
                role={role}
                state={actingCandidateReview}
              />

              <div className="consensus-matrix-table-wrap">
                <table className="data-table consensus-matrix-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Eligibility</th>
                      <th>Two-point range</th>
                      <th>Your average</th>
                      <th>Final comment writer</th>
                      <th>Your approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => {
                      const proposal = proposalByCategory.get(category.id);
                      const approval = proposal
                        ? approvalByProposal.get(proposal.id)
                        : undefined;
                      const assigneeId = assignmentByCategory.get(category.id);
                      const assignedReviewer = assigneeId
                        ? reviewerById.get(assigneeId)
                        : undefined;
                      const adjudicatorAverage = adjudicatorAverageByCategory.get(
                        category.id,
                      );
                      const average =
                        adjudicatorAverage?.average_score == null
                          ? null
                          : Number(adjudicatorAverage.average_score);
                      const rangeMin =
                        proposal?.range_min == null
                          ? null
                          : Number(proposal.range_min);
                      const rangeMax =
                        proposal?.range_max == null
                          ? null
                          : Number(proposal.range_max);
                      const averageWithinRange =
                        average != null && rangeMin != null && rangeMax != null
                          ? average >= rangeMin && average <= rangeMax
                          : null;
                      const commentFieldName = `range_response_comment_${category.id}`;
                      const finalizedByOwner = proposal?.status === "overridden";

                      return (
                        <tr key={category.id}>
                          <td>
                            <strong>{category.title}</strong>
                            <small>{category.description}</small>
                          </td>
                          <td>
                            {proposal ? (
                              <span
                                className={`badge ${
                                  proposal.is_eligible
                                    ? "badge-complete"
                                    : "badge-warning"
                                }`}
                              >
                                {proposal.is_eligible
                                  ? "Eligible"
                                  : "Not eligible"}
                              </span>
                            ) : (
                              <span className="badge badge-warning">
                                Waiting for Advisory
                              </span>
                            )}
                          </td>
                          <td>
                            {proposal?.range_min != null &&
                            proposal.range_max != null
                              ? `${Number(proposal.range_min).toFixed(2)}–${Number(
                                  proposal.range_max,
                                ).toFixed(2)}`
                              : "Committee range required"}
                          </td>
                          <td>
                            <div
                              className={
                                averageWithinRange === true
                                  ? "range-review-average range-review-average-within"
                                  : averageWithinRange === false
                                    ? "range-review-average range-review-average-outside"
                                    : "range-review-average"
                              }
                            >
                              <strong>
                                {average == null ? "—" : average.toFixed(5)}
                              </strong>
                              <small>
                                {adjudicatorAverage
                                  ? `${adjudicatorAverage.score_count}/${adjudicatorAverage.criterion_count} scores entered`
                                  : "Enter scores on your scorecard"}
                              </small>
                              {averageWithinRange != null && (
                                <small>
                                  {averageWithinRange
                                    ? "Inside proposed range"
                                    : "Outside proposed range"}
                                </small>
                              )}
                            </div>
                          </td>
                          <td>
                            <strong>
                              {assignedReviewer?.name ?? "Not assigned yet"}
                            </strong>
                          </td>
                          <td>
                            {!proposal ? (
                              <span className="field-help">
                                Available after Advisory saves the category.
                              </span>
                            ) : !proposalHasValidRange(proposal) ? (
                              <span className="field-help">
                                The Committee must add a 2-point range before
                                adjudicators can respond.
                              </span>
                            ) : finalizedByOwner ? (
                              <span className="badge badge-complete">
                                Owner override
                              </span>
                            ) : (
                              <div className="form-stack">
                                <span
                                  className={`badge ${
                                    approval?.response === "approved"
                                      ? "badge-complete"
                                      : "badge-warning"
                                  }`}
                                >
                                  {approval?.response
                                    ? statusLabel(approval.response)
                                    : "Needs response"}
                                </span>
                                <div className="button-row">
                                  <button
                                    className="button button-gold button-compact"
                                    formAction={respondCategoryProposal.bind(
                                      null,
                                      applicationId,
                                      proposal.id,
                                      "approved",
                                      commentFieldName,
                                    )}
                                    formNoValidate
                                    type="submit"
                                  >
                                    Approve eligibility &amp; range
                                  </button>
                                </div>
                                <details className="range-review-dispute">
                                  <summary>Question this decision</summary>
                                  <label htmlFor={commentFieldName}>
                                    What should the Advisory Committee revisit?
                                  </label>
                                  <textarea
                                    className="textarea compact-textarea"
                                    defaultValue={approval?.comment ?? ""}
                                    id={commentFieldName}
                                    minLength={3}
                                    name={commentFieldName}
                                    onInput={(event) =>
                                      event.currentTarget.setCustomValidity("")
                                    }
                                    placeholder="Add a short explanation"
                                  />
                                  <button
                                    className="button button-danger button-compact"
                                    formAction={respondCategoryProposal.bind(
                                      null,
                                      applicationId,
                                      proposal.id,
                                      "disputed",
                                      commentFieldName,
                                    )}
                                    onClick={(event) => {
                                      const field =
                                        event.currentTarget.form?.elements.namedItem(
                                          commentFieldName,
                                        );
                                      if (
                                        field instanceof HTMLTextAreaElement &&
                                        field.value.trim().length < 3
                                      ) {
                                        event.preventDefault();
                                        field.setCustomValidity(
                                          "Add a short note explaining what should be revisited.",
                                        );
                                        field.reportValidity();
                                      }
                                    }}
                                    type="submit"
                                  >
                                    Send question
                                  </button>
                                </details>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sticky-modal-footer range-review-footer">
                <span className="range-review-live-status">
                  Your averages use only the scores currently entered on your
                  scorecard.
                </span>
                <button
                  className="button button-dark"
                  onClick={() => setRangeReviewOpen(false)}
                  type="button"
                >
                  Done
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {matrixOpen && canSetDecisions && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMatrixOpen(false);
          }}
        >
          <div
            aria-labelledby="category-decision-title"
            aria-modal="true"
            className="modal-card consensus-matrix-modal advisory-decision-modal"
            role="dialog"
          >
            <form action={categorySaveAction}>
              <div className="modal-header sticky-modal-header">
                <div>
                  <p className="eyebrow">
                    {role === "owner"
                      ? "Owner category review"
                      : "Advisory Committee review"}
                  </p>
                  <h2 id="category-decision-title">Review all categories</h2>
                  <p>
                    Confirm acting candidates, eligibility, applicability,
                    two-point ranges, and final comment writers in one place.
                  </p>
                </div>
                <div className="modal-header-actions">
                  <button
                    aria-label="Save and close category decisions"
                    className="modal-close"
                    formNoValidate
                    name="save_intent"
                    title="Save and close"
                    type="submit"
                    value="draft"
                  >
                    ×
                  </button>
                </div>
              </div>

              <ActingCandidateReviewPanel
                applicationId={applicationId}
                currentUserId={currentUserId}
                reviewers={actingCandidateReviewers}
                role={role}
                state={actingCandidateReview}
              />

              <div className="advisory-decision-help">
                <p>
                  <strong>Eligible</strong> controls awards consideration.
                  <strong> Applicable</strong> controls whether scoring fields
                  appear and whether the category counts toward Overall
                  Production. Every applicable category requires a 2-point
                  range, even when it is not award eligible.
                </p>
                <span aria-live="polite" className="range-review-live-status">
                  <span
                    aria-hidden="true"
                    className={`range-review-live-dot range-review-live-dot-${liveAverageStatus}`}
                  />
                  {liveAverageStatus === "error"
                    ? "Live averages temporarily unavailable"
                    : liveAverageStatus === "loading"
                      ? "Loading live panel averages…"
                      : "Live panel averages updating automatically"}
                </span>
              </div>

              {!categorySaveResult.ok && categorySaveResult.error && (
                <div className="form-error page-message" role="alert">
                  {categorySaveResult.error}
                </div>
              )}
              {categorySaveResult.ok && categorySaveResult.message && (
                <div
                  className="notice-banner success-banner page-message"
                  role="status"
                >
                  {categorySaveResult.message}
                </div>
              )}

              <div className="advisory-decision-list">
                {categories.map((category) => {
                      const proposal = proposalByCategory.get(category.id);
                      const scoreabilityDecision =
                        scoreabilityByCategory.get(category.id);
                      const assigneeId = assignmentByCategory.get(category.id);
                      const assignedReviewer = assigneeId
                        ? reviewerById.get(assigneeId)
                        : undefined;
                      const assigneeFieldName = `assigned_to_${category.id}`;
                      const panelAverage = panelAverageByCategory.get(
                        category.id,
                      );
                      const average =
                        panelAverage?.average_score == null
                          ? null
                          : Number(panelAverage.average_score);
                      const minimumMemberAverage =
                        panelAverage?.minimum_member_average == null
                          ? null
                          : Number(panelAverage.minimum_member_average);
                      const maximumMemberAverage =
                        panelAverage?.maximum_member_average == null
                          ? null
                          : Number(panelAverage.maximum_member_average);
                      const reportingMemberCount = panelAverage
                        ? Number(panelAverage.scoring_member_count)
                        : 0;
                      const naturalRange = deriveNaturalTwoPointRange([
                        minimumMemberAverage,
                        maximumMemberAverage,
                      ]);
                      const hasComparableScores = reportingMemberCount >= 2;
                      const naturalRangeStatus = !hasComparableScores
                        ? "pending"
                        : naturalRange
                          ? "within"
                          : "outside";

                      return (
                        <article
                          className={`advisory-decision-card ${
                            proposal?.status === "disputed"
                              ? "advisory-decision-card-disputed"
                              : ""
                          } advisory-decision-range-${naturalRangeStatus}`}
                          key={category.id}
                        >
                          <header className="advisory-decision-card-header">
                            <div>
                            <input
                              name="category_id"
                              type="hidden"
                              value={category.id}
                            />
                              <span className="advisory-decision-category-number">
                                Category {category.sort_order}
                              </span>
                              <h3>{category.title}</h3>
                              {category.description && (
                                <p>{category.description}</p>
                              )}
                            </div>
                            <div className="advisory-decision-summary">
                              <div className="advisory-live-average">
                                <span>Live panel average</span>
                                <strong>
                                  {liveAverageStatus === "loading" && average == null
                                    ? "Loading…"
                                    : average == null
                                      ? "—"
                                      : average.toFixed(5)}
                                </strong>
                                <small>
                                  {panelAverage
                                    ? `${Number(panelAverage.score_count)} scores from ${Number(
                                        panelAverage.scoring_member_count,
                                      )}/${Number(
                                        panelAverage.assigned_scorer_count,
                                      )} scoring members`
                                    : "Updates as panel scores are entered"}
                                </small>
                                {naturalRange ? (
                                  <small className="advisory-live-range advisory-live-range-within">
                                    Natural range {naturalRange.rangeMinimum.toFixed(2)}–
                                    {naturalRange.rangeMaximum.toFixed(2)}
                                  </small>
                                ) : hasComparableScores ? (
                                  <small className="advisory-live-range advisory-live-range-outside">
                                    Outside two points: {minimumMemberAverage?.toFixed(2)}–
                                    {maximumMemberAverage?.toFixed(2)}
                                  </small>
                                ) : (
                                  <small className="advisory-live-range">
                                    Waiting for at least two panel scores
                                  </small>
                                )}
                              </div>
                              <span
                                className={`badge ${
                                  proposal?.status === "approved" ||
                                  proposal?.status === "overridden"
                                    ? "badge-complete"
                                    : "badge-warning"
                                }`}
                              >
                                {proposal
                                  ? statusLabel(proposal.status)
                                  : "Not proposed"}
                              </span>
                            </div>
                          </header>

                          <div className="advisory-decision-grid">
                            <label className="advisory-decision-toggle">
                              <input
                                defaultChecked={proposal?.is_eligible ?? true}
                                name={`eligible_${category.id}`}
                                type="checkbox"
                              />
                              <span>
                                <strong>Eligible</strong>
                                <small>Awards consideration</small>
                              </span>
                            </label>
                            <label className="advisory-decision-toggle">
                              <input
                                defaultChecked={
                                  scoreabilityDecision?.is_scoreable ?? true
                                }
                                name={`scoreable_${category.id}`}
                                type="checkbox"
                              />
                              <span>
                                <strong>Applicable</strong>
                                <small>Counts toward Overall Production</small>
                              </span>
                            </label>
                            <div className="advisory-decision-field">
                              <label htmlFor={`scoreability_reason_${category.id}`}>
                                Reason not applicable
                              </label>
                              <input
                                className="input input-compact"
                                defaultValue={scoreabilityDecision?.reason ?? ""}
                                id={`scoreability_reason_${category.id}`}
                                name={`scoreability_reason_${category.id}`}
                                placeholder="Optional context"
                              />
                              <small>
                                Shown when the category is not applicable.
                              </small>
                            </div>
                            <div className="advisory-decision-field">
                              <label htmlFor={`range_${category.id}`}>
                                Two-point range
                              </label>
                            <select
                              className="select"
                              id={`range_${category.id}`}
                              name={`range_${category.id}`}
                              onChange={(event) => {
                                touchedRangeSelections.current.add(category.id);
                                setRangeSelections((current) => ({
                                  ...current,
                                  [category.id]: event.target.value,
                                }));
                              }}
                              required
                              value={rangeSelections[category.id] ?? ""}
                            >
                              <option value="">Select range</option>
                              {rangeOptions.map((value) => (
                                <option key={value} value={value.toFixed(2)}>
                                  {value.toFixed(2)}–{(value + 2).toFixed(2)}
                                </option>
                              ))}
                            </select>
                              <small>
                                {naturalRange &&
                                rangeSelections[category.id] ===
                                  naturalRange.rangeMinimum.toFixed(2)
                                  ? "Auto-set from the live panel scores."
                                  : "Choose the approved low and high range."}
                              </small>
                            </div>
                            <div className="advisory-decision-field advisory-decision-writer">
                              <label htmlFor={assigneeFieldName}>
                                Final comment writer
                              </label>
                            {canSetDecisions ? (
                              <select
                                className="select"
                                defaultValue={assigneeId ?? ""}
                                id={assigneeFieldName}
                                name={assigneeFieldName}
                              >
                                <option value="">Choose panel member</option>
                                {panelReviewers.map((reviewer) => (
                                  <option key={reviewer.id} value={reviewer.id}>
                                    {reviewer.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <strong className="advisory-decision-assignee">
                                {assignedReviewer?.name ?? "Unassigned"}
                              </strong>
                            )}
                            </div>
                            <div className="advisory-decision-field advisory-decision-note">
                              <label htmlFor={`note_${category.id}`}>
                                Advisory note
                              </label>
                            <textarea
                              className="textarea compact-textarea"
                              defaultValue={proposal?.advisory_note ?? ""}
                              id={`note_${category.id}`}
                              name={`note_${category.id}`}
                              placeholder="Optional context for adjudicators"
                            />
                            </div>
                            {role === "owner" && (
                              <div className="advisory-decision-field advisory-owner-override">
                                <label className="advisory-decision-toggle">
                                <input
                                  defaultChecked={
                                    proposal?.status === "overridden"
                                  }
                                  name={`override_${category.id}`}
                                  type="checkbox"
                                />
                                  <span>
                                    <strong>Owner override</strong>
                                    <small>Finalize without panel approval</small>
                                  </span>
                                </label>
                                <label htmlFor={`override_note_${category.id}`}>
                                  Override note
                                </label>
                                <input
                                  className="input input-compact"
                                  defaultValue={
                                    proposal?.owner_override_note ?? ""
                                  }
                                  id={`override_note_${category.id}`}
                                  name={`override_note_${category.id}`}
                                  placeholder="Required when overriding"
                                />
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
              </div>

              {canSetDecisions && (
                <div className="panel-assignment-announcement">
                  <div>
                    <strong>Panel comment assignments</strong>
                    <p>
                      Post the currently saved final-comment writers in this
                      school&apos;s panel channel.
                    </p>
                  </div>
                  <ScheduleSubmitButton
                    className="button button-secondary"
                    formAction={sendAssignments}
                    pendingLabel="Sending assignments…"
                  >
                    Send assignments to panel
                  </ScheduleSubmitButton>
                </div>
              )}
              {assignmentAnnouncementResult.message && (
                <div
                  aria-live="polite"
                  className="notice-banner success-banner page-message"
                  role="status"
                >
                  {assignmentAnnouncementResult.message}
                </div>
              )}
              {assignmentAnnouncementResult.error && (
                <div className="form-error page-message" role="alert">
                  {assignmentAnnouncementResult.error}
                </div>
              )}

              <div className="sticky-modal-footer advisory-decision-footer">
                <span aria-live="polite" className="range-review-live-status">
                  <span
                    aria-hidden="true"
                    className={`range-review-live-dot range-review-live-dot-${liveAverageStatus}`}
                  />
                  {liveAverageStatus === "live" && liveAverageUpdatedAt
                    ? `Panel averages updated ${liveAverageUpdatedAt.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                        second: "2-digit",
                      })}`
                    : liveAverageStatus === "error"
                      ? "Live averages temporarily unavailable"
                      : "Loading live panel averages…"}
                </span>
                <div className="button-row">
                <button
                  className="button button-secondary"
                  onClick={() => setMatrixOpen(false)}
                  type="button"
                >
                  Discard changes
                </button>
                <ScheduleSubmitButton
                  className="button button-secondary"
                  formNoValidate
                  name="save_intent"
                  pendingLabel="Saving draft…"
                  value="draft"
                >
                  Save and close
                </ScheduleSubmitButton>
                <ScheduleSubmitButton
                  className="button button-gold"
                  name="save_intent"
                  pendingLabel={
                    role === "advisory_member"
                      ? "Sending for approval…"
                      : "Saving decisions…"
                  }
                  value="approval"
                >
                  {role === "advisory_member"
                    ? "Send for approval"
                    : "Save category decisions"}
                </ScheduleSubmitButton>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {reviewOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReviewOpen(false);
          }}
        >
          <div aria-modal="true" className="modal-card" role="dialog">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Panel workflow</p>
                <h2>Send adjudication to Owners</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="consensus-review-checklist">
              <p>
                <strong>Acting candidates:</strong>{" "}
                {candidateApprovalComplete
                  ? "Full panel approved"
                  : "Approval in progress"}
              </p>
              <p>
                <strong>Category decisions:</strong>{" "}
                {unresolved === 0 ? "Complete" : `${unresolved} unresolved`}
              </p>
              <p>
                <strong>Final comments:</strong>{" "}
                {narrativesReady ? "All panel approved" : "Approval in progress"}
              </p>
              <p>
                <strong>Current status:</strong>{" "}
                {statusLabel(review?.status ?? "draft")}
              </p>
            </div>
            {role === "advisory_member" && (
              <form action={submitPanelForOwnerReview.bind(null, applicationId)}>
                <button
                  className="button button-dark"
                  disabled={
                    unresolved > 0 ||
                    !narrativesReady ||
                    !candidateApprovalComplete
                  }
                  type="submit"
                >
                  Send to Owners for review
                </button>
              </form>
            )}
            {role === "owner" && (
              <form
                action={ownerUpdateAdjudicationReview.bind(null, applicationId)}
                className="form-stack"
              >
                <div className="field">
                  <label>Owner note</label>
                  <textarea
                    className="textarea"
                    defaultValue={review?.owner_note ?? ""}
                    name="owner_note"
                    rows={5}
                  />
                </div>
                <div className="modal-actions">
                  <button
                    className="button button-danger"
                    name="status"
                    type="submit"
                    value="returned"
                  >
                    Return to Advisory Committee
                  </button>
                  <button
                    className="button button-secondary"
                    name="status"
                    type="submit"
                    value="owner_review"
                  >
                    Mark under Owner review
                  </button>
                  <button
                    className="button button-dark"
                    name="status"
                    type="submit"
                    value="released"
                  >
                    Mark workflow complete
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

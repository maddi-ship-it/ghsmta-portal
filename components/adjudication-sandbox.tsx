"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdjudicationBrainDump } from "@/components/adjudication-brain-dump";
import {
  AdjudicationBigPictureComment,
  AdjudicationOverallProduction,
} from "@/components/adjudication-overall-production";
import {
  ApplicationReferenceBar,
  OPEN_CATEGORY_REVIEW_EVENT,
} from "@/components/application-reference-bar";
import { CollaborativeAdjudicatorScorecard } from "@/components/collaborative-adjudicator-scorecard";
import { OwnerLiveAdjudicationReview } from "@/components/owner-live-adjudication-review";
import { ScorecardSubmitControls } from "@/components/scorecard-submit-controls";
import { quarterScoreOptions } from "@/lib/adjudication";
import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import type { ApplicationReferencePanel } from "@/lib/application-reference-panels";
import type { AdjudicationReferenceLink } from "@/lib/adjudication-reference-documents";
import type {
  AdjudicationCategoryComment,
  AdjudicationScore,
  AdjudicationScorecard,
  AdjudicatorAssignment,
  AppRole,
  AwardCycle,
  Profile,
  ScoringCategory,
  ScoringCriterion,
  ScoringRubric,
  ScoringScaleLevel,
} from "@/lib/types";

const SANDBOX_APPLICATION_ID = "adjudication-sandbox";
const SANDBOX_USER_ID = "sandbox-current-user";
const SANDBOX_FORM_ID = "adjudication-scorecard-sandbox";
const SAMPLE_TIMESTAMP = "2026-10-11T16:00:00.000Z";

type SandboxProposal = {
  id: string;
  category_id: string;
  is_eligible: boolean;
  range_min: number | null;
  range_max: number | null;
  status: string;
  advisory_note: string | null;
};

type SandboxApproval = {
  proposal_id: string;
  adjudicator_user_id: string;
  response: string;
  comment: string | null;
};

type WorkspaceMode = "adjudicator" | "committee";

function defaultRangeMinimum(rubric: ScoringRubric) {
  return Math.min(
    rubric.score_max - 2,
    Math.max(rubric.score_min, rubric.score_max - 3),
  );
}

function createInitialProposals(
  categories: ScoringCategory[],
  rubric: ScoringRubric,
): SandboxProposal[] {
  const rangeMinimum = defaultRangeMinimum(rubric);

  return categories.map((category) => ({
    id: `sandbox-proposal-${category.id}`,
    category_id: category.id,
    is_eligible: true,
    range_min: rangeMinimum,
    range_max: Number((rangeMinimum + 2).toFixed(2)),
    status: "proposed",
    advisory_note: "Practice Committee decision",
  }));
}

function createReferencePanels(
  categories: ScoringCategory[],
): ApplicationReferencePanel[] {
  const eligibilityItems = categories
    .filter(
      (category) =>
        category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY,
    )
    .map((category) => ({
      label: `${category.title} - Award Eligible`,
      value: "YES",
    }));

  return [
    {
      key: "eligibility",
      title: "Category Eligibility View",
      shortTitle: "ELIGIBILITY",
      description: "Award eligibility selections submitted by the school.",
      groups: [{ title: "Application eligibility", items: eligibilityItems }],
    },
    {
      key: "acting-candidates",
      title: "Acting Candidates",
      shortTitle: "ACTING CANDIDATES",
      description: "Candidate information supplied with the application.",
      groups: [
        {
          title: "Practice candidates",
          items: [
            {
              label: "Leading actor",
              value: "Sample Student | they/them | Baker",
            },
            {
              label: "Leading actress",
              value: "Sample Student | she/her | Witch",
            },
            {
              label: "Supporting performer A",
              value: "Sample Student | he/him | Jack",
            },
          ],
        },
      ],
    },
    {
      key: "musical-budget",
      title: "Production Budget",
      shortTitle: "BUDGET",
      description: "Budget information supplied with the application.",
      groups: [
        {
          title: "Practice production budget",
          items: [
            { label: "Total production budget", value: "$18,500" },
            { label: "Royalties and licensing", value: "$4,250" },
            {
              label: "Scenery, costumes, and technical",
              value: "$7,900",
            },
          ],
        },
      ],
    },
    {
      key: "program-vision",
      title: "Program Maturity, Vision, Support View",
      shortTitle: "PROGRAM MATURITY, VISION, SUPPORT VIEW",
      description: "Program context supplied by the school.",
      groups: [
        {
          title: "Practice program context",
          items: [
            {
              label: "Program maturity",
              value:
                "Established program with developing student leadership",
            },
            {
              label: "Production vision",
              value:
                "A story-first production centered on community and consequence",
            },
            {
              label: "School support",
              value: "Faculty, family, and administrative support",
            },
          ],
        },
      ],
    },
    {
      key: "full-application",
      title: "Full Application",
      shortTitle: "FULL APPLICATION",
      description:
        "A complete practice application using fictional information.",
      groups: [
        {
          title: "School and production",
          items: [
            { label: "School", value: "GHSMTA Practice School" },
            { label: "Production", value: "Sandbox Musical" },
            { label: "Performance venue", value: "Practice Auditorium" },
          ],
        },
        {
          title: "Adjudication notes",
          items: [
            {
              label: "Special considerations",
              value:
                "All information on this page is fictional and resets when you leave.",
            },
            {
              label: "Accessibility",
              value: "Step-free entrance and reserved seating available",
            },
          ],
        },
      ],
    },
  ];
}

function createPanelSampleData(
  criteria: ScoringCriterion[],
): {
  assignments: AdjudicatorAssignment[];
  comments: AdjudicationCategoryComment[];
  profiles: Profile[];
  scorecards: AdjudicationScorecard[];
  scores: AdjudicationScore[];
} {
  const panelists = [
    { id: "sandbox-panel-1", name: "Alex Morgan" },
    { id: "sandbox-panel-2", name: "Jordan Lee" },
    { id: "sandbox-panel-3", name: "Taylor Brooks" },
    { id: "sandbox-panel-4", name: "Casey Rivera" },
  ];
  const profiles: Profile[] = panelists.map((panelist) => ({
    id: panelist.id,
    email: `${panelist.id}@example.invalid`,
    full_name: panelist.name,
    role: "adjudicator",
    active: true,
  }));
  const assignments: AdjudicatorAssignment[] = panelists.map(
    (panelist, index) => ({
      id: `sandbox-assignment-${index + 1}`,
      application_id: SANDBOX_APPLICATION_ID,
      adjudicator_user_id: panelist.id,
      assigned_by: null,
      assigned_at: SAMPLE_TIMESTAMP,
      status: index < 3 ? "submitted" : "in_progress",
      due_at: null,
      internal_notes: null,
    }),
  );
  const scorecards: AdjudicationScorecard[] = assignments.map(
    (assignment, index) => ({
      id: `sandbox-scorecard-${index + 1}`,
      assignment_id: assignment.id,
      application_id: SANDBOX_APPLICATION_ID,
      adjudicator_user_id: assignment.adjudicator_user_id,
      rubric_id: "sandbox-rubric",
      status: index < 3 ? "submitted" : "draft",
      submitted_at: index < 3 ? SAMPLE_TIMESTAMP : null,
      reopened_at: null,
      internal_notes: null,
      created_at: SAMPLE_TIMESTAMP,
      updated_at: SAMPLE_TIMESTAMP,
    }),
  );
  const scores: AdjudicationScore[] = scorecards.flatMap(
    (scorecard, panelIndex) =>
      criteria.map((criterion, criterionIndex) => ({
        id: `sandbox-score-${panelIndex}-${criterion.id}`,
        scorecard_id: scorecard.id,
        criterion_id: criterion.id,
        score: Number(
          (7.25 + ((panelIndex + criterionIndex) % 6) * 0.25).toFixed(2),
        ),
        observation:
          panelIndex === 3
            ? null
            : `Sample observable note connecting the performance to ${criterion.title.toLocaleLowerCase()}.`,
        created_at: SAMPLE_TIMESTAMP,
        updated_at: SAMPLE_TIMESTAMP,
      })),
  );

  return { assignments, comments: [], profiles, scorecards, scores };
}

function categoryRangeOptions(rubric: ScoringRubric) {
  return quarterScoreOptions(
    rubric.score_min,
    rubric.score_max - 2,
  ).reverse();
}

function SandboxCategoryReview({
  approvals,
  categories,
  mode,
  onProposalChange,
  onResponse,
  proposals,
  rubric,
}: {
  approvals: SandboxApproval[];
  categories: ScoringCategory[];
  mode: WorkspaceMode;
  onProposalChange: (proposal: SandboxProposal) => void;
  onResponse: (
    proposalId: string,
    response: "approved" | "disputed",
    comment: string | null,
  ) => void;
  proposals: SandboxProposal[];
  rubric: ScoringRubric;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const showReview = () => setOpen(true);
    window.addEventListener(OPEN_CATEGORY_REVIEW_EVENT, showReview);
    return () =>
      window.removeEventListener(OPEN_CATEGORY_REVIEW_EVENT, showReview);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!open) return null;

  const proposalByCategoryId = new Map(
    proposals.map((proposal) => [proposal.category_id, proposal]),
  );
  const approvalByProposalId = new Map(
    approvals.map((approval) => [approval.proposal_id, approval]),
  );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setOpen(false);
      }}
      role="presentation"
    >
      <section
        aria-labelledby="sandbox-category-review-title"
        aria-modal="true"
        className="modal-card sandbox-review-modal"
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">
              {mode === "committee"
                ? "Committee decision practice"
                : "Adjudicator review"}
            </span>
            <h2 id="sandbox-category-review-title">Review all categories</h2>
            <p>
              {mode === "committee"
                ? "Practice setting the same eligibility and two-point ranges used on a live school."
                : "Review and approve the same Committee decisions required on a live scorecard."}
            </p>
          </div>
          <button
            aria-label="Close category review"
            className="modal-close"
            onClick={() => setOpen(false)}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="sandbox-review-list">
          {categories.map((category, index) => {
            const proposal = proposalByCategoryId.get(category.id);
            if (!proposal) return null;
            const approval = approvalByProposalId.get(proposal.id);

            return (
              <article className="sandbox-live-review-row" key={category.id}>
                <div>
                  <span className="section-order">Category {index + 1}</span>
                  <strong>{category.title}</strong>
                </div>

                {mode === "committee" ? (
                  <>
                    <label>
                      Eligibility
                      <select
                        className="select"
                        onChange={(event) =>
                          onProposalChange({
                            ...proposal,
                            is_eligible: event.target.value === "yes",
                          })
                        }
                        value={proposal.is_eligible ? "yes" : "no"}
                      >
                        <option value="yes">YES</option>
                        <option value="no">NO</option>
                      </select>
                    </label>
                    <label>
                      Two-point range
                      <select
                        className="select"
                        onChange={(event) => {
                          const minimum = Number(event.target.value);
                          onProposalChange({
                            ...proposal,
                            range_min: minimum,
                            range_max: Number((minimum + 2).toFixed(2)),
                          });
                        }}
                        value={proposal.range_min ?? ""}
                      >
                        {categoryRangeOptions(rubric).map((minimum) => (
                          <option key={minimum} value={minimum}>
                            {minimum.toFixed(2)}–{(minimum + 2).toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="badge badge-complete">
                      Ready for panel
                    </span>
                  </>
                ) : (
                  <>
                    <div className="sandbox-live-decision">
                      <strong>
                        {proposal.is_eligible ? "Eligible" : "Not eligible"}
                      </strong>
                      <small>
                        {proposal.range_min?.toFixed(2)}–
                        {proposal.range_max?.toFixed(2)} required range
                      </small>
                    </div>
                    <span
                      className={`badge ${
                        approval?.response === "approved"
                          ? "badge-complete"
                          : "badge-warning"
                      }`}
                    >
                      {approval?.response === "approved"
                        ? "Approved"
                        : approval?.response === "disputed"
                          ? "Disputed"
                          : "Needs response"}
                    </span>
                    {approval?.response === "approved" ? null : (
                      <button
                        className="button button-gold button-compact"
                        onClick={() =>
                          onResponse(proposal.id, "approved", null)
                        }
                        type="button"
                      >
                        Approve
                      </button>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>

        <footer className="modal-actions">
          <button
            className="button button-secondary"
            onClick={() => setOpen(false)}
            type="button"
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

function SandboxScoringGuide({ scale }: { scale: ScoringScaleLevel[] }) {
  return (
    <section className="panel score-guide-panel">
      <div className="panel-header">
        <div>
          <h2>Scoring guide</h2>
          <p>
            Use the 1–10 scale in 0.25-point increments. Practice scores are
            visible only on this page.
          </p>
        </div>
      </div>
      <div className="score-scale-grid">
        {scale.map((level) => (
          <div key={level.id}>
            <strong>{Number(level.score).toFixed(0)}</strong>
            <span>{level.label}</span>
            <small>{level.description}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdjudicationSandbox({
  categories,
  criteria,
  cycle,
  links,
  role,
  rubric,
  scale,
}: {
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  cycle: AwardCycle | null;
  links: AdjudicationReferenceLink[];
  role: AppRole;
  rubric: ScoringRubric;
  scale: ScoringScaleLevel[];
}) {
  const scoreableCategories = useMemo(
    () =>
      [...categories].sort((left, right) => left.sort_order - right.sort_order),
    [categories],
  );
  const narrativeCategories = useMemo(
    () =>
      scoreableCategories.filter(
        (category) =>
          category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY,
      ),
    [scoreableCategories],
  );
  const scoreableCriteria = useMemo(
    () =>
      [...criteria].sort((left, right) => left.sort_order - right.sort_order),
    [criteria],
  );
  const initialMode: WorkspaceMode =
    role === "adjudicator" ? "adjudicator" : "committee";
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [proposals, setProposals] = useState<SandboxProposal[]>(() =>
    createInitialProposals(narrativeCategories, rubric),
  );
  const [approvals, setApprovals] = useState<SandboxApproval[]>([]);
  const [practiceSubmitted, setPracticeSubmitted] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const panels = useMemo(
    () => createReferencePanels(scoreableCategories),
    [scoreableCategories],
  );
  const panelData = useMemo(
    () => createPanelSampleData(scoreableCriteria),
    [scoreableCriteria],
  );
  const scoreOptions = useMemo(
    () =>
      quarterScoreOptions(rubric.score_min, rubric.score_max).map((value) => ({
        value,
        label:
          scale.find((level) => Number(level.score) === value)?.label ?? null,
      })),
    [rubric.score_max, rubric.score_min, scale],
  );
  const categorySubjectDefaults = useMemo(
    () =>
      Object.fromEntries(
        scoreableCategories.map((category) => [
          category.category_key,
          category.subject_label
            ? "Sample Student | they/them | Practice Role"
            : "",
        ]),
      ),
    [scoreableCategories],
  );
  const categoryReviewComplete =
    mode === "committee"
      ? proposals.every(
          (proposal) =>
            proposal.range_min != null &&
            proposal.range_max != null &&
            Math.abs(proposal.range_max - proposal.range_min - 2) < 0.0001,
        )
      : proposals.every(
          (proposal) =>
            approvals.find(
              (approval) => approval.proposal_id === proposal.id,
            )?.response === "approved",
        );

  const respondToProposal = useCallback(
    (
      proposalId: string,
      response: "approved" | "disputed",
      comment: string | null,
    ) => {
      setApprovals((current) => [
        ...current.filter((approval) => approval.proposal_id !== proposalId),
        {
          proposal_id: proposalId,
          adjudicator_user_id: SANDBOX_USER_ID,
          response,
          comment,
        },
      ]);
      setProposals((current) =>
        current.map((proposal) =>
          proposal.id === proposalId
            ? {
                ...proposal,
                status: response === "approved" ? "approved" : "proposed",
              }
            : proposal,
        ),
      );
    },
    [],
  );

  const resetSandbox = useCallback(() => {
    setProposals(createInitialProposals(narrativeCategories, rubric));
    setApprovals([]);
    setPracticeSubmitted(false);
    setResetKey((current) => current + 1);
  }, [narrativeCategories, rubric]);

  if (narrativeCategories.length === 0) {
    return (
      <section className="panel empty-state">
        <h2>No scoreable categories are available.</h2>
        <p>Add active categories and criteria to the published rubric.</p>
      </section>
    );
  }

  return (
    <div className="adjudication-sandbox">
      <section className="sandbox-safety-notice" aria-label="Practice notice">
        <div className="sandbox-safety-icon" aria-hidden="true">
          ◇
        </div>
        <div>
          <strong>PRACTICE ONLY — NOTHING HERE IS SAVED</strong>
          <p>
            This mirrors the live {mode === "adjudicator" ? "adjudicator" : "Advisory Committee"} page using fictional data and the current scoring rubric.
          </p>
          <small>
            {cycle?.season_year} · {rubric.name} · Version {rubric.version_number}
          </small>
        </div>
        <div className="sandbox-practice-actions">
          {role === "owner" ? (
            <div className="sandbox-mode-switch" aria-label="Practice view">
              <button
                aria-pressed={mode === "adjudicator"}
                className={`button button-compact ${
                  mode === "adjudicator" ? "button-gold" : "button-secondary"
                }`}
                onClick={() => {
                  setMode("adjudicator");
                  resetSandbox();
                }}
                type="button"
              >
                Adjudicator view
              </button>
              <button
                aria-pressed={mode === "committee"}
                className={`button button-compact ${
                  mode === "committee" ? "button-gold" : "button-secondary"
                }`}
                onClick={() => {
                  setMode("committee");
                  resetSandbox();
                }}
                type="button"
              >
                Committee view
              </button>
            </div>
          ) : null}
          <button
            className="button button-secondary button-compact"
            onClick={resetSandbox}
            type="button"
          >
            Reset practice
          </button>
        </div>
      </section>

      {practiceSubmitted ? (
        <div className="notice page-message" role="status">
          Practice scorecard submitted. The brain dump, comments, and scores
          are now locked, just as they are after a live submission.
        </div>
      ) : null}

      <ApplicationReferenceBar
        categoryNavigation={{
          categories: narrativeCategories,
          showCompletion: mode === "adjudicator",
        }}
        links={links}
        panels={panels}
        reviewActions={{
          categoryReviewStatus: categoryReviewComplete
            ? "complete"
            : "needs-action",
          showCategoryReview: true,
          showPanelReview: false,
        }}
        scorecardSubmitControl={
          mode === "adjudicator" ? (
            <ScorecardSubmitControls
              applicationId={SANDBOX_APPLICATION_ID}
              categories={scoreableCategories}
              compact
              criteria={scoreableCriteria}
              formId={SANDBOX_FORM_ID}
              onPracticeSubmit={() => setPracticeSubmitted(true)}
              practiceMode
              practiceSubmitted={practiceSubmitted}
            />
          ) : undefined
        }
      />

      <SandboxCategoryReview
        approvals={approvals}
        categories={narrativeCategories}
        mode={mode}
        onProposalChange={(nextProposal) =>
          setProposals((current) =>
            current.map((proposal) =>
              proposal.id === nextProposal.id ? nextProposal : proposal,
            ),
          )
        }
        onResponse={respondToProposal}
        proposals={proposals}
        rubric={rubric}
      />

      <div
        className="adjudication-score-layout adjudication-score-layout-single"
        key={`${mode}-${resetKey}`}
      >
        <div className="adjudication-score-content">
          {mode === "adjudicator" ? (
            <form
              className="scorecard-form"
              id={SANDBOX_FORM_ID}
              onSubmit={(event) => event.preventDefault()}
            >
              <AdjudicationBrainDump
                applicationId={SANDBOX_APPLICATION_ID}
                canComment
                defaultValue=""
                practiceMode
                readOnly={practiceSubmitted}
              />
              <SandboxScoringGuide scale={scale} />
              <CollaborativeAdjudicatorScorecard
                afterCategory={
                  <>
                    <AdjudicationBigPictureComment
                      canComment
                      categories={scoreableCategories}
                      criteria={scoreableCriteria}
                      ownScores={[]}
                      privateNotes=""
                      readOnly={practiceSubmitted}
                    />
                    <AdjudicationOverallProduction
                      categories={scoreableCategories}
                      criteria={scoreableCriteria}
                      ownScores={[]}
                    />
                  </>
                }
                applicationId={SANDBOX_APPLICATION_ID}
                canComment
                categories={narrativeCategories}
                categoryApprovals={approvals}
                categoryProposals={proposals}
                categorySubjectDefaults={categorySubjectDefaults}
                criteria={scoreableCriteria}
                currentUserId={SANDBOX_USER_ID}
                currentUserName="Practice Adjudicator"
                initialPanelRows={panelData.scores
                  .filter((score) => score.observation)
                  .map((score, index) => {
                    const scorecard = panelData.scorecards.find(
                      (card) => card.id === score.scorecard_id,
                    );
                    const profile = panelData.profiles.find(
                      (item) => item.id === scorecard?.adjudicator_user_id,
                    );
                    return {
                      panel_order:
                        panelData.profiles.findIndex(
                          (item) => item.id === profile?.id,
                        ) + 1,
                      adjudicator_user_id:
                        profile?.id ?? `sandbox-peer-${index}`,
                      adjudicator_name:
                        profile?.full_name ?? "Practice panelist",
                      criterion_id: score.criterion_id,
                      observation: score.observation,
                      updated_at: SAMPLE_TIMESTAMP,
                    };
                  })}
                onPracticeProposalResponse={respondToProposal}
                ownComments={[]}
                ownScores={[]}
                panelApprovedCategoryIds={[]}
                panelFeedback={[]}
                panelReviewers={[]}
                practiceMode
                productionTitle="Sandbox Musical"
                readOnly={practiceSubmitted}
                reviewStatus="draft"
                scoreOptions={scoreOptions}
              />
            </form>
          ) : (
            <OwnerLiveAdjudicationReview
              applicationId={SANDBOX_APPLICATION_ID}
              assignments={panelData.assignments}
              categories={scoreableCategories}
              criteria={scoreableCriteria}
              initialComments={panelData.comments}
              initialFeedback={[]}
              initialScorecards={panelData.scorecards}
              initialScores={panelData.scores}
              isOwner={false}
              practiceMode
              productionTitle="Sandbox Musical"
              profiles={panelData.profiles}
              release={null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

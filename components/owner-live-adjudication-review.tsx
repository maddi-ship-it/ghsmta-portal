"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  generatePanelNarrativeNow,
  reopenAdjudicatorScorecard,
  savePanelFeedback,
} from "@/app/portal/adjudication/[id]/actions";
import { CriterionScoringGuideButton } from "@/components/criterion-scoring-guide-button";
import { AdjudicationBigPictureComment } from "@/components/adjudication-overall-production";
import { OPEN_FULL_SCORE_VIEW_EVENT } from "@/components/application-reference-bar";
import { FullScoreOverviewModal } from "@/components/full-score-overview-modal";
import { OwnerCommentReviewModal } from "@/components/owner-comment-review-modal";
import { PanelNarrativeReviewEditor } from "@/components/panel-narrative-review-editor";
import { RichTextField } from "@/components/rich-text-field";
import {
  formatScore,
  formatScoreAverage,
  roundScoreAverage,
} from "@/lib/adjudication";
import {
  ADJUDICATION_CATEGORY_COMPLETION_EVENT,
  isAdjudicationCategoryComplete,
} from "@/lib/adjudication-category-completion";
import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import { panelNarrativeSourceAssignmentIds } from "@/lib/panel-narrative";
import { resolvePanelAveragePolicy } from "@/lib/panel-average-policy";
import { createClient } from "@/lib/supabase/client";
import { richTextHasContent, richTextToPlainText, sanitizeRichTextHtml } from "@/lib/rich-text";
import type {
  AdjudicationCategoryComment,
  AdjudicationPanelFeedback,
  AdjudicationRelease,
  AdjudicationScore,
  AdjudicationScorecard,
  AdjudicatorAssignment,
  Profile,
  ScoringCategory,
  ScoringCriterion,
} from "@/lib/types";

export type PanelNarrativeReviewer = {
  id: string;
  name: string;
  role: "adjudicator" | "advisory_member";
};

type AdvisoryNarrativeReview = {
  canComment: boolean;
  currentUserId: string;
  panelReviewers: PanelNarrativeReviewer[];
  panelApprovedCategoryIds: string[];
  reviewStatus: string;
};

type AdvisoryScoreEntry = {
  canComment: boolean;
  canScore: boolean;
  currentUserId: string;
  readOnly: boolean;
  scoreOptions: Array<{
    value: number;
    label: string | null;
  }>;
};

const PORTAL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

const PORTAL_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

function formatPortalDateTime(value: string | Date) {
  return PORTAL_DATE_TIME_FORMATTER.format(
    typeof value === "string" ? new Date(value) : value,
  );
}

function formatPortalTime(value: string | Date) {
  return PORTAL_TIME_FORMATTER.format(
    typeof value === "string" ? new Date(value) : value,
  );
}

function scorecardStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function uniqueText(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => richTextToPlainText(value))
        .filter(Boolean),
    ),
  ];
}

function RichTextPreview({ value }: { value: string | null | undefined }) {
  if (!richTextHasContent(value)) return <span>—</span>;

  return (
    <div
      className="rich-text-preview"
      dangerouslySetInnerHTML={{
        __html: sanitizeRichTextHtml(value),
      }}
    />
  );
}

function CriterionDescription({ description }: { description: string | null }) {
  if (!description) return null;

  const bulletItems = description
    .split(/\s*•\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (bulletItems.length <= 1) {
    return <small>{description}</small>;
  }

  return (
    <ul className="panel-review-criterion-list">
      {bulletItems.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function AdvisoryCategoryNarrative({
  applicationId,
  category,
  categoryFeedback,
  narrativeReview,
  panelApproved,
  reviewerMap,
}: {
  applicationId: string;
  category: ScoringCategory;
  categoryFeedback: AdjudicationPanelFeedback | undefined;
  narrativeReview: AdvisoryNarrativeReview;
  panelApproved: boolean;
  reviewerMap: Map<string, PanelNarrativeReviewer>;
}) {
  const finalComment = categoryFeedback?.final_comment?.trim() ?? "";
  const assignedReviewer = categoryFeedback?.assigned_to
    ? reviewerMap.get(categoryFeedback.assigned_to)
    : undefined;
  const sentToOwners = ["ready_for_owner", "owner_review", "released"].includes(
    narrativeReview.reviewStatus,
  );
  const canEdit = Boolean(
    narrativeReview.canComment &&
      finalComment &&
      !panelApproved &&
      !sentToOwners &&
      categoryFeedback?.assigned_to === narrativeReview.currentUserId,
  );

  return (
    <div className="panel-body panel-category-final-comment">
      <article className="panel-narrative-card panel-narrative-card-inline">
        <div className="panel-narrative-card-heading">
          <div>
            <span className="eyebrow">School-facing narrative</span>
            <h3>Final comment</h3>
          </div>
          <span
            className={`badge ${panelApproved ? "badge-complete" : "badge-warning"}`}
          >
            {panelApproved
              ? "Panel approved"
              : assignedReviewer
                ? `Assigned to ${assignedReviewer.name}`
                : finalComment
                  ? "Needs assignment"
                  : "With Owner"}
          </span>
        </div>

        {assignedReviewer ? (
          <div className="final-comment-assignee">
            <span>Assigned final comment writer</span>
            <strong>{assignedReviewer.name}</strong>
          </div>
        ) : null}

        {finalComment ? (
          canEdit ? (
            <PanelNarrativeReviewEditor
              applicationId={applicationId}
              categoryId={category.id}
              currentUserId={narrativeReview.currentUserId}
              generatedAt={categoryFeedback?.generated_at ?? ""}
              initialValue={finalComment}
            />
          ) : (
            <>
              <div className="comment-readonly-surface panel-narrative-preview">
                {finalComment}
              </div>
              {!panelApproved && !assignedReviewer ? (
                <p className="field-help">
                  An Advisory Committee member must assign this comment before
                  it can be edited and approved.
                </p>
              ) : null}
            </>
          )
        ) : (
          <div className="comment-readonly-surface">
            The live draft is with the Owners. It will appear here after an
            Owner sends it to the panel.
          </div>
        )}
      </article>
    </div>
  );
}

function bulletSection(title: string, values: string[]) {
  if (values.length === 0) return "";
  return `${title}\n${values.map((value) => `• ${value}`).join("\n")}`;
}

function composeLiveCommentDraft(
  category: ScoringCategory,
  criteria: ScoringCriterion[],
  scorecards: AdjudicationScorecard[],
  scores: AdjudicationScore[],
  comments: AdjudicationCategoryComment[],
) {
  const applicable = comments.filter((comment) => comment.is_applicable);
  const notApplicable = comments.filter((comment) => !comment.is_applicable);
  const scorecardIds = new Set(scorecards.map((scorecard) => scorecard.id));

  const observations = criteria
    .filter((criterion) => criterion.category_id === category.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((criterion) =>
      uniqueText(
        scores
          .filter(
            (score) =>
              scorecardIds.has(score.scorecard_id) &&
              score.criterion_id === criterion.id,
          )
          .map((score) => score.observation),
      ).map((observation) => `${criterion.title}: ${observation}`),
    );

  const sections = [
    bulletSection("Criterion observations:", observations),
    bulletSection(
      "Successes noted by the panel:",
      uniqueText(applicable.map((comment) => comment.successes)),
    ),
    bulletSection(
      "Specific successful moments and examples:",
      uniqueText(applicable.map((comment) => comment.success_examples)),
    ),
    bulletSection(
      "Opportunities for continued growth:",
      uniqueText(applicable.map((comment) => comment.growth_areas)),
    ),
    bulletSection(
      "Specific moments supporting the growth feedback:",
      uniqueText(applicable.map((comment) => comment.growth_examples)),
    ),
    bulletSection(
      "Not-applicable notes:",
      uniqueText(
        notApplicable.map((comment) => comment.not_applicable_reason),
      ),
    ),
  ].filter(Boolean);

  if (sections.length === 0) return "";
  return `${category.title}\n\n${sections.join("\n\n")}`;
}

function categoryAverage(
  categoryId: string,
  criteria: ScoringCriterion[],
  scorecards: AdjudicationScorecard[],
  scores: AdjudicationScore[],
) {
  const criterionIds = new Set(
    criteria
      .filter((criterion) => criterion.category_id === categoryId)
      .map((criterion) => criterion.id),
  );
  const scorecardIds = new Set(scorecards.map((scorecard) => scorecard.id));
  const values = scores
    .filter(
      (score) =>
        criterionIds.has(score.criterion_id) &&
        scorecardIds.has(score.scorecard_id) &&
        typeof score.score === "number",
    )
    .map((score) => Number(score.score));

  if (values.length === 0) return null;
  return roundScoreAverage(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function scorecardCategoryAverage(
  categoryId: string,
  scorecardId: string | null,
  criteria: ScoringCriterion[],
  scores: AdjudicationScore[],
) {
  if (!scorecardId) return null;
  return categoryAverage(
    categoryId,
    criteria,
    [{ id: scorecardId } as AdjudicationScorecard],
    scores,
  );
}

function LivePanelFeedbackEditor({
  applicationId,
  assignedReviewerName,
  category,
  feedback,
  liveDraft,
  onRefreshLiveNotes,
  panelApproved,
}: {
  applicationId: string;
  assignedReviewerName: string | undefined;
  category: ScoringCategory;
  feedback: AdjudicationPanelFeedback | undefined;
  liveDraft: string;
  onRefreshLiveNotes: () => Promise<boolean>;
  panelApproved: boolean;
}) {
  const router = useRouter();
  const storedComment = feedback?.final_comment?.trim() ?? "";
  const storageKey = `ghsmta:offline-panel-feedback:${applicationId}:${category.id}`;
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const [manualValue, setManualValue] = useState(storedComment);
  const [followingLiveDraft, setFollowingLiveDraft] = useState(!storedComment);
  const [online, setOnline] = useState(true);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [refreshingLiveNotes, setRefreshingLiveNotes] = useState(false);
  const [isGenerating, startGeneration] = useTransition();
  const value = followingLiveDraft ? liveDraft : manualValue;

  const readLocalDraft = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        finalComment?: string;
        approved?: boolean;
        sourceGeneratedAt?: string;
      };
    } catch {
      window.localStorage.removeItem(storageKey);
      return null;
    }
  }, [storageKey]);

  const syncLocalDraft = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    const draft = readLocalDraft();
    const finalComment = draft?.finalComment?.trim();
    if (!draft || !finalComment) return;

    syncingRef.current = true;
    setSyncMessage("Syncing panel narrative…");

    const formData = new FormData();
    formData.set("final_comment", finalComment);
    formData.set(
      "source_generated_at",
      draft.sourceGeneratedAt ?? "",
    );
    if (draft.approved) {
      formData.set("approved", "on");
    }

    try {
      await savePanelFeedback(applicationId, category.id, formData);
      window.localStorage.removeItem(storageKey);
      setHasLocalDraft(false);
      setSyncMessage("Panel narrative synced.");
      router.refresh();
    } catch (error) {
      setHasLocalDraft(true);
      setSyncMessage(
        error instanceof Error
          ? `Panel narrative saved on this device. ${error.message}`
          : "Panel narrative saved on this device.",
      );
    } finally {
      syncingRef.current = false;
    }
  }, [applicationId, category.id, readLocalDraft, router, storageKey]);

  useEffect(() => {
    const updateOnlineState = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => void syncLocalDraft(), 250);
      }
    };

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, [syncLocalDraft]);

  useEffect(() => {
    let disposed = false;

    const deferStateUpdate = (callback: () => void) => {
      window.setTimeout(() => {
        if (!disposed) callback();
      }, 0);
    };

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return () => {
          disposed = true;
        };
      }

      const draft = JSON.parse(raw) as {
        finalComment?: string;
        approved?: boolean;
        sourceGeneratedAt?: string;
      };

      if ((draft.finalComment ?? "").trim() === storedComment) {
        window.localStorage.removeItem(storageKey);
        deferStateUpdate(() => setHasLocalDraft(false));
        return () => {
          disposed = true;
        };
      }

      deferStateUpdate(() => {
        setFollowingLiveDraft(false);
        setManualValue(draft.finalComment ?? "");
        setHasLocalDraft(true);
      });
    } catch {
      window.localStorage.removeItem(storageKey);
      deferStateUpdate(() => setHasLocalDraft(false));
    }

    return () => {
      disposed = true;
    };
  }, [storageKey, storedComment]);

  const writeLocalDraft = (finalComment: string, approved?: boolean) => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        applicationId,
        categoryId: category.id,
        finalComment,
        approved: Boolean(approved),
        sourceGeneratedAt: feedback?.generated_at ?? "",
        savedAt: new Date().toISOString(),
      }),
    );
    setHasLocalDraft(true);
    setSyncMessage(
      navigator.onLine
        ? "Panel narrative saved locally — syncing…"
        : "Offline — panel narrative saved on this device.",
    );
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    if (navigator.onLine) {
      syncTimerRef.current = setTimeout(() => void syncLocalDraft(), 900);
    }
  };

  return (
    <div className="panel-feedback-editor">
      <div className="panel-feedback-heading">
        <div>
          <div className="panel-feedback-title-row">
            <h3>Owner review of panel narrative</h3>
            <span
              className={`badge ${panelApproved ? "badge-complete" : "badge-warning"}`}
            >
              {panelApproved
                ? "Panel approved"
                : feedback?.status === "approved"
                  ? "Sent to panel"
                  : "Owner draft"}
            </span>
          </div>
          <p>
            This draft updates automatically from the live saved comments—no
            generation step is required. Review it here, then send it to the
            panel when it is ready.
          </p>
        </div>
      </div>

      <form
        action={savePanelFeedback.bind(null, applicationId, category.id)}
        className="form-stack"
        onSubmit={(event) => {
          if (!navigator.onLine) {
            event.preventDefault();
            const approvedField = event.currentTarget.elements.namedItem("approved");
            writeLocalDraft(
              value,
              approvedField instanceof HTMLInputElement ? approvedField.checked : false,
            );
          }
        }}
      >
        <input
          name="source_generated_at"
          type="hidden"
          value={feedback?.generated_at ?? ""}
        />
        {assignedReviewerName && (
          <div className="final-comment-assignee">
            <span>Assigned final comment writer</span>
            <strong>{assignedReviewerName}</strong>
          </div>
        )}
        <div className="field">
          <div className="field-label-row">
            <label htmlFor={`final_comment_${category.id}`}>Final panel comment</label>
            <div className="button-row">
              <button
                className="text-button"
                disabled={
                  !online ||
                  hasLocalDraft ||
                  isGenerating ||
                  feedback?.status === "approved"
                }
                type="button"
                onClick={() => {
                  setGenerationMessage("Generating Owner draft…");
                  startGeneration(async () => {
                    try {
                      const result = await generatePanelNarrativeNow(
                        applicationId,
                        category.id,
                      );
                      if (!result.ok) {
                        setGenerationMessage(result.error);
                        return;
                      }
                      setFollowingLiveDraft(false);
                      setManualValue(result.generatedComment);
                      setGenerationMessage("Owner draft generated from the latest saved comments.");
                      router.refresh();
                    } catch (error) {
                      setGenerationMessage(
                        error instanceof Error
                          ? error.message
                          : "Unable to generate the Owner draft.",
                      );
                    }
                  });
                }}
              >
                {isGenerating ? "Generating…" : "Generate/refresh draft"}
              </button>
              <button
                className="text-button"
                disabled={refreshingLiveNotes}
                type="button"
                onClick={async () => {
                  setRefreshingLiveNotes(true);
                  setGenerationMessage("Refreshing live notes…");
                  try {
                    const refreshed = await onRefreshLiveNotes();
                    if (refreshed) {
                      window.localStorage.removeItem(storageKey);
                      setHasLocalDraft(false);
                      setFollowingLiveDraft(true);
                      setManualValue("");
                      setGenerationMessage(
                        "Live notes refreshed from currently assigned commenters.",
                      );
                    } else {
                      setGenerationMessage(
                        "Live notes could not be refreshed. Try again in a moment.",
                      );
                    }
                  } catch {
                    setGenerationMessage(
                      "Live notes could not be refreshed. Try again in a moment.",
                    );
                  } finally {
                    setRefreshingLiveNotes(false);
                  }
                }}
              >
                {refreshingLiveNotes ? "Refreshing…" : "Refresh from live notes"}
              </button>
            </div>
          </div>
          <textarea
            className="textarea narrative-textarea"
            id={`final_comment_${category.id}`}
            name="final_comment"
            value={value}
            onChange={(event) => {
              setFollowingLiveDraft(false);
              setManualValue(event.target.value);
              writeLocalDraft(event.target.value);
            }}
          />
          <small className="field-help">
            {!online
              ? "Offline — panel narrative saved on this device. Save is available when you are back online."
              : hasLocalDraft
                ? syncMessage || "Local draft restored. Syncing when online."
                : followingLiveDraft
              ? "Following live observations and comments. Typing here will preserve your manual edit."
              : "Manual edit preserved. Use Refresh from live notes to replace it."}
          </small>
          {generationMessage && (
            <small aria-live="polite" className="field-help">
              {generationMessage}
            </small>
          )}
        </div>
        <label className="check-row">
          <input
            name="approved"
            type="checkbox"
            defaultChecked={feedback?.status === "approved"}
            onChange={(event) => writeLocalDraft(value, event.currentTarget.checked)}
          />
          {panelApproved
            ? "Keep panel approval and prepare for school release"
            : "Send this final comment to the panel for review"}
        </label>
        <button className="button button-dark" disabled={!online} type="submit">
          {online ? "Save Owner review" : "Save when online"}
        </button>
      </form>
    </div>
  );
}

export function OwnerLiveAdjudicationReview({
  applicationId,
  acceptdPickSix = [],
  isOwner,
  advisoryNarrativeReview,
  advisoryScoreEntry,
  categories,
  criteria,
  assignments,
  profiles,
  initialScorecards,
  initialScores,
  initialComments,
  initialFeedback,
  productionTitle,
  categorySubjectDefaults,
  practiceMode = false,
  release,
}: {
  applicationId: string;
  acceptdPickSix?: string[];
  isOwner: boolean;
  advisoryNarrativeReview?: AdvisoryNarrativeReview;
  advisoryScoreEntry?: AdvisoryScoreEntry;
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  assignments: AdjudicatorAssignment[];
  profiles: Profile[];
  initialScorecards: AdjudicationScorecard[];
  initialScores: AdjudicationScore[];
  initialComments: AdjudicationCategoryComment[];
  initialFeedback: AdjudicationPanelFeedback[];
  productionTitle: string;
  categorySubjectDefaults: Record<string, string>;
  practiceMode?: boolean;
  release: AdjudicationRelease | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [panelAssignments, setPanelAssignments] = useState(assignments);
  const [scorecards, setScorecards] = useState(initialScorecards);
  const [scores, setScores] = useState(initialScores);
  const [comments, setComments] = useState(initialComments);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [fullScoreOverviewOpen, setFullScoreOverviewOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "error">(
    "connecting",
  );
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const scorecardByAssignmentId = useMemo(
    () =>
      new Map(
        scorecards.map((scorecard) => [scorecard.assignment_id, scorecard]),
      ),
    [scorecards],
  );
  const panelRoster = useMemo(
    () =>
      panelAssignments.map((assignment) => ({
        assignment,
        scorecard: scorecardByAssignmentId.get(assignment.id) ?? null,
      })),
    [panelAssignments, scorecardByAssignmentId],
  );
  const panelAveragePolicy = useMemo(
    () => resolvePanelAveragePolicy(panelAssignments, profiles),
    [panelAssignments, profiles],
  );
  const ownAdvisoryScorecard = useMemo(
    () =>
      panelRoster.find(
        ({ assignment }) =>
          assignment.adjudicator_user_id ===
          advisoryScoreEntry?.currentUserId,
      )?.scorecard ?? null,
    [advisoryScoreEntry?.currentUserId, panelRoster],
  );
  const ownAdvisoryScores = useMemo(
    () =>
      ownAdvisoryScorecard
        ? scores.filter(
            (score) => score.scorecard_id === ownAdvisoryScorecard.id,
          )
        : [],
    [ownAdvisoryScorecard, scores],
  );
  const visibleScorecards = useMemo(
    () =>
      panelRoster.flatMap(({ scorecard }) =>
        scorecard ? [scorecard] : [],
      ),
    [panelRoster],
  );
  const panelAverageScorecards = useMemo(
    () =>
      visibleScorecards.filter((scorecard) =>
        panelAveragePolicy.contributorUserIds.has(
          scorecard.adjudicator_user_id,
        ),
      ),
    [panelAveragePolicy, visibleScorecards],
  );
  const narrativeSourceAssignmentIds = useMemo(
    () => panelNarrativeSourceAssignmentIds(panelAssignments),
    [panelAssignments],
  );
  const narrativeSourceScorecards = useMemo(
    () =>
      visibleScorecards.filter((scorecard) =>
        narrativeSourceAssignmentIds.has(scorecard.assignment_id),
      ),
    [narrativeSourceAssignmentIds, visibleScorecards],
  );
  const narrativeSourceScorecardIds = useMemo(
    () => new Set(narrativeSourceScorecards.map((scorecard) => scorecard.id)),
    [narrativeSourceScorecards],
  );
  const scoreByCardAndCriterion = useMemo(
    () =>
      new Map(
        scores.map((score) => [
          `${score.scorecard_id}:${score.criterion_id}`,
          score,
        ]),
      ),
    [scores],
  );
  const narrativeReviewerMap = useMemo(
    () =>
      new Map(
        (advisoryNarrativeReview?.panelReviewers ?? []).map((reviewer) => [
          reviewer.id,
          reviewer,
        ]),
      ),
    [advisoryNarrativeReview?.panelReviewers],
  );
  const panelApprovedCategories = useMemo(
    () =>
      new Set(advisoryNarrativeReview?.panelApprovedCategoryIds ?? []),
    [advisoryNarrativeReview?.panelApprovedCategoryIds],
  );
  const ownerPanelApprovedCategoryIds = useMemo(
    () =>
      feedback
        .filter(
          (item) =>
            item.status === "approved" &&
            item.approved_by &&
            ["adjudicator", "advisory_member"].includes(
              profileMap.get(item.approved_by)?.role ?? "",
            ),
        )
        .map((item) => item.category_id),
    [feedback, profileMap],
  );
  const refreshData = useCallback(async () => {
    if (practiceMode) return true;

    const [scorecardResult, assignmentResult] = await Promise.all([
      supabase
        .from("adjudication_scorecards")
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at"),
      supabase
        .from("adjudicator_assignments")
        .select("*")
        .eq("application_id", applicationId)
        .or("removed_at.is.null,status.eq.complete")
        .order("assigned_at"),
    ]);

    if (scorecardResult.error || assignmentResult.error) {
      setConnectionState("error");
      return false;
    }

    const nextAssignments = (assignmentResult.data ?? []) as AdjudicatorAssignment[];
    const nextScorecards = (scorecardResult.data ?? []) as AdjudicationScorecard[];
    const scorecardIds = nextScorecards.map((scorecard) => scorecard.id);

    const [scoreResult, commentResult, feedbackResult] = await Promise.all([
      scorecardIds.length
        ? supabase.from("adjudication_scores").select("*").in("scorecard_id", scorecardIds)
        : Promise.resolve({ data: [], error: null }),
      scorecardIds.length
        ? supabase
            .from("adjudication_category_comments")
            .select("*")
            .in("scorecard_id", scorecardIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("adjudication_panel_feedback")
        .select("*")
        .eq("application_id", applicationId),
    ]);

    if (scoreResult.error || commentResult.error || feedbackResult.error) {
      setConnectionState("error");
      return false;
    }

    setPanelAssignments(nextAssignments);
    setScorecards(nextScorecards);
    setScores((scoreResult.data ?? []) as AdjudicationScore[]);
    setComments((commentResult.data ?? []) as AdjudicationCategoryComment[]);
    const nextFeedback = (feedbackResult.data ?? []) as AdjudicationPanelFeedback[];
    setFeedback(
      isOwner
        ? nextFeedback
        : nextFeedback.filter((item) => item.status === "approved"),
    );
    setLastUpdated(new Date());
    setConnectionState("live");
    return true;
  }, [applicationId, isOwner, practiceMode, supabase]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refreshData(), 150);
  }, [refreshData]);
  const closeFullScoreOverview = useCallback(
    () => setFullScoreOverviewOpen(false),
    [],
  );

  useEffect(() => {
    const openFullScoreOverview = () => setFullScoreOverviewOpen(true);
    window.addEventListener(
      OPEN_FULL_SCORE_VIEW_EVENT,
      openFullScoreOverview,
    );

    return () => {
      window.removeEventListener(
        OPEN_FULL_SCORE_VIEW_EVENT,
        openFullScoreOverview,
      );
    };
  }, []);

  const scorecardKey = scorecards.map((scorecard) => scorecard.id).sort().join(",");

  useEffect(() => {
    if (!advisoryScoreEntry) return;

    const form = workspaceRef.current?.closest("form");
    if (!form) return;

    let updateFrame = 0;
    const updateCategoryCompletion = () => {
      updateFrame = 0;
      const formData = new FormData(form);

      for (const category of categories) {
        if (category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY) continue;

        const categoryCriteria = criteria.filter(
          (criterion) => criterion.category_id === category.id,
        );
        const complete = isAdjudicationCategoryComplete({
          comments: categoryCriteria.map((criterion) =>
            String(formData.get(`observation_${criterion.id}`) ?? ""),
          ),
          requireComments: advisoryScoreEntry.canComment,
          scores: categoryCriteria.map((criterion) =>
            String(formData.get(`score_${criterion.id}`) ?? ""),
          ),
        });

        window.dispatchEvent(
          new CustomEvent(ADJUDICATION_CATEGORY_COMPLETION_EVENT, {
            detail: { categoryId: category.id, complete },
          }),
        );
      }
    };
    const scheduleCompletionUpdate = () => {
      if (updateFrame) window.cancelAnimationFrame(updateFrame);
      updateFrame = window.requestAnimationFrame(updateCategoryCompletion);
    };

    scheduleCompletionUpdate();
    form.addEventListener("input", scheduleCompletionUpdate);
    form.addEventListener("change", scheduleCompletionUpdate);

    return () => {
      if (updateFrame) window.cancelAnimationFrame(updateFrame);
      form.removeEventListener("input", scheduleCompletionUpdate);
      form.removeEventListener("change", scheduleCompletionUpdate);
    };
  }, [advisoryScoreEntry, categories, criteria]);

  useEffect(() => {
    if (practiceMode) return;

    const channels = [
      supabase
        .channel(`panel-review-assignments:${applicationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "adjudicator_assignments",
            filter: `application_id=eq.${applicationId}`,
          },
          scheduleRefresh,
        )
        .subscribe(),
      supabase
        .channel(`panel-review-scorecards:${applicationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "adjudication_scorecards",
            filter: `application_id=eq.${applicationId}`,
          },
          scheduleRefresh,
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setConnectionState("live");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnectionState("error");
          }
        }),
      supabase
        .channel(`panel-review-feedback:${applicationId}`)
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
        .subscribe(),
    ];

    for (const scorecardId of scorecardKey ? scorecardKey.split(",") : []) {
      channels.push(
        supabase
          .channel(`panel-review-scores:${scorecardId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "adjudication_scores",
              filter: `scorecard_id=eq.${scorecardId}`,
            },
            scheduleRefresh,
          )
          .subscribe(),
      );
      channels.push(
        supabase
          .channel(`panel-review-comments:${scorecardId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "adjudication_category_comments",
              filter: `scorecard_id=eq.${scorecardId}`,
            },
            scheduleRefresh,
          )
          .subscribe(),
      );
    }

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [applicationId, isOwner, practiceMode, refreshData, scheduleRefresh, scorecardKey, supabase]);

  return (
    <>
      <FullScoreOverviewModal
        assignments={panelAssignments}
        categories={categories}
        criteria={criteria}
        onClose={closeFullScoreOverview}
        open={fullScoreOverviewOpen}
        profiles={profiles}
        scorecards={scorecards}
        scores={scores}
      />
      <div
        className={`live-review-status live-review-status-${
          practiceMode ? "live" : connectionState
        }`}
        ref={workspaceRef}
      >
        <span aria-hidden="true" />
        <div>
          <strong>
            {practiceMode
              ? "Practice Advisory Committee review"
              : connectionState === "live"
              ? isOwner
                ? "Live owner review"
                : "Live Advisory Committee review"
              : connectionState === "connecting"
                ? "Connecting to live scoring…"
                : "Live connection interrupted"}
          </strong>
          <small>
            {practiceMode
              ? "Sample panel scores and comments mirror the live review workspace."
              : lastUpdated
              ? `Last database update ${formatPortalTime(lastUpdated)}`
              : "Draft scores and comments will appear here as panel members save."}
          </small>
        </div>
        {!practiceMode && connectionState === "error" && (
          <button className="button button-secondary button-compact" onClick={() => void refreshData()} type="button">
            Refresh now
          </button>
        )}
      </div>

      <section className="metric-grid adjudication-review-metrics" aria-label="Panel progress">
        <article className="metric-card">
          <span className="metric-label">Assigned</span>
          <strong className="metric-value">{panelAssignments.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Started</span>
          <strong className="metric-value">{visibleScorecards.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Submitted</span>
          <strong className="metric-value">
            {visibleScorecards.filter(
              (card) => card.status === "submitted" || card.status === "locked",
            ).length}
          </strong>
        </article>
        {isOwner ? (
          <article className="metric-card">
            <span className="metric-label">School release</span>
            <strong className="metric-text">
              {release?.scores_released_at || release?.feedback_released_at
                ? "Released"
                : "Not released"}
            </strong>
          </article>
        ) : null}
      </section>

      {isOwner ? (
        <section className="panel owner-comment-review-launcher">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Owner workflow</span>
              <h2>Comment review</h2>
              <p>
                Generate every category comment, review the complete set in one
                window, and send all finished comments to the panel together.
              </p>
            </div>
            <OwnerCommentReviewModal
              applicationId={applicationId}
              acceptdPickSix={acceptdPickSix}
              categories={categories}
              feedback={feedback}
              panelApprovedCategoryIds={ownerPanelApprovedCategoryIds}
              releasedCategoryIds={
                release?.feedback_snapshot?.map(
                  (item) => item.category_id,
                ) ?? []
              }
            />
          </div>
        </section>
      ) : null}

      <section className="panel panel-progress-section">
        <div className="panel-header">
          <div>
            <h2>Panel scorecards</h2>
            <p>Draft scores and comments update live as panel members save.</p>
          </div>
        </div>
        <div className="panel-body panelist-grid">
          {panelRoster.map(({ assignment, scorecard: card }) => {
            const adjudicator = profileMap.get(assignment.adjudicator_user_id);
            return (
              <article className="panelist-card" key={assignment.id}>
                <div>
                  <strong>{adjudicator?.full_name ?? adjudicator?.email ?? "Adjudicator"}</strong>
                  <small>
                    {card
                      ? `Last saved ${formatPortalDateTime(card.updated_at)}`
                      : assignment.due_at
                        ? `Due ${formatPortalDateTime(assignment.due_at)}`
                        : "Not started"}
                  </small>
                </div>
                <span className={`badge badge-scorecard-${card?.status ?? assignment.status}`}>
                  {scorecardStatusLabel(card?.status ?? assignment.status)}
                </span>
                {isOwner && card && (card.status === "submitted" || card.status === "locked") && (
                  <form action={reopenAdjudicatorScorecard.bind(null, applicationId, card.id)}>
                    <button className="button button-secondary button-compact" type="submit">
                      Reopen
                    </button>
                  </form>
                )}
              </article>
            );
          })}
          {panelAssignments.length === 0 && <p>No adjudicators have been assigned.</p>}
        </div>
      </section>

      {categories.map((category, categoryIndex) => {
        const categoryCriteria = criteria.filter(
          (criterion) => criterion.category_id === category.id,
        );
        const categoryFeedback = feedback.find(
          (item) => item.category_id === category.id,
        );
        const assignedReviewer = categoryFeedback?.assigned_to
          ? profileMap.get(categoryFeedback.assigned_to)
          : undefined;
        const assignedReviewerName = assignedReviewer
          ? assignedReviewer.full_name ?? assignedReviewer.email ?? undefined
          : undefined;
        const average = categoryAverage(
          category.id,
          criteria,
          panelAverageScorecards,
          scores,
        );
        const isOverallProductionCategory =
          category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY;
        const subjectName = category.subject_label
          ? categorySubjectDefaults[category.category_key] ||
            comments.find(
              (comment) =>
                comment.category_id === category.id &&
                richTextToPlainText(comment.subject_name),
            )?.subject_name ||
            "Not provided"
          : null;
        const panelistAverages = panelRoster.map(({ assignment, scorecard }) => ({
          id: assignment.id,
          name:
            profileMap.get(assignment.adjudicator_user_id)?.full_name ??
            profileMap.get(assignment.adjudicator_user_id)?.email ??
            "Panelist",
          average: scorecardCategoryAverage(
            category.id,
            scorecard?.id ?? null,
            criteria,
            scores,
          ),
          contributesToPanelAverage:
            panelAveragePolicy.contributorUserIds.has(
              assignment.adjudicator_user_id,
            ),
        }));
        const categoryComments = comments.filter(
          (comment) =>
            comment.category_id === category.id &&
            narrativeSourceScorecardIds.has(comment.scorecard_id),
        );
        const liveDraft = composeLiveCommentDraft(
          category,
          categoryCriteria,
          narrativeSourceScorecards,
          scores,
          categoryComments,
        );

        return (
          <section
            className="panel score-category-panel panel-review-category"
            id={`category-${category.id}`}
            key={category.id}
          >
            <div className="panel-header scoring-category-header">
              <div>
                <span className="section-order">Category {categoryIndex + 1}</span>
                <h2>{category.title}</h2>
                {category.subject_label ? (
                  <p className="panel-review-category-subject">
                    <strong>{category.subject_label}:</strong> {subjectName}
                  </p>
                ) : null}
                {category.guidance && <p>{category.guidance}</p>}
              </div>
            </div>

            <div className="table-wrap criterion-score-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Criterion</th>
                    {panelRoster.map(({ assignment, scorecard }, panelistIndex) => (
                      <th
                        className={
                          advisoryScoreEntry?.currentUserId ===
                          assignment.adjudicator_user_id
                            ? "panel-review-own-score"
                            : undefined
                        }
                        key={assignment.id}
                      >
                        <span className="criterion-header-name">
                          {profileMap.get(assignment.adjudicator_user_id)?.full_name?.split(" ")[0] ??
                            "Panelist"}
                          {advisoryScoreEntry?.currentUserId ===
                          assignment.adjudicator_user_id
                            ? " · You"
                            : ""}
                        </span>
                        <span className="criterion-header-summary">
                          <small>
                            {!panelistAverages[panelistIndex]
                              ?.contributesToPanelAverage
                              ? "Advisory reference"
                              : scorecard
                                ? scorecardStatusLabel(scorecard.status)
                                : "Not started"}
                          </small>
                          <strong aria-label={`${panelistAverages[panelistIndex]?.name ?? "Panelist"} category average`}>
                            {formatScoreAverage(
                              panelistAverages[panelistIndex]?.average ?? null,
                            )}
                          </strong>
                        </span>
                      </th>
                    ))}
                    <th>
                      <span className="criterion-header-name">Average</span>
                      <span className="criterion-header-summary">
                        <small>
                          {panelAveragePolicy.adjudicatorOnly
                            ? "Adjudicators only"
                            : "Full panel"}
                        </small>
                        <strong aria-label={`${category.title} full panel average`}>
                          {formatScoreAverage(average)}
                        </strong>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categoryCriteria.map((criterion) => {
                    const criterionRows = panelRoster.map(
                      ({ assignment, scorecard }) => ({
                        assignment,
                        row: scorecard
                          ? scoreByCardAndCriterion.get(
                              `${scorecard.id}:${criterion.id}`,
                            )
                          : undefined,
                      }),
                    );
                    const numeric = criterionRows
                      .filter(({ assignment }) =>
                        panelAveragePolicy.contributorUserIds.has(
                          assignment.adjudicator_user_id,
                        ),
                      )
                      .map(({ row }) => row?.score)
                      .filter((value): value is number => typeof value === "number")
                      .map(Number);
                    const criterionAverage = numeric.length
                      ? roundScoreAverage(
                          numeric.reduce((sum, value) => sum + value, 0) /
                            numeric.length,
                        )
                      : null;

                    return (
                      <tr key={criterion.id}>
                        <td>
                          <strong>{criterion.title}</strong>
                          <CriterionDescription
                            description={criterion.description}
                          />
                          {!isOverallProductionCategory ? (
                            <div className="panel-review-criterion-guide">
                              <CriterionScoringGuideButton
                                categoryTitle={category.title}
                                criterionId={criterion.id}
                                criterionTitle={criterion.title}
                                productionTitle={productionTitle}
                              />
                            </div>
                          ) : null}
                        </td>
                        {criterionRows.map(({ assignment, row }) => {
                          const isEditableOwnColumn = Boolean(
                            advisoryScoreEntry &&
                              assignment.adjudicator_user_id ===
                                advisoryScoreEntry.currentUserId,
                          );
                          return (
                            <td
                              className={
                                isEditableOwnColumn
                                  ? "panel-review-own-score"
                                  : undefined
                              }
                              key={`${criterion.id}-${assignment.id}`}
                            >
                              {isEditableOwnColumn && advisoryScoreEntry ? (
                                <div className="panel-review-score-entry">
                                  {advisoryScoreEntry.canScore ? (
                                    <>
                                      <label htmlFor={`score_${criterion.id}`}>
                                        Your score
                                      </label>
                                      {isOverallProductionCategory ? (
                                        <output
                                          aria-label="Automatically calculated overall production score"
                                          className="derived-score-output"
                                        >
                                          {formatScore(row?.score)}
                                        </output>
                                      ) : (
                                        <select
                                          className="select score-select"
                                          defaultValue={row?.score ?? ""}
                                          disabled={advisoryScoreEntry.readOnly}
                                          id={`score_${criterion.id}`}
                                          name={`score_${criterion.id}`}
                                        >
                                          <option value="">—</option>
                                          {advisoryScoreEntry.scoreOptions.map(
                                            (option) => (
                                              <option
                                                key={option.value}
                                                value={option.value}
                                              >
                                                {option.value.toFixed(2)}
                                                {option.label
                                                  ? ` — ${option.label}`
                                                  : ""}
                                              </option>
                                            ),
                                          )}
                                        </select>
                                      )}
                                    </>
                                  ) : null}

                                  {advisoryScoreEntry.canComment &&
                                  !isOverallProductionCategory ? (
                                    <RichTextField
                                      defaultValue={row?.observation}
                                      disabled={advisoryScoreEntry.readOnly}
                                      id={`observation_${criterion.id}`}
                                      label="Your criterion comment"
                                      name={`observation_${criterion.id}`}
                                      placeholder="Enter observable notes for this criterion"
                                    />
                                  ) : !isOverallProductionCategory && row?.observation ? (
                                    <div className="live-score-observation">
                                      <RichTextPreview value={row.observation} />
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <>
                                  <strong>{formatScore(row?.score)}</strong>
                                  {row?.observation ? (
                                    <div className="live-score-observation">
                                      <RichTextPreview value={row.observation} />
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          <strong>{formatScoreAverage(criterionAverage)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {isOwner ? (
              <div className="panel-body">
                <LivePanelFeedbackEditor
                  key={`${category.id}:${categoryFeedback?.updated_at ?? "live"}`}
                  applicationId={applicationId}
                  assignedReviewerName={assignedReviewerName}
                  category={category}
                  feedback={categoryFeedback}
                  liveDraft={liveDraft}
                  onRefreshLiveNotes={refreshData}
                  panelApproved={Boolean(
                    categoryFeedback?.approved_by &&
                      ["adjudicator", "advisory_member"].includes(
                        profileMap.get(categoryFeedback.approved_by)?.role ?? "",
                      ),
                  )}
                />
              </div>
            ) : advisoryNarrativeReview ? (
              <AdvisoryCategoryNarrative
                applicationId={applicationId}
                category={category}
                categoryFeedback={categoryFeedback}
                narrativeReview={advisoryNarrativeReview}
                panelApproved={panelApprovedCategories.has(category.id)}
                reviewerMap={narrativeReviewerMap}
              />
            ) : null}
          </section>
        );
      })}

      {advisoryScoreEntry ? (
        <AdjudicationBigPictureComment
          canComment={advisoryScoreEntry.canComment}
          categories={categories}
          criteria={criteria}
          ownScores={ownAdvisoryScores}
          privateNotes={comments.find((comment) => {
            const overallCategory = categories.find(
              (category) =>
                category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY,
            );
            return (
              comment.scorecard_id === ownAdvisoryScorecard?.id &&
              comment.category_id === overallCategory?.id
            );
          })?.private_notes}
          readOnly={advisoryScoreEntry.readOnly}
        />
      ) : null}
    </>
  );
}

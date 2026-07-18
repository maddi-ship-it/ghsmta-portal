"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  generatePanelComment,
  reopenAdjudicatorScorecard,
  savePanelFeedback,
} from "@/app/portal/adjudication/[id]/actions";
import { formatScore } from "@/lib/adjudication";
import { createClient } from "@/lib/supabase/client";
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

function scorecardStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function uniqueText(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function bulletSection(title: string, values: string[]) {
  if (values.length === 0) return "";
  return `${title}\n${values.map((value) => `• ${value}`).join("\n")}`;
}

function composeLiveCommentDraft(
  category: ScoringCategory,
  comments: AdjudicationCategoryComment[],
) {
  const applicable = comments.filter((comment) => comment.is_applicable);
  const notApplicable = comments.filter((comment) => !comment.is_applicable);

  const sections = [
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
      uniqueText(notApplicable.map((comment) => comment.not_applicable_reason)),
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
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function LivePanelFeedbackEditor({
  applicationId,
  category,
  feedback,
  liveDraft,
}: {
  applicationId: string;
  category: ScoringCategory;
  feedback: AdjudicationPanelFeedback | undefined;
  liveDraft: string;
}) {
  const storedComment = feedback?.final_comment?.trim() ?? "";
  const [manualValue, setManualValue] = useState(storedComment);
  const [followingLiveDraft, setFollowingLiveDraft] = useState(!storedComment);
  const value = followingLiveDraft ? liveDraft : manualValue;

  return (
    <div className="panel-feedback-editor">
      <div className="panel-feedback-heading">
        <div>
          <h3>School-facing panel narrative</h3>
          <p>
            This box follows the live adjudicator comments until you begin editing.
            ChatGPT can turn the collected notes into a polished narrative.
          </p>
        </div>
        <form action={generatePanelComment.bind(null, applicationId, category.id)}>
          <button className="button button-secondary" type="submit">
            Generate with ChatGPT
          </button>
        </form>
      </div>

      <form
        action={savePanelFeedback.bind(null, applicationId, category.id)}
        className="form-stack"
      >
        <div className="field">
          <div className="field-label-row">
            <label htmlFor={`final_comment_${category.id}`}>Final panel comment</label>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setFollowingLiveDraft(true);
                setManualValue("");
              }}
            >
              Refresh from live comments
            </button>
          </div>
          <textarea
            className="textarea narrative-textarea"
            id={`final_comment_${category.id}`}
            name="final_comment"
            value={value}
            onChange={(event) => {
              setFollowingLiveDraft(false);
              setManualValue(event.target.value);
            }}
          />
          <small className="field-help">
            {followingLiveDraft
              ? "Following live comments. Typing here will preserve your manual edit."
              : "Manual edit preserved. Use Refresh from live comments to replace it."}
          </small>
        </div>
        <label className="check-row">
          <input
            name="approved"
            type="checkbox"
            defaultChecked={feedback?.status === "approved"}
          />
          Approved for school release
        </label>
        <button className="button button-dark" type="submit">
          Save panel narrative
        </button>
      </form>
    </div>
  );
}

export function OwnerLiveAdjudicationReview({
  applicationId,
  isOwner,
  categories,
  criteria,
  assignments,
  profiles,
  initialScorecards,
  initialScores,
  initialComments,
  initialFeedback,
  release,
}: {
  applicationId: string;
  isOwner: boolean;
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  assignments: AdjudicatorAssignment[];
  profiles: Profile[];
  initialScorecards: AdjudicationScorecard[];
  initialScores: AdjudicationScore[];
  initialComments: AdjudicationCategoryComment[];
  initialFeedback: AdjudicationPanelFeedback[];
  release: AdjudicationRelease | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [scorecards, setScorecards] = useState(initialScorecards);
  const [scores, setScores] = useState(initialScores);
  const [comments, setComments] = useState(initialComments);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "error">(
    isOwner ? "connecting" : "live",
  );
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  const refreshData = useCallback(async () => {
    const { data: scorecardData, error: scorecardError } = await supabase
      .from("adjudication_scorecards")
      .select("*")
      .eq("application_id", applicationId)
      .order("created_at");

    if (scorecardError) {
      setConnectionState("error");
      return;
    }

    const nextScorecards = (scorecardData ?? []) as AdjudicationScorecard[];
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
      return;
    }

    setScorecards(nextScorecards);
    setScores((scoreResult.data ?? []) as AdjudicationScore[]);
    setComments((commentResult.data ?? []) as AdjudicationCategoryComment[]);
    setFeedback((feedbackResult.data ?? []) as AdjudicationPanelFeedback[]);
    setLastUpdated(new Date());
    setConnectionState("live");
  }, [applicationId, supabase]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refreshData(), 150);
  }, [refreshData]);

  const scorecardKey = scorecards.map((scorecard) => scorecard.id).sort().join(",");

  useEffect(() => {
    if (!isOwner) return;

    const channels = [
      supabase
        .channel(`owner-scorecards:${applicationId}`)
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
        .channel(`owner-feedback:${applicationId}`)
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
          .channel(`owner-scores:${scorecardId}`)
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
          .channel(`owner-comments:${scorecardId}`)
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
  }, [applicationId, isOwner, refreshData, scheduleRefresh, scorecardKey, supabase]);

  const visibleScorecards = isOwner
    ? scorecards
    : scorecards.filter(
        (scorecard) => scorecard.status === "submitted" || scorecard.status === "locked",
      );

  return (
    <>
      {isOwner && (
        <div className={`live-review-status live-review-status-${connectionState}`}>
          <span aria-hidden="true" />
          <div>
            <strong>
              {connectionState === "live"
                ? "Live owner review"
                : connectionState === "connecting"
                  ? "Connecting to live scoring…"
                  : "Live connection interrupted"}
            </strong>
            <small>
              {lastUpdated
                ? `Last database update ${lastUpdated.toLocaleTimeString()}`
                : "Draft scores and comments will appear here as adjudicators save."}
            </small>
          </div>
          {connectionState === "error" && (
            <button className="button button-secondary button-compact" onClick={() => void refreshData()} type="button">
              Refresh now
            </button>
          )}
        </div>
      )}

      <section className="metric-grid adjudication-review-metrics" aria-label="Panel progress">
        <article className="metric-card">
          <span className="metric-label">Assigned</span>
          <strong className="metric-value">{assignments.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Started</span>
          <strong className="metric-value">{scorecards.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Submitted</span>
          <strong className="metric-value">
            {scorecards.filter(
              (card) => card.status === "submitted" || card.status === "locked",
            ).length}
          </strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">School release</span>
          <strong className="metric-text">
            {release?.scores_released_at || release?.feedback_released_at
              ? "Released"
              : "Not released"}
          </strong>
        </article>
      </section>

      <section className="panel panel-progress-section">
        <div className="panel-header">
          <div>
            <h2>Panel scorecards</h2>
            <p>{isOwner ? "Draft activity updates live." : "Submitted scorecards are shown."}</p>
          </div>
        </div>
        <div className="panel-body panelist-grid">
          {assignments.map((assignment) => {
            const adjudicator = profileMap.get(assignment.adjudicator_user_id);
            const card = scorecards.find((item) => item.assignment_id === assignment.id);
            return (
              <article className="panelist-card" key={assignment.id}>
                <div>
                  <strong>{adjudicator?.full_name ?? adjudicator?.email ?? "Adjudicator"}</strong>
                  <small>
                    {card
                      ? `Last saved ${new Date(card.updated_at).toLocaleString()}`
                      : assignment.due_at
                        ? `Due ${new Date(assignment.due_at).toLocaleString()}`
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
          {assignments.length === 0 && <p>No adjudicators have been assigned.</p>}
        </div>
      </section>

      {categories.map((category, categoryIndex) => {
        const categoryCriteria = criteria.filter(
          (criterion) => criterion.category_id === category.id,
        );
        const categoryFeedback = feedback.find(
          (item) => item.category_id === category.id,
        );
        const average = categoryAverage(
          category.id,
          criteria,
          visibleScorecards,
          scores,
        );
        const categoryComments = comments.filter(
          (comment) =>
            comment.category_id === category.id &&
            visibleScorecards.some((scorecard) => scorecard.id === comment.scorecard_id),
        );
        const liveDraft = composeLiveCommentDraft(category, categoryComments);

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
                {category.guidance && <p>{category.guidance}</p>}
              </div>
              <div className="category-average">
                <span>{isOwner ? "Live panel average" : "Panel average"}</span>
                <strong>{formatScore(average)}</strong>
              </div>
            </div>

            <div className="table-wrap criterion-score-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Criterion</th>
                    {visibleScorecards.map((card) => (
                      <th key={card.id}>
                        {profileMap.get(card.adjudicator_user_id)?.full_name?.split(" ")[0] ??
                          "Panelist"}
                        {isOwner && <small>{scorecardStatusLabel(card.status)}</small>}
                      </th>
                    ))}
                    <th>Average</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryCriteria.map((criterion) => {
                    const criterionRows = visibleScorecards.map((card) =>
                      scores.find(
                        (score) =>
                          score.scorecard_id === card.id &&
                          score.criterion_id === criterion.id,
                      ),
                    );
                    const numeric = criterionRows
                      .map((row) => row?.score)
                      .filter((value): value is number => typeof value === "number")
                      .map(Number);
                    const criterionAverage = numeric.length
                      ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length
                      : null;

                    return (
                      <tr key={criterion.id}>
                        <td>
                          <strong>{criterion.title}</strong>
                          <small>{criterion.description}</small>
                        </td>
                        {criterionRows.map((row, index) => (
                          <td key={`${criterion.id}-${index}`}>
                            <strong>{formatScore(row?.score)}</strong>
                            {row?.observation && (
                              <small className="live-score-observation">{row.observation}</small>
                            )}
                          </td>
                        ))}
                        <td>
                          <strong>{formatScore(criterionAverage)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="panel-body">
              <h3>{isOwner ? "Live adjudicator comments" : "Adjudicator comment quadrants"}</h3>
              <div className="raw-comment-grid">
                {visibleScorecards.map((card) => {
                  const panelist = profileMap.get(card.adjudicator_user_id);
                  const comment = comments.find(
                    (item) =>
                      item.scorecard_id === card.id && item.category_id === category.id,
                  );
                  return (
                    <article className="raw-comment-card" key={card.id}>
                      <div className="raw-comment-card-heading">
                        <h4>{panelist?.full_name ?? panelist?.email ?? "Adjudicator"}</h4>
                        <span className={`badge badge-scorecard-${card.status}`}>
                          {scorecardStatusLabel(card.status)}
                        </span>
                      </div>
                      {comment?.subject_name && (
                        <p><strong>Subject:</strong> {comment.subject_name}</p>
                      )}
                      {comment && !comment.is_applicable ? (
                        <p>
                          <strong>Not applicable:</strong>{" "}
                          {comment.not_applicable_reason ?? "No reason entered"}
                        </p>
                      ) : (
                        <>
                          <p><strong>Successes:</strong> {comment?.successes ?? "—"}</p>
                          <p><strong>Examples:</strong> {comment?.success_examples ?? "—"}</p>
                          <p><strong>Growth:</strong> {comment?.growth_areas ?? "—"}</p>
                          <p><strong>Growth examples:</strong> {comment?.growth_examples ?? "—"}</p>
                        </>
                      )}
                      {comment && (
                        <small className="live-comment-updated">
                          Saved {new Date(comment.updated_at).toLocaleTimeString()}
                        </small>
                      )}
                    </article>
                  );
                })}
                {visibleScorecards.length === 0 && <p>No scorecards are available yet.</p>}
              </div>

              {isOwner ? (
                <LivePanelFeedbackEditor
                  key={`${category.id}:${categoryFeedback?.updated_at ?? "live"}`}
                  applicationId={applicationId}
                  category={category}
                  feedback={categoryFeedback}
                  liveDraft={liveDraft}
                />
              ) : (
                <div className="narrative-preview">
                  {categoryFeedback?.final_comment || "No panel narrative has been prepared yet."}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}

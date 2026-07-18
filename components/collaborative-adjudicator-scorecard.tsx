"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

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

export function CollaborativeAdjudicatorScorecard({
  applicationId,
  currentUserId,
  currentUserName,
  categories,
  criteria,
  ownScores,
  ownComments,
  initialPanelRows,
  scoreOptions,
  readOnly,
}: {
  applicationId: string;
  currentUserId: string;
  currentUserName: string;
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  ownScores: AdjudicationScore[];
  ownComments: AdjudicationCategoryComment[];
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

    const timer = window.setInterval(
      refreshPanelComments,
      3000,
    );

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [applicationId, supabase]);

  const panelMembers = useMemo(
    () =>
      panelMembersFromRows(
        panelRows,
        currentUserId,
        currentUserName,
      ),
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
      new Map(
        ownScores.map((score) => [score.criterion_id, score]),
      ),
    [ownScores],
  );

  const ownCommentMap = useMemo(
    () =>
      new Map(
        ownComments.map((comment) => [
          comment.category_id,
          comment,
        ]),
      ),
    [ownComments],
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

      {categories.map((category, categoryIndex) => {
        const categoryCriteria = criteria.filter(
          (criterion) => criterion.category_id === category.id,
        );
        const categoryComment = ownCommentMap.get(category.id);

        return (
          <section
            className="panel score-category-panel"
            id={`category-${category.id}`}
            key={category.id}
          >
            <div className="panel-header scoring-category-header">
              <div>
                <span className="section-order">
                  Category {categoryIndex + 1}
                </span>
                <h2>{category.title}</h2>
                {category.guidance && <p>{category.guidance}</p>}
              </div>
            </div>

            <div className="panel-body">
              {category.subject_label && (
                <div className="field">
                  <label htmlFor={`subject_name_${category.id}`}>
                    {category.subject_label}
                  </label>
                  <input
                    className="input"
                    defaultValue={categoryComment?.subject_name ?? ""}
                    disabled={readOnly}
                    id={`subject_name_${category.id}`}
                    name={`subject_name_${category.id}`}
                  />
                </div>
              )}

              {category.allow_not_applicable && (
                <div className="not-applicable-box">
                  <label className="check-row">
                    <input
                      defaultChecked={
                        categoryComment
                          ? !categoryComment.is_applicable
                          : false
                      }
                      disabled={readOnly}
                      name={`not_applicable_${category.id}`}
                      type="checkbox"
                    />
                    This category is not applicable
                  </label>

                  <div className="field">
                    <label
                      htmlFor={`not_applicable_reason_${category.id}`}
                    >
                      Reason when not applicable
                    </label>
                    <input
                      className="input"
                      defaultValue={
                        categoryComment?.not_applicable_reason ?? ""
                      }
                      disabled={readOnly}
                      id={`not_applicable_reason_${category.id}`}
                      name={`not_applicable_reason_${category.id}`}
                    />
                  </div>
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

                  <span className="personal-score-heading">
                    Your score
                  </span>
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
                        {criterion.description && (
                          <p>{criterion.description}</p>
                        )}
                      </div>

                      <div
                        className="panel-comment-columns"
                        style={commentColumnsStyle}
                      >
                        {panelMembers.map((member) => {
                          const isCurrentUser =
                            member.userId === currentUserId;
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
                                  <RichTextPreview
                                    value={sharedObservation}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="personal-score-column">
                        <label htmlFor={`score_${criterion.id}`}>
                          Your score
                        </label>
                        <select
                          className="select score-select"
                          defaultValue={savedScore?.score ?? ""}
                          disabled={readOnly}
                          id={`score_${criterion.id}`}
                          name={`score_${criterion.id}`}
                        >
                          <option value="">—</option>

                          {scoreOptions.map((option) => (
                            <option
                              key={option.value}
                              value={option.value}
                            >
                              {option.value.toFixed(2)}
                              {option.label
                                ? ` — ${option.label}`
                                : ""}
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
                    Private notes are never included in the school release or
                    sent to OpenAI.
                  </small>
                </div>
              </details>
            </div>
          </section>
        );
      })}
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatScore,
  quarterScoreOptions,
} from "@/lib/adjudication";
import { AdjudicatorAutosave } from "@/components/adjudicator-autosave";
import { OwnerLiveAdjudicationReview } from "@/components/owner-live-adjudication-review";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationCategoryComment,
  AdjudicationPanelFeedback,
  AdjudicationRelease,
  AdjudicationScore,
  AdjudicationScorecard,
  AdjudicatorAssignment,
  Application,
  AwardCycle,
  Profile,
  ScoringCategory,
  ScoringCriterion,
  ScoringRubric,
  ScoringScaleLevel,
} from "@/lib/types";

import {
  releaseAdjudicationResults,
  saveAdjudicatorScorecard,
} from "./actions";

function scorecardStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default async function AdjudicationApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    submitted?: string;
    generated?: string;
    released?: string;
    error?: string;
    missing?: string;
  }>;
}) {
  const profile = await requireProfile(["adjudicator", "advisory_member", "owner"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data: applicationData, error: applicationError } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .single();
  if (applicationError || !applicationData) notFound();
  const application = applicationData as Application;

  const { data: cycleData } = await supabase.from("award_cycles").select("*").eq("id", application.cycle_id).single();
  const cycle = cycleData as AwardCycle | null;

  const { data: rubricData, error: rubricError } = await supabase
    .from("scoring_rubrics")
    .select("*")
    .eq("cycle_id", application.cycle_id)
    .eq("status", "published")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rubricError) throw new Error(rubricError.message);
  const rubric = rubricData as ScoringRubric | null;

  if (!rubric) {
    return (
      <>
        <div className="page-heading"><div><h1>{application.school_name}</h1><p>{application.production_title ?? "Untitled production"}</p></div></div>
        <section className="panel"><div className="empty-state"><h3>No published scoring rubric</h3><p>An owner must seed or publish a rubric for this program before adjudication can begin.</p>{profile.role === "owner" && <Link className="button button-dark" href="/portal/admin/scoring">Open scoring setup</Link>}</div></section>
      </>
    );
  }

  const [categoriesResult, scaleResult, assignmentsResult, scorecardsResult, feedbackResult, releaseResult] = await Promise.all([
    supabase.from("scoring_categories").select("*").eq("rubric_id", rubric.id).eq("active", true).order("sort_order"),
    supabase.from("scoring_scale_levels").select("*").eq("rubric_id", rubric.id).order("score", { ascending: false }),
    profile.role === "adjudicator"
      ? supabase.from("adjudicator_assignments").select("*").eq("application_id", id).eq("adjudicator_user_id", profile.id)
      : supabase.from("adjudicator_assignments").select("*").eq("application_id", id).order("assigned_at"),
    profile.role === "adjudicator"
      ? supabase.from("adjudication_scorecards").select("*").eq("application_id", id).eq("adjudicator_user_id", profile.id)
      : supabase.from("adjudication_scorecards").select("*").eq("application_id", id).order("created_at"),
    profile.role === "adjudicator"
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("adjudication_panel_feedback").select("*").eq("application_id", id),
    profile.role === "adjudicator"
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("adjudication_releases").select("*").eq("application_id", id).maybeSingle(),
  ]);

  const categories = (categoriesResult.data ?? []) as ScoringCategory[];
  const scale = (scaleResult.data ?? []) as ScoringScaleLevel[];
  const scoreOptions = quarterScoreOptions(
    Number(rubric.score_min),
    Number(rubric.score_max),
  );

  const scaleLabels = new Map(
    scale.map((level) => [
      Number(level.score),
      level.label,
    ]),
  );

  const assignments = (assignmentsResult.data ?? []) as AdjudicatorAssignment[];
  const scorecards = (scorecardsResult.data ?? []) as AdjudicationScorecard[];
  const feedback = (feedbackResult.data ?? []) as AdjudicationPanelFeedback[];
  const release = releaseResult.data as AdjudicationRelease | null;

  if (profile.role === "adjudicator" && assignments.length === 0) notFound();

  const categoryIds = categories.map((category) => category.id);
  const scorecardIds = scorecards.map((card) => card.id);
  const [criteriaResult, scoresResult, commentsResult] = await Promise.all([
    categoryIds.length
      ? supabase.from("scoring_criteria").select("*").in("category_id", categoryIds).eq("active", true).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
    scorecardIds.length
      ? supabase.from("adjudication_scores").select("*").in("scorecard_id", scorecardIds)
      : Promise.resolve({ data: [], error: null }),
    scorecardIds.length
      ? supabase.from("adjudication_category_comments").select("*").in("scorecard_id", scorecardIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const criteria = (criteriaResult.data ?? []) as ScoringCriterion[];
  const scores = (scoresResult.data ?? []) as AdjudicationScore[];
  const comments = (commentsResult.data ?? []) as AdjudicationCategoryComment[];

  let adjudicatorProfiles: Profile[] = [];
  if (profile.role !== "adjudicator") {
    const profileIds = [...new Set(assignments.map((assignment) => assignment.adjudicator_user_id))];
    if (profileIds.length > 0) {
      const { data } = await supabase.from("profiles").select("id,email,full_name,role,active").in("id", profileIds);
      adjudicatorProfiles = (data ?? []) as Profile[];
    }
  }
  const ownScorecard = profile.role === "adjudicator" ? scorecards[0] ?? null : null;
  const ownScoreMap = new Map(
    scores.filter((score) => score.scorecard_id === ownScorecard?.id).map((score) => [score.criterion_id, score]),
  );
  const ownCommentMap = new Map(
    comments.filter((comment) => comment.scorecard_id === ownScorecard?.id).map((comment) => [comment.category_id, comment]),
  );
  const readOnly = ownScorecard?.status === "submitted" || ownScorecard?.status === "locked";

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Adjudication"}</span>
          <h1>{application.school_name}</h1>
          <p>{application.production_title ?? "Untitled production"}</p>
        </div>
        <div className="heading-actions">
          {profile.role === "adjudicator" && <span className={`badge badge-scorecard-${ownScorecard?.status ?? "draft"}`}>{scorecardStatusLabel(ownScorecard?.status ?? "not started")}</span>}
          <Link className="button button-secondary" href="/portal/adjudication">Back to adjudication</Link>
        </div>
      </div>

      {query.saved && <div className="notice page-message">Your scorecard draft was saved.</div>}
      {query.submitted && <div className="notice page-message">Your scorecard was submitted and is now read-only.</div>}
      {query.generated && <div className="notice page-message">The AI narrative draft was generated. Review and edit it before approval.</div>}
      {query.released && <div className="notice page-message">The selected results were released to the school as a snapshot.</div>}
      {query.error === "required" && <div className="form-error page-message">Complete the missing scores and all four comment quadrants before submitting. Missing items: {query.missing ?? "one or more"}.</div>}

      <div className="adjudication-score-layout">
        <aside className="score-category-sidebar">
          <div className="score-category-sidebar-heading">
            <span className="eyebrow">Scorecard</span>
            <h2>Categories</h2>
            <p>Select a category to jump to that section.</p>
          </div>

          <nav
            className="score-category-tabs"
            aria-label="Scoring categories"
          >
            {categories.map((category, index) => (
              <a
                href={`#category-${category.id}`}
                key={category.id}
              >
                <span>{index + 1}</span>
                <strong>{category.title}</strong>
              </a>
            ))}
          </nav>
        </aside>

        <div className="adjudication-score-content">
      {profile.role === "adjudicator" ? (
        <form className="scorecard-form">
          <AdjudicatorAutosave
            applicationId={id}
            disabled={readOnly}
          />
          <section className="panel score-guide-panel">
            <div className="panel-header"><div><h2>Scoring guide</h2><p>Use the 1–10 scale in 0.25-point increments. Scores remain private to you, advisory members, and owners.</p></div></div>
            <div className="score-scale-grid">
              {scale.map((level) => <div key={level.id}><strong>{formatScore(level.score)}</strong><span>{level.label}</span><small>{level.description}</small></div>)}
            </div>
          </section>

          {categories.map((category, categoryIndex) => {
            const categoryCriteria = criteria.filter((criterion) => criterion.category_id === category.id);
            const categoryComment = ownCommentMap.get(category.id);
            return (
              <section className="panel score-category-panel" id={`category-${category.id}`} key={category.id}>
                <div className="panel-header scoring-category-header">
                  <div><span className="section-order">Category {categoryIndex + 1}</span><h2>{category.title}</h2>{category.guidance && <p>{category.guidance}</p>}</div>
                </div>
                <div className="panel-body">
                  {category.subject_label && <div className="field"><label htmlFor={`subject_name_${category.id}`}>{category.subject_label}</label><input className="input" id={`subject_name_${category.id}`} name={`subject_name_${category.id}`} defaultValue={categoryComment?.subject_name ?? ""} disabled={readOnly} /></div>}
                  {category.allow_not_applicable && (
                    <div className="not-applicable-box">
                      <label className="check-row"><input name={`not_applicable_${category.id}`} type="checkbox" defaultChecked={categoryComment ? !categoryComment.is_applicable : false} disabled={readOnly} />This category is not applicable</label>
                      <div className="field"><label htmlFor={`not_applicable_reason_${category.id}`}>Reason when not applicable</label><input className="input" id={`not_applicable_reason_${category.id}`} name={`not_applicable_reason_${category.id}`} defaultValue={categoryComment?.not_applicable_reason ?? ""} disabled={readOnly} /></div>
                    </div>
                  )}

                  <div className="criterion-list">
                    {categoryCriteria.map((criterion) => {
                      const savedScore = ownScoreMap.get(criterion.id);
                      return (
                        <article className="criterion-card" key={criterion.id}>
                          <div className="criterion-copy"><h3>{criterion.title}</h3>{criterion.description && <p>{criterion.description}</p>}</div>
                          <div className="criterion-entry">
                            <div className="field">
                              <label htmlFor={`score_${criterion.id}`}>
                                Score
                              </label>

                              <select
                                className="select score-select"
                                id={`score_${criterion.id}`}
                                name={`score_${criterion.id}`}
                                defaultValue={savedScore?.score ?? ""}
                                disabled={readOnly}
                              >
                                <option value="">—</option>

                                {scoreOptions.map((score) => {
                                  const label = scaleLabels.get(score);

                                  return (
                                    <option value={score} key={score}>
                                      {score.toFixed(2)}
                                      {label ? ` — ${label}` : ""}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                            <div className="field"><label htmlFor={`observation_${criterion.id}`}>Criterion observation</label><textarea className="textarea compact-textarea" id={`observation_${criterion.id}`} name={`observation_${criterion.id}`} defaultValue={savedScore?.observation ?? ""} disabled={readOnly} /></div>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="comment-quadrant-grid">
                    <div className="field"><label htmlFor={`successes_${category.id}`}>Successes</label><textarea className="textarea" id={`successes_${category.id}`} name={`successes_${category.id}`} defaultValue={categoryComment?.successes ?? ""} disabled={readOnly} placeholder="Brief strengths or successful choices" /></div>
                    <div className="field"><label htmlFor={`success_examples_${category.id}`}>Specific success examples</label><textarea className="textarea" id={`success_examples_${category.id}`} name={`success_examples_${category.id}`} defaultValue={categoryComment?.success_examples ?? ""} disabled={readOnly} placeholder="Moments, songs, scenes, or technical examples" /></div>
                    <div className="field"><label htmlFor={`growth_areas_${category.id}`}>Opportunities for growth</label><textarea className="textarea" id={`growth_areas_${category.id}`} name={`growth_areas_${category.id}`} defaultValue={categoryComment?.growth_areas ?? ""} disabled={readOnly} placeholder="Constructive areas for continued development" /></div>
                    <div className="field"><label htmlFor={`growth_examples_${category.id}`}>Specific growth examples</label><textarea className="textarea" id={`growth_examples_${category.id}`} name={`growth_examples_${category.id}`} defaultValue={categoryComment?.growth_examples ?? ""} disabled={readOnly} placeholder="Observed moments supporting the feedback" /></div>
                  </div>
                  <div className="field"><label htmlFor={`private_notes_${category.id}`}>Private adjudicator notes</label><textarea className="textarea compact-textarea" id={`private_notes_${category.id}`} name={`private_notes_${category.id}`} defaultValue={categoryComment?.private_notes ?? ""} disabled={readOnly} /><small className="field-help">Private notes are never included in the school release or sent to OpenAI.</small></div>
                </div>
              </section>
            );
          })}

          <section className="panel"><div className="panel-body"><div className="field"><label htmlFor="scorecard_internal_notes">Overall private notes</label><textarea className="textarea" id="scorecard_internal_notes" name="scorecard_internal_notes" defaultValue={ownScorecard?.internal_notes ?? ""} disabled={readOnly} /></div></div></section>

          {!readOnly && <div className="application-action-bar scorecard-action-bar"><button className="button button-secondary" formAction={saveAdjudicatorScorecard.bind(null, id, false)} type="submit">Save draft</button><button className="button button-dark" formAction={saveAdjudicatorScorecard.bind(null, id, true)} type="submit">Submit scorecard</button></div>}
        </form>
      ) : (
        <>
          <OwnerLiveAdjudicationReview
            applicationId={id}
            isOwner={profile.role === "owner"}
            categories={categories}
            criteria={criteria}
            assignments={assignments}
            profiles={adjudicatorProfiles}
            initialScorecards={scorecards}
            initialScores={scores}
            initialComments={comments}
            initialFeedback={feedback}
            release={release}
          />

          {profile.role === "owner" && (
            <section className="panel release-panel">
              <div className="panel-header">
                <div>
                  <h2>Release results to the school</h2>
                  <p>
                    This creates a separate snapshot. Raw adjudicator scores,
                    identities, observations, and private notes are never exposed
                    to applicant accounts.
                  </p>
                </div>
              </div>
              <div className="panel-body">
                <form
                  action={releaseAdjudicationResults.bind(null, id)}
                  className="form-stack"
                >
                  <div className="release-choice-grid">
                    <label className="check-card">
                      <input name="release_scores" type="checkbox" />
                      <span>
                        <strong>Release category averages</strong>
                        <small>
                          Schools receive panel category averages only—not
                          individual adjudicator scores.
                        </small>
                      </span>
                    </label>
                    <label className="check-card">
                      <input name="release_feedback" type="checkbox" />
                      <span>
                        <strong>Release approved narratives</strong>
                        <small>Only approved final comments are included.</small>
                      </span>
                    </label>
                  </div>
                  <div className="field">
                    <label htmlFor="release_notes">Release note</label>
                    <textarea
                      className="textarea compact-textarea"
                      id="release_notes"
                      name="release_notes"
                      defaultValue={release?.release_notes ?? ""}
                    />
                  </div>
                  <button className="button button-dark" type="submit">
                    Release selected results
                  </button>
                </form>
              </div>
            </section>
          )}
        </>
      )}
        </div>
      </div>
    </>
  );
}

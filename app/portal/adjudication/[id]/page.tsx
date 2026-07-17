import Link from "next/link";
import { notFound } from "next/navigation";

import {
  categoryAverage,
  formatScore,
} from "@/lib/adjudication";
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
  generatePanelComment,
  releaseAdjudicationResults,
  reopenAdjudicatorScorecard,
  saveAdjudicatorScorecard,
  savePanelFeedback,
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
  const profileMap = new Map(adjudicatorProfiles.map((item) => [item.id, item]));

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

      <nav className="score-category-tabs" aria-label="Scoring categories">
        {categories.map((category, index) => <a href={`#category-${category.id}`} key={category.id}><span>{index + 1}</span>{category.title}</a>)}
      </nav>

      {profile.role === "adjudicator" ? (
        <form className="scorecard-form">
          <section className="panel score-guide-panel">
            <div className="panel-header"><div><h2>Scoring guide</h2><p>Use the same 1–10 scale across each criterion. Scores remain private to you, advisory members, and owners.</p></div></div>
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
                            <div className="field"><label htmlFor={`score_${criterion.id}`}>Score</label><select className="select score-select" id={`score_${criterion.id}`} name={`score_${criterion.id}`} defaultValue={savedScore?.score ?? ""} disabled={readOnly}><option value="">—</option>{scale.map((level) => <option value={level.score} key={level.id}>{formatScore(level.score)} — {level.label}</option>)}</select></div>
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
          <section className="metric-grid adjudication-review-metrics" aria-label="Panel progress">
            <article className="metric-card"><span className="metric-label">Assigned</span><strong className="metric-value">{assignments.length}</strong></article>
            <article className="metric-card"><span className="metric-label">Submitted</span><strong className="metric-value">{scorecards.filter((card) => card.status === "submitted" || card.status === "locked").length}</strong></article>
            <article className="metric-card"><span className="metric-label">Scores released</span><strong className="metric-text">{release?.scores_released_at ? new Date(release.scores_released_at).toLocaleDateString() : "Not released"}</strong></article>
            <article className="metric-card"><span className="metric-label">Feedback released</span><strong className="metric-text">{release?.feedback_released_at ? new Date(release.feedback_released_at).toLocaleDateString() : "Not released"}</strong></article>
          </section>

          <section className="panel panel-progress-section">
            <div className="panel-header"><h2>Panel scorecards</h2></div>
            <div className="panel-body panelist-grid">
              {assignments.map((assignment) => {
                const adjudicator = profileMap.get(assignment.adjudicator_user_id);
                const card = scorecards.find((item) => item.assignment_id === assignment.id);
                return <article className="panelist-card" key={assignment.id}><div><strong>{adjudicator?.full_name ?? adjudicator?.email ?? "Adjudicator"}</strong><small>{card?.submitted_at ? `Submitted ${new Date(card.submitted_at).toLocaleString()}` : assignment.due_at ? `Due ${new Date(assignment.due_at).toLocaleString()}` : "No due date"}</small></div><span className={`badge badge-scorecard-${card?.status ?? assignment.status}`}>{scorecardStatusLabel(card?.status ?? assignment.status)}</span>{profile.role === "owner" && card && (card.status === "submitted" || card.status === "locked") && <form action={reopenAdjudicatorScorecard.bind(null, id, card.id)}><button className="button button-secondary button-compact" type="submit">Reopen</button></form>}</article>;
              })}
              {assignments.length === 0 && <p>No adjudicators have been assigned.</p>}
            </div>
          </section>

          {categories.map((category, categoryIndex) => {
            const categoryCriteria = criteria.filter((criterion) => criterion.category_id === category.id);
            const categoryFeedback = feedback.find((item) => item.category_id === category.id);
            const average = categoryAverage(category.id, criteria, scorecards, scores);
            const submittedCards = scorecards.filter((card) => card.status === "submitted" || card.status === "locked");
            return (
              <section className="panel score-category-panel panel-review-category" id={`category-${category.id}`} key={category.id}>
                <div className="panel-header scoring-category-header"><div><span className="section-order">Category {categoryIndex + 1}</span><h2>{category.title}</h2>{category.guidance && <p>{category.guidance}</p>}</div><div className="category-average"><span>Panel average</span><strong>{formatScore(average)}</strong></div></div>

                <div className="table-wrap criterion-score-table"><table className="data-table"><thead><tr><th>Criterion</th>{submittedCards.map((card) => <th key={card.id}>{profileMap.get(card.adjudicator_user_id)?.full_name?.split(" ")[0] ?? "Panelist"}</th>)}<th>Average</th></tr></thead><tbody>{categoryCriteria.map((criterion) => { const criterionScores = submittedCards.map((card) => scores.find((score) => score.scorecard_id === card.id && score.criterion_id === criterion.id)?.score ?? null); const numeric = criterionScores.filter((value): value is number => typeof value === "number"); const criterionAverage = numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null; return <tr key={criterion.id}><td><strong>{criterion.title}</strong><small>{criterion.description}</small></td>{criterionScores.map((value, index) => <td key={`${criterion.id}-${index}`}>{formatScore(value)}</td>)}<td><strong>{formatScore(criterionAverage)}</strong></td></tr>; })}</tbody></table></div>

                <div className="panel-body">
                  <h3>Adjudicator comment quadrants</h3>
                  <div className="raw-comment-grid">
                    {submittedCards.map((card) => {
                      const panelist = profileMap.get(card.adjudicator_user_id);
                      const comment = comments.find((item) => item.scorecard_id === card.id && item.category_id === category.id);
                      return <article className="raw-comment-card" key={card.id}><h4>{panelist?.full_name ?? panelist?.email ?? "Adjudicator"}</h4>{comment?.subject_name && <p><strong>Subject:</strong> {comment.subject_name}</p>}{comment && !comment.is_applicable ? <p><strong>Not applicable:</strong> {comment.not_applicable_reason ?? "No reason entered"}</p> : <><p><strong>Successes:</strong> {comment?.successes ?? "—"}</p><p><strong>Examples:</strong> {comment?.success_examples ?? "—"}</p><p><strong>Growth:</strong> {comment?.growth_areas ?? "—"}</p><p><strong>Growth examples:</strong> {comment?.growth_examples ?? "—"}</p></>}</article>;
                    })}
                    {submittedCards.length === 0 && <p>No submitted comments are available yet.</p>}
                  </div>

                  <div className="panel-feedback-editor">
                    <div className="panel-feedback-heading"><div><h3>School-facing panel narrative</h3><p>AI creates a draft from the submitted quadrants. An owner must review, edit, and approve it before release.</p></div>{profile.role === "owner" && <form action={generatePanelComment.bind(null, id, category.id)}><button className="button button-secondary" type="submit">Generate with ChatGPT</button></form>}</div>
                    {profile.role === "owner" ? <form action={savePanelFeedback.bind(null, id, category.id)} className="form-stack"><div className="field"><label htmlFor={`final_comment_${category.id}`}>Final panel comment</label><textarea className="textarea narrative-textarea" id={`final_comment_${category.id}`} name="final_comment" defaultValue={categoryFeedback?.final_comment ?? ""} /></div><label className="check-row"><input name="approved" type="checkbox" defaultChecked={categoryFeedback?.status === "approved"} />Approved for school release</label><button className="button button-dark" type="submit">Save panel narrative</button></form> : <div className="narrative-preview">{categoryFeedback?.final_comment || "No panel narrative has been prepared yet."}</div>}
                  </div>
                </div>
              </section>
            );
          })}

          {profile.role === "owner" && <section className="panel release-panel"><div className="panel-header"><div><h2>Release results to the school</h2><p>This creates a separate snapshot. Raw adjudicator scores, identities, observations, and private notes are never exposed to applicant accounts.</p></div></div><div className="panel-body"><form action={releaseAdjudicationResults.bind(null, id)} className="form-stack"><div className="release-choice-grid"><label className="check-card"><input name="release_scores" type="checkbox" /><span><strong>Release category averages</strong><small>Schools receive panel category averages only—not individual adjudicator scores.</small></span></label><label className="check-card"><input name="release_feedback" type="checkbox" /><span><strong>Release approved narratives</strong><small>Only approved final comments are included.</small></span></label></div><div className="field"><label htmlFor="release_notes">Release note</label><textarea className="textarea compact-textarea" id="release_notes" name="release_notes" defaultValue={release?.release_notes ?? ""} /></div><button className="button button-dark" type="submit">Release selected results</button></form></div></section>}
        </>
      )}
    </>
  );
}

import { notFound } from "next/navigation";

import { ApplicationQuestionField } from "@/components/application-question-field";
import { requireProfile } from "@/lib/auth";
import { formatDate, statusLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type {
  Application,
  ApplicationAnswer,
  ApplicationFormVersion,
  ApplicationQuestion,
  ApplicationSection,
} from "@/lib/types";

import {
  saveApplicationAnswers,
  submitApplication,
  updateApplication,
} from "./actions";

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    submitted?: string;
    error?: string;
    missing?: string;
  }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("applications").select("*").eq("id", id).single();
  if (!data) notFound();
  const application = data as Application;

  const [versionResult, sectionsResult, questionsResult, answersResult] =
    application.form_version_id
      ? await Promise.all([
          supabase
            .from("application_form_versions")
            .select("id,cycle_id,version_number,name,status,published_at,created_at,updated_at")
            .eq("id", application.form_version_id)
            .single(),
          supabase
            .from("application_sections")
            .select("id,form_version_id,title,description,sort_order,created_at,updated_at")
            .eq("form_version_id", application.form_version_id)
            .order("sort_order")
            .order("created_at"),
          supabase
            .from("application_questions")
            .select("id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,created_at,updated_at")
            .eq("form_version_id", application.form_version_id)
            .eq("active", true)
            .order("sort_order")
            .order("created_at"),
          supabase
            .from("application_answers")
            .select("id,application_id,question_id,value,updated_at")
            .eq("application_id", id),
        ])
      : [
          { data: null },
          { data: [] },
          { data: [] },
          { data: [] },
        ];

  const formVersion = versionResult.data as ApplicationFormVersion | null;
  const sections = (sectionsResult.data ?? []) as ApplicationSection[];
  const questions = (questionsResult.data ?? []) as ApplicationQuestion[];
  const answers = (answersResult.data ?? []) as ApplicationAnswer[];
  const answerMap = new Map(answers.map((answer) => [answer.question_id, answer.value]));

  const canEditMetadata = profile.role === "owner";
  const canEditAnswers =
    profile.role === "owner" ||
    (profile.role === "applicant" &&
      application.applicant_user_id === profile.id &&
      application.status === "draft");

  const answeredCount = questions.filter((question) => {
    if (question.question_type === "content") return false;
    const value = answerMap.get(question.id);
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
  const answerableCount = questions.filter(
    (question) => question.question_type !== "content",
  ).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{application.school_name}</h1>
          <p>{application.production_title ?? "Production title not entered"}</p>
        </div>
        <span className={`badge badge-${application.status}`}>
          {statusLabel(application.status)}
        </span>
      </div>

      {query.saved && <div className="notice page-message">Your draft was saved.</div>}
      {query.submitted && (
        <div className="notice page-message">Your application was submitted successfully.</div>
      )}
      {query.error === "required" && (
        <div className="form-error page-message">
          Complete all required questions before submitting. {query.missing ?? "One or more"} required fields are missing.
        </div>
      )}

      <section className="metric-grid application-metrics" aria-label="Application overview">
        <article className="metric-card">
          <span className="metric-label">Status</span>
          <strong className="metric-text">{statusLabel(application.status)}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Progress</span>
          <strong className="metric-text">{answeredCount} of {answerableCount}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Submitted</span>
          <strong className="metric-text">{formatDate(application.submitted_at)}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Form</span>
          <strong className="metric-text">{formVersion?.name ?? "Legacy application"}</strong>
        </article>
      </section>

      {canEditMetadata && (
        <section className="panel owner-controls-panel">
          <div className="panel-header"><h2>Owner controls</h2></div>
          <div className="panel-body">
            <form action={updateApplication.bind(null, id)} className="owner-controls-grid">
              <div className="field">
                <label htmlFor="school_name">School name</label>
                <input className="input" id="school_name" name="school_name" defaultValue={application.school_name} required />
              </div>
              <div className="field">
                <label htmlFor="production_title">Production title</label>
                <input className="input" id="production_title" name="production_title" defaultValue={application.production_title ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="status">Status</label>
                <select className="select" id="status" name="status" defaultValue={application.status}>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="under_review">Under review</option>
                  <option value="complete">Complete</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </div>
              <div className="field owner-notes-field">
                <label htmlFor="owner_notes">Internal owner notes</label>
                <textarea className="textarea" id="owner_notes" name="owner_notes" defaultValue={application.owner_notes ?? ""} />
              </div>
              <button className="button button-dark" type="submit">Save application details</button>
            </form>
          </div>
        </section>
      )}

      {!application.form_version_id ? (
        <section className="panel">
          <div className="empty-state">
            <h3>This is a legacy application record.</h3>
            <p>It is not connected to a versioned form yet.</p>
          </div>
        </section>
      ) : sections.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <h3>The application form has no sections.</h3>
            <p>An owner must add questions in the form builder.</p>
          </div>
        </section>
      ) : (
        <form action={saveApplicationAnswers.bind(null, id)} className="application-form">
          {sections.map((section) => {
            const sectionQuestions = questions.filter(
              (question) => question.section_id === section.id,
            );

            return (
              <section className="panel application-section" key={section.id}>
                <div className="panel-header application-section-header">
                  <div>
                    <span className="section-order">Section {sections.indexOf(section) + 1}</span>
                    <h2>{section.title}</h2>
                    {section.description && <p>{section.description}</p>}
                  </div>
                </div>
                <div className="panel-body application-question-list">
                  {sectionQuestions.length === 0 ? (
                    <p>No active questions in this section.</p>
                  ) : (
                    sectionQuestions.map((question) => (
                      <ApplicationQuestionField
                        disabled={!canEditAnswers}
                        key={question.id}
                        question={question}
                        value={answerMap.get(question.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}

          {canEditAnswers && (
            <div className="application-action-bar">
              <button className="button button-secondary-light" type="submit">
                Save draft
              </button>
              {application.status === "draft" && (
                <button
                  className="button button-dark"
                  formAction={submitApplication.bind(null, id)}
                  type="submit"
                >
                  Submit application
                </button>
              )}
            </div>
          )}
        </form>
      )}
    </>
  );
}

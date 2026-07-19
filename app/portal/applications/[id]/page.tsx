import Link from "next/link";
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
  ApplicationStage,
  ApplicationStageProgress,
  AwardCycle,
} from "@/lib/types";

import {
  duplicateApplicationRecord,
  saveApplicationAnswers,
  submitApplicationStage,
  updateApplication,
} from "./actions";

function hasAnswer(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    stage?: string;
    saved?: string;
    submitted?: string;
    stage_submitted?: string;
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

  let applicantCanEdit = false;
  if (profile.role === "applicant") {
    const { data: canEditData, error: canEditError } = await supabase.rpc(
      "can_edit_application",
      { p_application_id: id },
    );

    if (canEditError) throw new Error(canEditError.message);
    applicantCanEdit = Boolean(canEditData);
  }

  const [versionResult, stagesResult, progressResult, sectionsResult, questionsResult, answersResult, cyclesResult] =
    application.form_version_id
      ? await Promise.all([
          supabase
            .from("application_form_versions")
            .select("id,cycle_id,version_number,name,status,published_at,created_at,updated_at")
            .eq("id", application.form_version_id)
            .single(),
          supabase
            .from("application_stages")
            .select("id,form_version_id,stage_key,title,description,sort_order,is_initial,applicant_visible,opens_at,closes_at,settings,created_at,updated_at")
            .eq("form_version_id", application.form_version_id)
            .order("sort_order")
            .order("created_at"),
          supabase
            .from("application_stage_progress")
            .select("id,application_id,stage_id,status,started_at,submitted_at,completed_at,reopened_at,owner_notes,created_at,updated_at")
            .eq("application_id", id),
          supabase
            .from("application_sections")
            .select("id,form_version_id,stage_id,title,description,sort_order,created_at,updated_at")
            .eq("form_version_id", application.form_version_id)
            .order("sort_order")
            .order("created_at"),
          supabase
            .from("application_questions")
            .select("id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,source_column_index,source_label,imported,created_at,updated_at")
            .eq("form_version_id", application.form_version_id)
            .eq("active", true)
            .order("sort_order")
            .order("created_at"),
          supabase
            .from("application_answers")
            .select("id,application_id,question_id,value,updated_at")
            .eq("application_id", id),
          supabase
            .from("award_cycles")
            .select("id,cycle_key,name,season_year,program_type,description,status,opens_at,closes_at,is_active,cloned_from_cycle_id,created_at,updated_at")
            .order("season_year", { ascending: false })
            .order("name"),
        ])
      : [
          { data: null },
          { data: [] },
          { data: [] },
          { data: [] },
          { data: [] },
          { data: [] },
          { data: [] },
        ];

  const formVersion = versionResult.data as ApplicationFormVersion | null;
  const allStages = (stagesResult.data ?? []) as ApplicationStage[];
  const stages =
    profile.role === "applicant"
      ? allStages.filter((stage) => stage.applicant_visible)
      : allStages;
  const progress = (progressResult.data ?? []) as ApplicationStageProgress[];
  const sections = (sectionsResult.data ?? []) as ApplicationSection[];
  const questions = (questionsResult.data ?? []) as ApplicationQuestion[];
  const answers = (answersResult.data ?? []) as ApplicationAnswer[];
  const cycles = (cyclesResult.data ?? []) as AwardCycle[];
  const answerMap = new Map(answers.map((answer) => [answer.question_id, answer.value]));
  const progressMap = new Map(progress.map((item) => [item.stage_id, item]));

  const selectedStage =
    stages.find((stage) => stage.id === query.stage) ??
    stages.find((stage) => stage.id === application.current_stage_id) ??
    stages[0] ??
    null;
  const selectedSections = selectedStage
    ? sections.filter((section) => section.stage_id === selectedStage.id)
    : sections.filter((section) => !section.stage_id);
  const selectedSectionIds = new Set(selectedSections.map((section) => section.id));
  const selectedQuestions = questions.filter((question) => selectedSectionIds.has(question.section_id));

  const canEditMetadata = profile.role === "owner";
  const canEditAnswers =
    !application.is_archived &&
    (profile.role === "owner" ||
      (profile.role === "applicant" &&
        applicantCanEdit &&
        application.status === "draft" &&
        selectedStage?.id === application.current_stage_id));

  const answeredCount = selectedQuestions.filter(
    (question) => question.question_type !== "content" && hasAnswer(answerMap.get(question.id)),
  ).length;
  const answerableCount = selectedQuestions.filter(
    (question) => question.question_type !== "content",
  ).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{application.school_name}</h1>
          <p>
            {application.production_title ?? application.external_applicant_name ?? "Application record"}
          </p>
        </div>
        <div className="heading-actions">
          {application.is_archived && <span className="badge">Imported archive</span>}
          <span className={`badge badge-${application.status}`}>{statusLabel(application.status)}</span>
        </div>
      </div>

      {query.saved && <div className="notice page-message">This stage was saved.</div>}
      {query.stage_submitted && <div className="notice page-message">Stage submitted. The next stage is now open.</div>}
      {query.submitted && <div className="notice page-message">The full application was submitted successfully.</div>}
      {query.error === "required" && (
        <div className="form-error page-message">
          Complete all required questions in this stage. {query.missing ?? "One or more"} required fields are missing.
        </div>
      )}

      <section className="metric-grid application-metrics" aria-label="Application overview">
        <article className="metric-card"><span className="metric-label">Status</span><strong className="metric-text">{statusLabel(application.status)}</strong></article>
        <article className="metric-card"><span className="metric-label">Current stage</span><strong className="metric-text">{selectedStage?.title ?? application.source_stage ?? "Legacy form"}</strong></article>
        <article className="metric-card"><span className="metric-label">Stage progress</span><strong className="metric-text">{answeredCount} of {answerableCount}</strong></article>
        <article className="metric-card"><span className="metric-label">Submitted</span><strong className="metric-text">{formatDate(application.submitted_at)}</strong></article>
        <article className="metric-card"><span className="metric-label">Form</span><strong className="metric-text">{formVersion?.name ?? "Legacy form"}</strong></article>
      </section>

      {stages.length > 0 && (
        <nav className="stage-tabs" aria-label="Application stages">
          {stages.map((stage, index) => {
            const itemProgress = progressMap.get(stage.id);
            const active = stage.id === selectedStage?.id;
            return (
              <Link
                className={`stage-tab${active ? " stage-tab-active" : ""}`}
                href={`/portal/applications/${id}?stage=${stage.id}`}
                key={stage.id}
              >
                <span>{index + 1}</span>
                <strong>{stage.title}</strong>
                <small>{itemProgress?.status ?? (stage.id === application.current_stage_id ? "in progress" : "not started")}</small>
              </Link>
            );
          })}
        </nav>
      )}

      {canEditMetadata && (
        <div className="split-grid owner-application-tools">
          <section className="panel owner-controls-panel">
            <div className="panel-header"><h2>Owner controls</h2></div>
            <div className="panel-body">
              <form action={updateApplication.bind(null, id)} className="form-stack">
                <div className="field"><label htmlFor="school_name">School name</label><input className="input" id="school_name" name="school_name" defaultValue={application.school_name} required /></div>
                <div className="field"><label htmlFor="production_title">Production title</label><input className="input" id="production_title" name="production_title" defaultValue={application.production_title ?? ""} /></div>
                <div className="field">
                  <label htmlFor="current_stage_id">Current stage</label>
                  <select className="select" id="current_stage_id" name="current_stage_id" defaultValue={application.current_stage_id ?? ""}>
                    <option value="">No stage</option>
                    {allStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
                  </select>
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
                <div className="field"><label htmlFor="owner_notes">Internal owner notes</label><textarea className="textarea" id="owner_notes" name="owner_notes" defaultValue={application.owner_notes ?? ""} /></div>
                <button className="button button-dark" type="submit">Save application details</button>
              </form>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header"><h2>Duplicate application</h2></div>
            <div className="panel-body">
              <form action={duplicateApplicationRecord.bind(null, id)} className="form-stack">
                <div className="field">
                  <label htmlFor="target_cycle_id">Target program</label>
                  <select className="select" id="target_cycle_id" name="target_cycle_id" required>
                    <option value="">Choose a target program</option>
                    {cycles.filter((cycle) => cycle.id !== application.cycle_id).map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>{cycle.season_year} — {cycle.name}</option>
                    ))}
                  </select>
                </div>
                <label className="check-row"><input name="copy_answers" type="checkbox" defaultChecked />Copy matching answers</label>
                <button className="button button-secondary" type="submit">Duplicate application</button>
              </form>
            </div>
          </section>
        </div>
      )}

      {!application.form_version_id ? (
        <section className="panel"><div className="empty-state"><h3>This is a legacy application record.</h3><p>Its raw source payload is preserved, but it is not connected to a versioned form.</p></div></section>
      ) : !selectedStage && sections.length === 0 ? (
        <section className="panel"><div className="empty-state"><h3>The form has no stages or sections.</h3><p>An owner must add the form structure.</p></div></section>
      ) : selectedSections.length === 0 ? (
        <section className="panel"><div className="empty-state"><h3>This stage has no sections.</h3><p>Add sections in the form builder.</p></div></section>
      ) : (
        <form
          action={saveApplicationAnswers.bind(null, id, selectedStage?.id ?? "")}
          className="application-form"
        >
          {selectedSections.map((section, sectionIndex) => {
            const sectionQuestions = selectedQuestions.filter((question) => question.section_id === section.id);
            return (
              <section className="panel application-section" key={section.id}>
                <div className="panel-header application-section-header">
                  <div>
                    <span className="section-order">Section {sectionIndex + 1}</span>
                    <h2>{section.title}</h2>
                    {section.description && <p>{section.description}</p>}
                  </div>
                </div>
                <div className="panel-body application-question-list">
                  {sectionQuestions.length === 0 ? <p>No active questions in this section.</p> : sectionQuestions.map((question) => (
                    <ApplicationQuestionField disabled={!canEditAnswers} key={question.id} question={question} value={answerMap.get(question.id)} />
                  ))}
                </div>
              </section>
            );
          })}

          {canEditAnswers && selectedStage && (
            <div className="application-action-bar">
              <button className="button button-secondary-light" type="submit">Save stage</button>
              <button className="button button-dark" formAction={submitApplicationStage.bind(null, id, selectedStage.id)} type="submit">
                Submit stage
              </button>
            </div>
          )}
        </form>
      )}

      {application.is_archived && application.source_system && (
        <section className="panel archive-source-panel">
          <div className="panel-header"><h2>Archive source</h2></div>
          <div className="panel-body detail-grid">
            <div className="detail-item"><span>Source</span><strong>{application.source_system}</strong></div>
            <div className="detail-item"><span>Record ID</span><strong>{application.source_record_id ?? "—"}</strong></div>
            <div className="detail-item"><span>Original stage</span><strong>{application.source_stage ?? "—"}</strong></div>
            <div className="detail-item"><span>Applicant</span><strong>{application.external_applicant_name ?? "—"}</strong></div>
          </div>
        </section>
      )}
    </>
  );
}

import { notFound } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationFormVersion,
  ApplicationQuestion,
  ApplicationQuestionType,
  ApplicationSection,
  ApplicationStage,
  AwardCycle,
} from "@/lib/types";

import {
  createQuestion,
  createSection,
  createStage,
  deleteQuestion,
  duplicateFormVersion,
  editPublishedFormVersion,
  publishFormVersion,
  updateQuestion,
  updateSection,
  updateStage,
} from "../actions";

const QUESTION_TYPES: Array<{ value: ApplicationQuestionType; label: string }> = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "select", label: "Dropdown" },
  { value: "multi_select", label: "Multiple choice — select many" },
  { value: "radio", label: "Multiple choice — select one" },
  { value: "checkbox", label: "Checkbox" },
  { value: "yes_no", label: "Yes / No" },
  { value: "signature_acknowledgement", label: "Signature acknowledgement" },
  { value: "content", label: "Instructions / content" },
];

export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile(["owner"]);
  const { id } = await params;
  const supabase = await createClient();

  const [versionResult, stagesResult, sectionsResult, questionsResult, cyclesResult] =
    await Promise.all([
      supabase
        .from("application_form_versions")
        .select("id,cycle_id,version_number,name,status,published_at,created_at,updated_at")
        .eq("id", id)
        .single(),
      supabase
        .from("application_stages")
        .select("id,form_version_id,stage_key,title,description,sort_order,is_initial,applicant_visible,opens_at,closes_at,settings,created_at,updated_at")
        .eq("form_version_id", id)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("application_sections")
        .select("id,form_version_id,stage_id,title,description,sort_order,created_at,updated_at")
        .eq("form_version_id", id)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("application_questions")
        .select("id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,source_column_index,source_label,imported,created_at,updated_at")
        .eq("form_version_id", id)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("award_cycles")
        .select("id,cycle_key,name,season_year,program_type,description,status,opens_at,closes_at,is_active,cloned_from_cycle_id,created_at,updated_at")
        .order("season_year", { ascending: false })
        .order("name"),
    ]);

  if (!versionResult.data) notFound();

  const version = versionResult.data as ApplicationFormVersion;
  const cycles = (cyclesResult.data ?? []) as AwardCycle[];
  const cycle = cycles.find((item) => item.id === version.cycle_id) ?? null;
  const stages = (stagesResult.data ?? []) as ApplicationStage[];
  const sections = (sectionsResult.data ?? []) as ApplicationSection[];
  const questions = (questionsResult.data ?? []) as ApplicationQuestion[];
  const isDraft = version.status === "draft";

  const renderSection = (section: ApplicationSection) => {
    const sectionQuestions = questions.filter(
      (question) => question.section_id === section.id,
    );

    return (
      <section className="panel builder-section" key={section.id}>
        <div className="panel-header">
          <div>
            <h2>{section.title}</h2>
            {section.description && <p>{section.description}</p>}
          </div>
          <span className="badge">{sectionQuestions.length} questions</span>
        </div>

        {isDraft && (
          <div className="panel-body builder-section-settings">
            <details>
              <summary>Edit section</summary>
              <form
                action={updateSection.bind(null, version.id, section.id)}
                className="form-stack compact-form"
              >
                <div className="field">
                  <label>Stage</label>
                  <select className="select" name="stage_id" defaultValue={section.stage_id ?? ""}>
                    <option value="">No stage / legacy</option>
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>{stage.title}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Section title</label>
                  <input className="input" name="title" defaultValue={section.title} required />
                </div>
                <div className="field">
                  <label>Description</label>
                  <textarea className="textarea" name="description" defaultValue={section.description ?? ""} />
                </div>
                <div className="field">
                  <label>Sort order</label>
                  <input className="input" name="sort_order" type="number" defaultValue={section.sort_order} />
                </div>
                <button className="button button-dark button-compact" type="submit">Save section</button>
              </form>
            </details>
          </div>
        )}

        {sectionQuestions.length === 0 ? (
          <div className="empty-state compact-empty"><p>No questions in this section yet.</p></div>
        ) : (
          <div className="question-admin-list">
            {sectionQuestions.map((question) => (
              <article className="question-admin-card" key={question.id}>
                <div className="question-admin-heading">
                  <div>
                    <span className="question-key">{question.question_key}</span>
                    <h3>{question.label}</h3>
                  </div>
                  <div className="heading-actions">
                    {question.imported && <span className="badge">Imported</span>}
                    {question.required && <span className="badge badge-required">Required</span>}
                    {!question.active && <span className="badge">Inactive</span>}
                  </div>
                </div>
                <p className="question-meta">
                  {QUESTION_TYPES.find((item) => item.value === question.question_type)?.label ?? question.question_type}
                  {question.options.length > 0 ? ` · ${question.options.length} options` : ""}
                  {question.source_column_index !== null ? ` · Acceptd column ${question.source_column_index}` : ""}
                </p>
                {question.description && <p>{question.description}</p>}

                {isDraft && (
                  <details className="question-editor">
                    <summary>Edit question</summary>
                    <form
                      action={updateQuestion.bind(null, version.id, question.id)}
                      className="form-stack compact-form"
                    >
                      <QuestionEditorFields question={question} />
                      <button className="button button-dark button-compact" type="submit">Save question</button>
                    </form>
                    <form action={deleteQuestion.bind(null, version.id, question.id)}>
                      <button className="text-danger" type="submit">Delete question</button>
                    </form>
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{version.name}</h1>
          <p>{cycle?.season_year ?? "Unknown cycle"} · Version {version.version_number}</p>
        </div>
        <div className="heading-actions">
          <span className={`badge badge-form-${version.status}`}>{version.status}</span>
          {version.status === "published" ? (
            <form action={editPublishedFormVersion.bind(null, version.id)}>
              <button className="button button-gold" type="submit">Edit published form</button>
            </form>
          ) : (
            <form action={publishFormVersion.bind(null, version.id)}>
              <button className="button button-dark" type="submit">Publish this version</button>
            </form>
          )}
        </div>
      </div>

      {!isDraft && (
        <div className="notice form-builder-notice">
          This version is {version.status}. “Edit published form” creates a safe draft version, so existing applications remain attached to the historical form they completed.
        </div>
      )}

      <section className="panel form-duplicate-panel">
        <div className="panel-header"><h2>Duplicate this form</h2></div>
        <div className="panel-body">
          <form action={duplicateFormVersion.bind(null, version.id)} className="inline-form-grid">
            <div className="field">
              <label>Target program</label>
              <select className="select" name="target_cycle_id" defaultValue={version.cycle_id} required>
                {cycles.map((item) => (
                  <option key={item.id} value={item.id}>{item.season_year} — {item.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>New form name</label>
              <input className="input" name="name" placeholder={`${version.name} Copy`} />
            </div>
            <button className="button button-secondary" type="submit">Duplicate form</button>
          </form>
        </div>
      </section>

      <div className="builder-layout">
        <div className="builder-main">
          {stages.length === 0 && sections.length === 0 ? (
            <section className="panel">
              <div className="empty-state">
                <h3>This form has no stages.</h3>
                <p>Add the first stage, then add sections and questions within it.</p>
              </div>
            </section>
          ) : (
            <>
              {stages.map((stage, stageIndex) => {
                const stageSections = sections.filter((section) => section.stage_id === stage.id);
                const stageQuestionCount = stageSections.reduce(
                  (total, section) => total + questions.filter((question) => question.section_id === section.id).length,
                  0,
                );
                return (
                  <div className="builder-stage" key={stage.id}>
                    <section className="panel stage-heading-panel">
                      <div className="panel-header">
                        <div>
                          <span className="section-order">Stage {stageIndex + 1}</span>
                          <h2>{stage.title}</h2>
                          {stage.description && <p>{stage.description}</p>}
                        </div>
                        <div className="heading-actions">
                          {stage.is_initial && <span className="badge badge-complete">Initial</span>}
                          <span className="badge">{stageQuestionCount} questions</span>
                        </div>
                      </div>
                      {isDraft && (
                        <div className="panel-body">
                          <details>
                            <summary>Edit stage</summary>
                            <form action={updateStage.bind(null, version.id, stage.id)} className="form-stack compact-form">
                              <div className="field"><label>Stage title</label><input className="input" name="title" defaultValue={stage.title} required /></div>
                              <div className="field"><label>Stable key</label><input className="input" name="stage_key" defaultValue={stage.stage_key} required /></div>
                              <div className="field"><label>Description</label><textarea className="textarea" name="description" defaultValue={stage.description ?? ""} /></div>
                              <div className="field"><label>Sort order</label><input className="input" name="sort_order" type="number" defaultValue={stage.sort_order} /></div>
                              <label className="check-row"><input name="is_initial" type="checkbox" defaultChecked={stage.is_initial} />Initial stage</label>
                              <label className="check-row"><input name="applicant_visible" type="checkbox" defaultChecked={stage.applicant_visible} />Visible to applicant</label>
                              <button className="button button-dark button-compact" type="submit">Save stage</button>
                            </form>
                          </details>
                        </div>
                      )}
                    </section>
                    {stageSections.length === 0 ? (
                      <section className="panel"><div className="empty-state compact-empty"><p>No sections in this stage.</p></div></section>
                    ) : stageSections.map(renderSection)}
                  </div>
                );
              })}
              {sections.filter((section) => !section.stage_id).map(renderSection)}
            </>
          )}
        </div>

        {isDraft && (
          <aside className="builder-sidebar">
            <section className="panel">
              <div className="panel-header"><h2>Add stage</h2></div>
              <div className="panel-body">
                <form action={createStage.bind(null, version.id)} className="form-stack">
                  <div className="field"><label>Stage title</label><input className="input" name="title" placeholder="Section A | Application" required /></div>
                  <div className="field"><label>Stable key</label><input className="input" name="stage_key" placeholder="section_a_application" /></div>
                  <div className="field"><label>Description</label><textarea className="textarea" name="description" /></div>
                  <div className="field"><label>Sort order</label><input className="input" name="sort_order" type="number" defaultValue={stages.length * 10 + 10} /></div>
                  <label className="check-row"><input name="is_initial" type="checkbox" defaultChecked={stages.length === 0} />Initial stage</label>
                  <button className="button button-dark" type="submit">Add stage</button>
                </form>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>Add section</h2></div>
              <div className="panel-body">
                <form action={createSection.bind(null, version.id)} className="form-stack">
                  <div className="field">
                    <label>Stage</label>
                    <select className="select" name="stage_id" required>
                      <option value="">Choose a stage</option>
                      {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Title</label><input className="input" name="title" required /></div>
                  <div className="field"><label>Description</label><textarea className="textarea" name="description" /></div>
                  <div className="field"><label>Sort order</label><input className="input" name="sort_order" type="number" defaultValue={sections.length * 10 + 10} /></div>
                  <button className="button button-dark" type="submit">Add section</button>
                </form>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>Add question</h2></div>
              <div className="panel-body">
                {sections.length === 0 ? <p>Add a section first.</p> : (
                  <form action={createQuestion.bind(null, version.id)} className="form-stack">
                    <div className="field">
                      <label>Section</label>
                      <select className="select" name="section_id" required>
                        {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
                      </select>
                    </div>
                    <QuestionEditorFields />
                    <button className="button button-dark" type="submit">Add question</button>
                  </form>
                )}
              </div>
            </section>
          </aside>
        )}
      </div>
    </>
  );
}

function QuestionEditorFields({ question }: { question?: ApplicationQuestion }) {
  return (
    <>
      <div className="field"><label>Question label</label><input className="input" name="label" defaultValue={question?.label ?? ""} required /></div>
      <div className="field"><label>Stable key</label><input className="input" name="question_key" defaultValue={question?.question_key ?? ""} placeholder="Generated from label when blank" /></div>
      <div className="field"><label>Description or help text</label><textarea className="textarea" name="description" defaultValue={question?.description ?? ""} /></div>
      <div className="field">
        <label>Question type</label>
        <select className="select" name="question_type" defaultValue={question?.question_type ?? "short_text"}>
          {QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
      </div>
      <div className="field"><label>Options</label><textarea className="textarea" name="options" defaultValue={question?.options.join("\n") ?? ""} placeholder="One option per line" /></div>
      <div className="field"><label>Placeholder</label><input className="input" name="placeholder" defaultValue={question?.settings.placeholder ?? ""} /></div>
      <div className="field"><label>External document URL</label><input className="input" name="external_url" type="url" defaultValue={question?.settings.external_url ?? ""} /></div>
      <div className="field"><label>Acknowledgement label</label><input className="input" name="acknowledgement_label" defaultValue={question?.settings.acknowledgement_label ?? ""} /></div>
      <div className="field"><label>Sort order</label><input className="input" name="sort_order" type="number" defaultValue={question?.sort_order ?? 10} /></div>
      <label className="check-row"><input name="required" type="checkbox" defaultChecked={question?.required ?? false} />Required</label>
      {question && <label className="check-row"><input name="active" type="checkbox" defaultChecked={question.active} />Active</label>}
    </>
  );
}

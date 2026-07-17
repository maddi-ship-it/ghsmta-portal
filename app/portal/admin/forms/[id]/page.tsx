import { notFound } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationFormVersion,
  ApplicationQuestion,
  ApplicationQuestionType,
  ApplicationSection,
  AwardCycle,
} from "@/lib/types";

import {
  createQuestion,
  createSection,
  deleteQuestion,
  publishFormVersion,
  updateQuestion,
  updateSection,
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

  const [versionResult, sectionsResult, questionsResult] = await Promise.all([
    supabase
      .from("application_form_versions")
      .select("id,cycle_id,version_number,name,status,published_at,created_at,updated_at")
      .eq("id", id)
      .single(),
    supabase
      .from("application_sections")
      .select("id,form_version_id,title,description,sort_order,created_at,updated_at")
      .eq("form_version_id", id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("application_questions")
      .select("id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,created_at,updated_at")
      .eq("form_version_id", id)
      .order("sort_order")
      .order("created_at"),
  ]);

  if (!versionResult.data) notFound();

  const version = versionResult.data as ApplicationFormVersion;
  const { data: cycleData } = await supabase
    .from("award_cycles")
    .select("id,name,season_year,opens_at,closes_at,is_active,created_at,updated_at")
    .eq("id", version.cycle_id)
    .single();
  const cycle = cycleData as AwardCycle | null;
  const sections = (sectionsResult.data ?? []) as ApplicationSection[];
  const questions = (questionsResult.data ?? []) as ApplicationQuestion[];
  const isDraft = version.status === "draft";

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{version.name}</h1>
          <p>
            {cycle?.season_year ?? "Unknown cycle"} · Version {version.version_number}
          </p>
        </div>
        <div className="heading-actions">
          <span className={`badge badge-form-${version.status}`}>{version.status}</span>
          {version.status !== "published" && (
            <form action={publishFormVersion.bind(null, version.id)}>
              <button className="button button-dark" type="submit">
                Publish this version
              </button>
            </form>
          )}
        </div>
      </div>

      {!isDraft && (
        <div className="notice form-builder-notice">
          This version is {version.status}. Existing applications remain attached to it. You can inspect it here, but create a new version before making structural changes.
        </div>
      )}

      <div className="builder-layout">
        <div className="builder-main">
          {sections.length === 0 ? (
            <section className="panel">
              <div className="empty-state">
                <h3>This form has no sections.</h3>
                <p>Add the first section using the builder controls.</p>
              </div>
            </section>
          ) : (
            sections.map((section) => {
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
                    <div className="empty-state compact-empty">
                      <p>No questions in this section yet.</p>
                    </div>
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
                              {question.required && <span className="badge badge-required">Required</span>}
                              {!question.active && <span className="badge">Inactive</span>}
                            </div>
                          </div>
                          <p className="question-meta">
                            {QUESTION_TYPES.find((item) => item.value === question.question_type)?.label ?? question.question_type}
                            {question.options.length > 0 ? ` · ${question.options.length} options` : ""}
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
                                <div className="heading-actions">
                                  <button className="button button-dark button-compact" type="submit">Save question</button>
                                </div>
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
            })
          )}
        </div>

        {isDraft && (
          <aside className="builder-sidebar">
            <section className="panel">
              <div className="panel-header"><h2>Add section</h2></div>
              <div className="panel-body">
                <form action={createSection.bind(null, version.id)} className="form-stack">
                  <div className="field">
                    <label htmlFor="section_title">Title</label>
                    <input className="input" id="section_title" name="title" required />
                  </div>
                  <div className="field">
                    <label htmlFor="section_description">Description</label>
                    <textarea className="textarea" id="section_description" name="description" />
                  </div>
                  <div className="field">
                    <label htmlFor="section_sort_order">Sort order</label>
                    <input className="input" id="section_sort_order" name="sort_order" type="number" defaultValue={sections.length * 10 + 10} />
                  </div>
                  <button className="button button-dark" type="submit">Add section</button>
                </form>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>Add question</h2></div>
              <div className="panel-body">
                {sections.length === 0 ? (
                  <p>Add a section first.</p>
                ) : (
                  <form action={createQuestion.bind(null, version.id)} className="form-stack">
                    <div className="field">
                      <label htmlFor="section_id">Section</label>
                      <select className="select" id="section_id" name="section_id" required>
                        {sections.map((section) => (
                          <option key={section.id} value={section.id}>{section.title}</option>
                        ))}
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
      <div className="field">
        <label>Question label</label>
        <input className="input" name="label" defaultValue={question?.label ?? ""} required />
      </div>
      <div className="field">
        <label>Stable key</label>
        <input
          className="input"
          name="question_key"
          defaultValue={question?.question_key ?? ""}
          placeholder="Generated from label when blank"
        />
      </div>
      <div className="field">
        <label>Description or help text</label>
        <textarea className="textarea" name="description" defaultValue={question?.description ?? ""} />
      </div>
      <div className="field">
        <label>Question type</label>
        <select className="select" name="question_type" defaultValue={question?.question_type ?? "short_text"}>
          {QUESTION_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Options</label>
        <textarea
          className="textarea"
          name="options"
          defaultValue={question?.options.join("\n") ?? ""}
          placeholder="One option per line"
        />
      </div>
      <div className="field">
        <label>Placeholder</label>
        <input className="input" name="placeholder" defaultValue={question?.settings.placeholder ?? ""} />
      </div>
      <div className="field">
        <label>External document URL</label>
        <input className="input" name="external_url" type="url" defaultValue={question?.settings.external_url ?? ""} />
      </div>
      <div className="field">
        <label>Acknowledgement label</label>
        <input className="input" name="acknowledgement_label" defaultValue={question?.settings.acknowledgement_label ?? ""} />
      </div>
      <div className="field">
        <label>Sort order</label>
        <input className="input" name="sort_order" type="number" defaultValue={question?.sort_order ?? 10} />
      </div>
      <label className="check-row">
        <input name="required" type="checkbox" defaultChecked={question?.required ?? false} />
        Required
      </label>
      {question && (
        <label className="check-row">
          <input name="active" type="checkbox" defaultChecked={question.active} />
          Active
        </label>
      )}
    </>
  );
}

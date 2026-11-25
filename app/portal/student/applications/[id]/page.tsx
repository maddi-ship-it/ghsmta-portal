import Link from "next/link";
import { notFound } from "next/navigation";

import { StudentDocumentUploader } from "@/components/student-document-uploader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { StudentProgramField, StudentSubmission } from "@/lib/types";

import { saveStudentApplication } from "../actions";

function studentFacingStatus(status: StudentSubmission["status"]) {
  if (status === "draft") return "Draft";
  if (status === "returned") return "Updates requested";
  return "Sent to GHSMTA";
}

function Field({ field, value, disabled }: { field: StudentProgramField; value: unknown; disabled: boolean }) {
  if (field.field_type === "content") return <div className="student-form-content"><h3>{field.label}</h3>{field.description && <p>{field.description}</p>}</div>;
  const common = { className: "input", id: field.field_key, name: field.field_key, disabled, required: field.required, defaultValue: typeof value === "string" || typeof value === "number" ? value : "" };
  if (field.field_type === "long_text") return <textarea {...common} className="textarea" rows={6} />;
  if (field.field_type === "select") return <select className="select" id={field.field_key} name={field.field_key} disabled={disabled} required={field.required} defaultValue={typeof value === "string" ? value : ""}><option value="">Choose one</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>;
  if (field.field_type === "multi_select") { const values = Array.isArray(value) ? value.map(String) : []; return <div className="student-option-list">{field.options.map((option) => <label className="check-row" key={option}><input name={field.field_key} type="checkbox" value={option} defaultChecked={values.includes(option)} disabled={disabled} />{option}</label>)}</div>; }
  if (field.field_type === "yes_no") return <select className="select" id={field.field_key} name={field.field_key} disabled={disabled} required={field.required} defaultValue={typeof value === "string" ? value : ""}><option value="">Choose one</option><option value="Yes">Yes</option><option value="No">No</option></select>;
  if (field.field_type === "checkbox") return <label className="check-row"><input id={field.field_key} name={field.field_key} type="checkbox" disabled={disabled} required={field.required} defaultChecked={value === true} />{field.label}</label>;
  const type = field.field_type === "phone" ? "tel" : field.field_type === "short_text" ? "text" : field.field_type;
  return <input {...common} type={type} />;
}

export default async function StudentApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; submitted?: string }> }) {
  const profile = await requireProfile(["student", "alumni"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: submissionRow } = await supabase.from("student_submissions").select("*").eq("id", id).eq("student_user_id", profile.id).maybeSingle();
  if (!submissionRow) notFound();
  const submission = submissionRow as StudentSubmission;
  const [{ data: program }, { data: fields }, { data: files }, { data: acknowledgement }] = await Promise.all([
    supabase.from("student_programs").select("*").eq("id", submission.program_id).single(),
    supabase.from("student_program_fields").select("*").eq("program_id", submission.program_id).eq("active", true).order("sort_order"),
    supabase.from("portal_files").select("id,original_name,document_category,created_at").eq("context_type", "student_submission").eq("context_id", id).order("created_at", { ascending: false }),
    supabase.from("student_guardian_acknowledgements").select("id,typed_name,signed_at").eq("submission_id", id).maybeSingle(),
  ]);
  if (!program) notFound();
  const readOnly = profile.role === "alumni" || !["draft", "returned"].includes(submission.status);
  const typedFields = (fields ?? []) as StudentProgramField[];

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Student application</span><h1>{program.name}</h1><p>{program.description}</p></div><div className="heading-actions"><span className={`badge ${["submitted", "complete", "archived"].includes(submission.status) ? "badge-complete" : ""}`}>{studentFacingStatus(submission.status)}</span><Link className="button button-secondary" href="/portal/student/applications">Back</Link></div></div>
      {query.saved && <div className="notice page-message">Draft saved.</div>}
      {query.submitted && <div className="notice page-message">Your application was submitted to GHSMTA.</div>}
      {submission.status === "returned" && submission.owner_notes && <div className="notice page-message"><strong>Updates requested:</strong> {submission.owner_notes}</div>}
      {program.instructions && <section className="panel"><div className="panel-body"><h2>Before you begin</h2><p className="preserve-lines">{program.instructions}</p></div></section>}
      <form action={saveStudentApplication.bind(null, id, "save")} className="form-stack student-application-form">
        {typedFields.map((field) => <section className="panel student-form-field" key={field.id}><div className="panel-body">{field.field_type !== "content" && field.field_type !== "checkbox" && <label htmlFor={field.field_key}><strong>{field.label}</strong>{field.required && <span className="required-mark"> Required</span>}</label>}{field.description && field.field_type !== "content" && <p>{field.description}</p>}{field.field_type === "file" ? <><StudentDocumentUploader studentId={profile.id} contextId={id} contextType="student_submission" documentType={field.label} documentCategory={field.field_key} label="Choose file" /><div className="student-file-list">{(files ?? []).filter((file) => file.document_category === field.field_key).map((file) => <a className="record-link" href={`/portal/student/files/${file.id}`} key={file.id}><span><strong>{file.original_name}</strong><small>Uploaded {new Date(file.created_at).toLocaleDateString()}</small></span><span>Download</span></a>)}</div></> : <Field field={field} value={submission.responses[field.field_key]} disabled={readOnly} />}</div></section>)}
        {program.requires_guardian_signature && <section className="panel"><div className="panel-header"><div><h2>Guardian acknowledgement</h2><p>Only one connected guardian needs to complete this requirement.</p></div><span className={`badge ${acknowledgement ? "badge-complete" : "badge-warning"}`}>{acknowledgement ? `Signed by ${acknowledgement.typed_name}` : "Awaiting guardian"}</span></div></section>}
        {!readOnly && <div className="student-sticky-save"><button className="button button-secondary" type="submit">Save draft</button><button className="button button-gold" formAction={saveStudentApplication.bind(null, id, "submit")} type="submit">Submit application</button></div>}
      </form>
    </>
  );
}

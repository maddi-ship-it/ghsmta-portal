import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { StudentProgramField } from "@/lib/types";

import { acknowledgeStudentSubmission } from "../../actions";

function displayValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "Not answered";
  return String(value);
}

function guardianFacingStatus(status: string) {
  if (status === "draft") return "In progress";
  if (status === "returned") return "Updates requested";
  return "Sent to GHSMTA";
}

export default async function GuardianSubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ signed?: string }> }) {
  await requireProfile(["guardian"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: submission } = await supabase.from("student_submissions").select("id,program_id,student_user_id,status,responses,student_programs(name,description,requires_guardian_signature)").eq("id", id).maybeSingle();
  if (!submission) notFound();
  const program = Array.isArray(submission.student_programs) ? submission.student_programs[0] : submission.student_programs;
  const [{ data: fields }, { data: acknowledgement }, { data: files }, { data: student }] = await Promise.all([
    supabase.from("student_program_fields").select("*").eq("program_id", submission.program_id).eq("active", true).order("sort_order"),
    supabase.from("student_guardian_acknowledgements").select("typed_name,relationship,acknowledgement_text,signed_at").eq("submission_id", id).maybeSingle(),
    supabase.from("portal_files").select("id,original_name,document_category,created_at").eq("context_type", "student_submission").eq("context_id", id).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("guardian_student_summaries").select("legal_name,preferred_name").eq("user_id", submission.student_user_id).maybeSingle(),
  ]);

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Guardian review</span><h1>{program?.name ?? "Student application"}</h1><p>Submitted by {student?.preferred_name ?? student?.legal_name ?? "your student"}.</p></div><Link className="button button-secondary" href="/portal/guardian">Back</Link></div>
      {query.signed && <div className="notice page-message">Your guardian acknowledgement was recorded.</div>}
      <section className="panel"><div className="panel-header"><div><h2>Student submission</h2><p>{program?.description}</p></div><span className="badge">{guardianFacingStatus(submission.status)}</span></div><div className="panel-body guardian-response-grid">{((fields ?? []) as StudentProgramField[]).filter((field) => !["content", "file"].includes(field.field_type)).map((field) => <div className="guardian-response" key={field.id}><small>{field.label}</small><strong>{displayValue((submission.responses as Record<string, unknown>)[field.field_key])}</strong></div>)}</div></section>
      {(files ?? []).length > 0 && <section className="panel"><div className="panel-header"><h2>Attached files</h2></div><div className="panel-body form-stack">{(files ?? []).map((file) => <a className="record-link" href={`/portal/student/files/${file.id}`} key={file.id}><span><strong>{file.original_name}</strong><small>{file.document_category.replaceAll("_", " ")} · {new Date(file.created_at).toLocaleDateString()}</small></span><span>Download</span></a>)}</div></section>}
      {program?.requires_guardian_signature && <section className="panel"><div className="panel-header"><div><h2>Guardian acknowledgement</h2><p>Only one connected guardian needs to complete this form.</p></div></div><div className="panel-body">{acknowledgement ? <div className="notice"><strong>Completed by {acknowledgement.typed_name}</strong><p>{acknowledgement.acknowledgement_text}</p><small>{new Date(acknowledgement.signed_at).toLocaleString()}</small></div> : <form action={acknowledgeStudentSubmission.bind(null, id)} className="form-stack"><p>I confirm that I am an authorized parent or guardian for this student and that the information submitted for {program.name} may be reviewed by GHSMTA.</p><div className="field"><label>Full legal name</label><input className="input" name="typed_name" required /></div><div className="field"><label>Relationship to student</label><input className="input" name="relationship" required /></div><label className="check-row"><input name="accepted" type="checkbox" required />I agree and understand that my typed name, date, and account will be recorded.</label><button className="button button-gold" type="submit">Complete acknowledgement</button></form>}</div></section>}
    </>
  );
}

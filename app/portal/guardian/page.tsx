import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function guardianFacingStatus(status: string) {
  if (status === "draft") return "In progress";
  if (status === "returned") return "Updates requested";
  return "Sent to GHSMTA";
}

export default async function GuardianPage() {
  const guardian = await requireProfile(["guardian"]);
  const admin = createAdminClient();
  await admin.from("guardian_student_links").update({ status: "active", accepted_at: new Date().toISOString() }).eq("guardian_user_id", guardian.id).eq("status", "invited");
  const supabase = await createClient();
  const [{ data: links }, { data: studentSummaries }] = await Promise.all([
    supabase.from("guardian_student_links").select("student_user_id,relationship,status").eq("guardian_user_id", guardian.id).neq("status", "removed"),
    supabase.from("guardian_student_summaries").select("user_id,legal_name,preferred_name,graduation_year,status,school_name_snapshot"),
  ]);
  const studentIds = (links ?? []).map((link) => link.student_user_id);
  const { data: submissions } = studentIds.length > 0 ? await supabase.from("student_submissions").select("id,student_user_id,status,updated_at,student_programs(name,requires_guardian_signature,closes_at)").in("student_user_id", studentIds).order("updated_at", { ascending: false }) : { data: [] };
  const { data: acknowledgements } = (submissions ?? []).length > 0 ? await supabase.from("student_guardian_acknowledgements").select("submission_id,typed_name,signed_at").in("submission_id", (submissions ?? []).map((submission) => submission.id)) : { data: [] };
  const acknowledgementBySubmission = new Map((acknowledgements ?? []).map((acknowledgement) => [acknowledgement.submission_id, acknowledgement]));

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Parent / guardian portal</span><h1>My students</h1><p>Review connected students, their submissions, deadlines, and guardian forms.</p></div></div>
      {(links ?? []).length === 0 ? <section className="panel"><div className="empty-state"><h3>No students connected yet.</h3><p>A student or GHSMTA Owner must invite this email address before a student appears.</p></div></section> : (links ?? []).map((link) => { const student = (studentSummaries ?? []).find((summary) => summary.user_id === link.student_user_id); const studentSubmissions = (submissions ?? []).filter((submission) => submission.student_user_id === link.student_user_id); return <section className="panel guardian-student-card" key={link.student_user_id}><div className="panel-header"><div><span className="eyebrow">{link.relationship ?? "Guardian"}</span><h2>{student?.preferred_name ?? student?.legal_name ?? "Student"}</h2><p>{student?.school_name_snapshot ?? "School pending"}{student?.graduation_year ? ` · Class of ${student.graduation_year}` : ""}</p></div><span className={`badge ${student?.status === "active" ? "badge-complete" : "badge-warning"}`}>{student?.status ?? "pending"}</span></div>{studentSubmissions.length === 0 ? <div className="empty-state compact-empty"><p>No applications yet.</p></div> : <div className="panel-body form-stack">{studentSubmissions.map((submission) => { const program = Array.isArray(submission.student_programs) ? submission.student_programs[0] : submission.student_programs; const ack = acknowledgementBySubmission.get(submission.id); return <Link className="record-link" href={`/portal/guardian/submissions/${submission.id}`} key={submission.id}><span><strong>{program?.name ?? "Student application"}</strong><small>{guardianFacingStatus(submission.status)} · {program?.closes_at ? `Due ${new Date(program.closes_at).toLocaleDateString()} · ` : ""}{program?.requires_guardian_signature ? ack ? `Signed by ${ack.typed_name}` : "Signature needed" : "No signature required"}</small></span><span>Review</span></Link>; })}</div>}</section>; })}
    </>
  );
}

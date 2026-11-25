import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { startStudentApplication } from "./actions";

function studentFacingStatus(status: string | undefined) {
  if (!status) return "Not started";
  if (status === "draft") return "Draft";
  if (status === "returned") return "Updates requested";
  if (["submitted", "complete", "archived"].includes(status)) return "Sent to GHSMTA";
  return "Not started";
}

export default async function StudentApplicationsPage() {
  const profile = await requireProfile(["student", "alumni"]);
  const supabase = await createClient();
  const [{ data: student }, { data: programs }, { data: submissions }] = await Promise.all([
    supabase.from("student_profiles").select("status").eq("user_id", profile.id).single(),
    supabase.from("student_programs").select("id,name,description,availability,status,opens_at,closes_at,requires_guardian_signature").in("status", ["open", "closed"]).order("opens_at"),
    supabase.from("student_submissions").select("id,program_id,status,submitted_at,updated_at").eq("student_user_id", profile.id).order("updated_at", { ascending: false }),
  ]);
  const submissionsByProgram = new Map((submissions ?? []).map((submission) => [submission.program_id, submission]));
  const readOnly = profile.role === "alumni" || student?.status === "alumni";
  const visiblePrograms = (programs ?? []).filter((program) => program.status === "open" || submissionsByProgram.has(program.id));

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">{readOnly ? "Alumni history" : "Student applications"}</span><h1>{readOnly ? "Your GHSMTA history" : "Applications and opportunities"}</h1><p>{readOnly ? "Your previous submissions remain available as read-only records." : "Begin open applications and complete opportunities assigned by GHSMTA."}</p></div><Link className="button button-dark" href="/portal/student/profile">Profile</Link></div>
      {student?.status === "pending_school" && !readOnly && <div className="notice page-message">Your school connection is awaiting Owner approval. You can review opportunities, but cannot begin one yet.</div>}
      <section className="panel"><div className="panel-header"><div><h2>{readOnly ? "Submission history" : "Available to you"}</h2><p>Internal nomination, review, and decision details remain private.</p></div></div>{visiblePrograms.length === 0 ? <div className="empty-state"><h3>No applications are available yet.</h3><p>Open and assigned opportunities will appear here.</p></div> : <div className="panel-body student-program-list">{visiblePrograms.map((program) => { const submission = submissionsByProgram.get(program.id); const canStart = !readOnly && student?.status === "active" && program.status === "open"; return <article className="student-program-list-card" key={program.id}><div><span className="eyebrow">{program.availability === "open" ? "Open application" : "Assigned opportunity"}</span><h3>{program.name}</h3><p>{program.description ?? "Review the application requirements and materials."}</p><div className="heading-actions"><span className={`badge ${submission && ["submitted", "complete", "archived"].includes(submission.status) ? "badge-complete" : ""}`}>{submission ? studentFacingStatus(submission.status) : program.status === "open" ? "Not started" : "Closed"}</span>{program.requires_guardian_signature && <span className="badge">Guardian form required</span>}</div></div><div>{submission ? <Link className="button button-secondary" href={`/portal/student/applications/${submission.id}`}>{readOnly ? "View record" : submission.status === "draft" || submission.status === "returned" ? "Continue" : "View"}</Link> : canStart ? <form action={startStudentApplication.bind(null, program.id)}><button className="button button-gold" type="submit">Start application</button></form> : null}</div></article>; })}</div>}</section>
    </>
  );
}

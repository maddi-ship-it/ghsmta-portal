import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { startStudentApplication } from "../../actions";

export default async function StudentProgramPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["student"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: program }, { data: existing }, { data: fields }, { data: student }] = await Promise.all([
    supabase.from("student_programs").select("id,name,description,instructions,availability,status,opens_at,closes_at,requires_guardian_signature").eq("id", id).maybeSingle(),
    supabase.from("student_submissions").select("id").eq("program_id", id).eq("student_user_id", profile.id).maybeSingle(),
    supabase.from("student_program_fields").select("id,required").eq("program_id", id).eq("active", true),
    supabase.from("student_profiles").select("status").eq("user_id", profile.id).single(),
  ]);
  if (!program) notFound();
  if (existing) redirect(`/portal/student/applications/${existing.id}`);
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Student opportunity</span><h1>{program.name}</h1><p>{program.description}</p></div><Link className="button button-secondary" href="/portal/student/applications">Back</Link></div>
      <section className="panel"><div className="panel-header"><div><h2>Application overview</h2><p>Review the requirements before creating your draft.</p></div><span className={`badge ${program.status === "open" ? "badge-complete" : "badge-warning"}`}>{program.status}</span></div><div className="panel-body student-program-overview"><div className="student-program-summary"><div><small>Questions and uploads</small><strong>{fields?.length ?? 0}</strong></div><div><small>Required fields</small><strong>{(fields ?? []).filter((field) => field.required).length}</strong></div><div><small>Guardian acknowledgement</small><strong>{program.requires_guardian_signature ? "Required" : "Not required"}</strong></div></div>{program.instructions && <div className="notice preserve-lines">{program.instructions}</div>}{student?.status !== "active" ? <div className="notice"><strong>School approval required.</strong><p>You may begin after a GHSMTA Owner approves your school connection.</p></div> : <form action={startStudentApplication.bind(null, id)}><button className="button button-gold" type="submit">Create my application</button></form>}</div></section>
    </>
  );
}

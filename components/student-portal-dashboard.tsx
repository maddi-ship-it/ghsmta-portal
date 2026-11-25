import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function StudentPortalDashboard({ profile }: { profile: Profile }) {
  const supabase = await createClient();

  if (profile.role === "guardian") {
    const [{ data: links }, { data: studentSummaries }] = await Promise.all([supabase
      .from("guardian_student_links")
      .select("student_user_id,guardian_name,relationship,status")
      .eq("guardian_user_id", profile.id)
      .neq("status", "removed"), supabase.from("guardian_student_summaries").select("user_id,legal_name,preferred_name,graduation_year,status,school_name_snapshot")]);
    const studentIds = (links ?? []).map((link) => link.student_user_id);
    const { data: submissions } = studentIds.length > 0
      ? await supabase.from("student_submissions").select("id,student_user_id,status,program_id,student_programs(name,requires_guardian_signature)").in("student_user_id", studentIds).in("status", ["draft", "submitted", "returned"])
      : { data: [] };
    const { data: acknowledgements } = (submissions ?? []).length > 0
      ? await supabase.from("student_guardian_acknowledgements").select("submission_id").in("submission_id", (submissions ?? []).map((submission) => submission.id))
      : { data: [] };
    const signed = new Set((acknowledgements ?? []).map((row) => row.submission_id));
    const needsSignature = (submissions ?? []).filter((submission) => {
      const program = Array.isArray(submission.student_programs) ? submission.student_programs[0] : submission.student_programs;
      return program?.requires_guardian_signature && !signed.has(submission.id);
    });

    return (
      <>
        <div className="page-heading"><div><span className="eyebrow">Parent / guardian portal</span><h1>Welcome, {profile.preferred_name ?? profile.full_name?.split(" ")[0] ?? "there"}.</h1><p>Review your connected students, their submissions, and forms that need your acknowledgement.</p></div><Link className="button button-dark" href="/portal/guardian">Open my students</Link></div>
        <section className="metric-grid"><article className="metric-card"><span className="metric-label">Connected students</span><strong className="metric-value">{studentSummaries?.length ?? links?.length ?? 0}</strong></article><article className="metric-card"><span className="metric-label">Signatures needed</span><strong className="metric-value">{needsSignature.length}</strong></article><article className="metric-card"><span className="metric-label">Active submissions</span><strong className="metric-value">{submissions?.length ?? 0}</strong></article></section>
        <section className="panel"><div className="panel-header"><div><h2>What needs attention</h2><p>One guardian signature completes the requirement for each form.</p></div></div>{needsSignature.length === 0 ? <div className="empty-state compact-empty"><h3>You’re all caught up.</h3><p>Forms will appear here when a connected student needs your acknowledgement.</p></div> : <div className="panel-body form-stack">{needsSignature.map((submission) => { const program = Array.isArray(submission.student_programs) ? submission.student_programs[0] : submission.student_programs; return <Link className="record-link" href={`/portal/guardian/submissions/${submission.id}`} key={submission.id}><span><strong>{program?.name ?? "Student form"}</strong><small>Guardian acknowledgement requested</small></span><span>Review</span></Link>; })}</div>}</section>
      </>
    );
  }

  const [{ data: student }, { data: submissions }, { data: programs }, { data: announcements }] = await Promise.all([
    supabase.from("student_profiles").select("status,graduation_year,school_name_snapshot,schools(name)").eq("user_id", profile.id).single(),
    supabase.from("student_submissions").select("id,status,updated_at,student_programs(name)").eq("student_user_id", profile.id).order("updated_at", { ascending: false }),
    supabase.from("student_programs").select("id,name,description,availability,status,opens_at,closes_at").eq("status", "open").order("opens_at"),
    supabase.from("student_announcements").select("id,title,body,published_at").order("published_at", { ascending: false }).limit(4),
  ]);
  const school = Array.isArray(student?.schools) ? student.schools[0] : student?.schools;
  const readOnly = profile.role === "alumni" || student?.status === "alumni";

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">{readOnly ? "Alumni record" : "Student portal"}</span><h1>Welcome, {profile.preferred_name ?? profile.full_name?.split(" ")[0] ?? "there"}.</h1><p>{readOnly ? "Your GHSMTA history is preserved here as a read-only record." : student?.status === "pending_school" ? "Complete your profile while GHSMTA reviews your school connection." : `Manage your GHSMTA opportunities${school?.name ? ` at ${school.name}` : ""}.`}</p></div><Link className="button button-dark" href="/portal/student/profile">{readOnly ? "View profile" : "Complete profile"}</Link></div>
      <section className="metric-grid"><article className="metric-card"><span className="metric-label">Applications</span><strong className="metric-value">{submissions?.length ?? 0}</strong></article><article className="metric-card"><span className="metric-label">Sent to GHSMTA</span><strong className="metric-value">{(submissions ?? []).filter((submission) => ["submitted", "complete", "archived"].includes(submission.status)).length}</strong></article><article className="metric-card"><span className="metric-label">Available now</span><strong className="metric-value">{readOnly ? 0 : programs?.length ?? 0}</strong></article><article className="metric-card"><span className="metric-label">Graduation year</span><strong className="metric-value metric-value-small">{student?.graduation_year ?? "—"}</strong></article></section>
      {!readOnly && <section className="panel"><div className="panel-header"><div><h2>Applications and opportunities</h2><p>Open programs and applications assigned directly to you.</p></div><Link href="/portal/student/applications">View all</Link></div>{(programs ?? []).length === 0 ? <div className="empty-state compact-empty"><h3>No applications are available yet.</h3><p>Assigned and open opportunities will appear here.</p></div> : <div className="panel-body student-program-card-grid">{(programs ?? []).slice(0, 4).map((program) => <Link className="student-program-card" href={`/portal/student/applications/programs/${program.id}`} key={program.id}><span className="eyebrow">{program.availability === "open" ? "Open application" : "Assigned"}</span><h3>{program.name}</h3><p>{program.description ?? "Open this application to review the requirements."}</p></Link>)}</div>}</section>}
      <section className="panel"><div className="panel-header"><div><h2>Announcements</h2><p>Updates from the GHSMTA team.</p></div><Link href="/portal/notifications">View notifications</Link></div>{(announcements ?? []).length === 0 ? <div className="empty-state compact-empty"><p>No announcements yet.</p></div> : <div className="panel-body form-stack">{(announcements ?? []).map((announcement) => <article className="student-announcement" key={announcement.id}><strong>{announcement.title}</strong><p>{announcement.body}</p><small>{announcement.published_at ? new Date(announcement.published_at).toLocaleDateString() : ""}</small></article>)}</div>}</section>
    </>
  );
}

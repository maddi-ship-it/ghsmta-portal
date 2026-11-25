import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { inviteStudentFromSchool } from "./actions";

export default async function SchoolStudentInvitesPage({ searchParams }: { searchParams: Promise<{ invited?: string }> }) {
  const applicant = await requireProfile(["applicant"]);
  const params = await searchParams;
  const admin = createAdminClient();
  const { data: application } = await admin.from("applications").select("school_id,school_name").eq("applicant_user_id", applicant.id).eq("is_archived", false).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const { data: invites } = application?.school_id ? await admin.from("student_invitations").select("id,email,full_name,graduation_year,status,created_at").eq("school_id", application.school_id).eq("source", "school").order("created_at", { ascending: false }) : { data: [] };
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">School team</span><h1>Invite students</h1><p>Invite current high-school students to create their personal GHSMTA profile.</p></div></div>
      {params.invited && <div className="notice page-message">Invitation sent. A GHSMTA Owner will approve the student’s school connection.</div>}
      <div className="split-grid"><section className="panel"><div className="panel-header"><div><h2>New invitation</h2><p>{application?.school_name ?? "Your school"}</p></div></div><div className="panel-body">{!application?.school_id ? <div className="empty-state"><h3>School directory connection needed</h3><p>Ask a GHSMTA Owner to connect your application to its school record.</p></div> : <form action={inviteStudentFromSchool} className="form-stack"><div className="field"><label>Student name</label><input className="input" name="full_name" required /></div><div className="field"><label>Student email</label><input className="input" name="email" type="email" required /></div><div className="field"><label>Graduation year</label><input className="input" name="graduation_year" type="number" min="2020" max="2100" required /></div><button className="button button-gold" type="submit">Send invitation</button></form>}</div></section><section className="panel"><div className="panel-header"><h2>Invitations sent</h2></div>{(invites ?? []).length === 0 ? <div className="empty-state"><p>No student invitations yet.</p></div> : <div className="panel-body form-stack">{(invites ?? []).map((invite) => <div className="record-link" key={invite.id}><span><strong>{invite.full_name ?? invite.email}</strong><small>{invite.email} · Class of {invite.graduation_year ?? "—"}</small></span><span className="badge">{invite.status}</span></div>)}</div>}</section></div>
    </>
  );
}

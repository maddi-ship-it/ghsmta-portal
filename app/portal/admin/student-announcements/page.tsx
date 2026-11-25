import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { publishStudentAnnouncement } from "./actions";

export default async function StudentAnnouncementsPage({ searchParams }: { searchParams: Promise<{ published?: string }> }) {
  await requireProfile(["owner"]);
  const params = await searchParams;
  const supabase = await createClient();
  const { data: announcements } = await supabase.from("student_announcements").select("id,title,body,audience,delivery_email,delivery_sms,delivery_in_app,published_at,created_at").order("created_at", { ascending: false });
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Owner workspace</span><h1>Student announcements</h1><p>Send portal, email, and SMS updates to students, guardians, or alumni.</p></div><Link className="button button-dark" href="/portal/admin/students">Student directory</Link></div>
      {params.published && <div className="notice page-message">Announcement published to {params.published} portal users.</div>}
      <div className="split-grid"><section className="panel"><div className="panel-header"><div><h2>Publish announcement</h2><p>Student announcements also copy connected guardians.</p></div></div><div className="panel-body"><form action={publishStudentAnnouncement} className="form-stack"><div className="field"><label>Title</label><input className="input" name="title" maxLength={160} required /></div><div className="field"><label>Message</label><textarea className="textarea" name="body" rows={8} required /></div><div className="field"><label>Audience</label><select className="select" name="audience"><option value="students_and_guardians">Students and guardians</option><option value="students">Students (with guardian copies)</option><option value="guardians">Guardians only</option><option value="alumni">Alumni only</option><option value="all_student_portal">Everyone in the student portal</option></select></div><div className="student-delivery-options"><label className="check-row"><input name="delivery_in_app" type="checkbox" defaultChecked />Portal notification</label><label className="check-row"><input name="delivery_email" type="checkbox" defaultChecked />Email</label><label className="check-row"><input name="delivery_sms" type="checkbox" defaultChecked />SMS</label></div><button className="button button-gold" type="submit">Publish announcement</button></form></div></section><section className="panel"><div className="panel-header"><h2>Announcement history</h2></div>{(announcements ?? []).length === 0 ? <div className="empty-state"><p>No student announcements yet.</p></div> : <div className="panel-body form-stack">{(announcements ?? []).map((announcement) => <article className="student-announcement" key={announcement.id}><span className="eyebrow">{announcement.audience.replaceAll("_", " ")}</span><h3>{announcement.title}</h3><p>{announcement.body}</p><small>{announcement.published_at ? new Date(announcement.published_at).toLocaleString() : "Draft"} · {[announcement.delivery_in_app && "Portal", announcement.delivery_email && "Email", announcement.delivery_sms && "SMS"].filter(Boolean).join(" + ")}</small></article>)}</div>}</section></div>
    </>
  );
}

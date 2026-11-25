import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { createStudentProgram } from "./actions";

export default async function StudentProgramsPage() {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: programs }, { data: fields }, { data: assignments }, { data: submissions }] = await Promise.all([
    supabase.from("student_programs").select("*").neq("status", "archived").order("created_at", { ascending: false }),
    supabase.from("student_program_fields").select("program_id"),
    admin.from("student_program_assignments").select("program_id"),
    supabase.from("student_submissions").select("program_id,status"),
  ]);
  const count = (rows: Array<{ program_id: string }> | null, id: string) => (rows ?? []).filter((row) => row.program_id === id).length;

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Owner workspace</span><h1>Student applications</h1><p>Create reusable forms that are open to every approved student or assigned to selected students.</p></div><Link className="button button-dark" href="/portal/admin/students">Student directory</Link></div>
      <div className="split-grid student-program-admin-grid"><section className="panel"><div className="panel-header"><div><h2>Application library</h2><p>Draft, open, and closed student opportunities.</p></div></div>{(programs ?? []).length === 0 ? <div className="empty-state"><h3>No student applications yet.</h3><p>Create the first reusable form.</p></div> : <div className="panel-body form-stack">{(programs ?? []).map((program) => <Link className="record-link" href={`/portal/admin/student-programs/${program.id}`} key={program.id}><span><strong>{program.name}</strong><small>{program.availability === "open" ? "Open to approved students" : "Owner assignment required"} · {count(fields, program.id)} fields · {count(assignments, program.id)} assigned · {count(submissions, program.id)} submissions</small></span><span className={`badge ${program.status === "open" ? "badge-complete" : ""}`}>{program.status}</span></Link>)}</div>}</section><section className="panel"><div className="panel-header"><h2>Create application</h2></div><div className="panel-body"><form action={createStudentProgram} className="form-stack"><div className="field"><label>Name</label><input className="input" name="name" placeholder="Student scholarship application" required /></div><div className="field"><label>Description</label><textarea className="textarea" name="description" /></div><div className="field"><label>Availability</label><select className="select" name="availability"><option value="assigned">Owner assignment required</option><option value="open">Any approved student can start</option></select></div><label className="check-row"><input name="requires_guardian_signature" type="checkbox" defaultChecked />Require one guardian acknowledgement</label><button className="button button-gold" type="submit">Create form</button></form></div></section></div>
    </>
  );
}

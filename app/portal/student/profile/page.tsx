import Link from "next/link";
import { redirect } from "next/navigation";

import { StudentDocumentUploader } from "@/components/student-document-uploader";
import { requireProfile } from "@/lib/auth";
import { isStudentSchoolOption } from "@/lib/student-school-options";
import { createClient } from "@/lib/supabase/server";
import type { StudentProfile } from "@/lib/types";

import { inviteGuardian, removeGuardian, saveStudentProfile } from "./actions";

export default async function StudentProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; guardian_invited?: string; welcome?: string }>;
}) {
  const account = await requireProfile(["student", "alumni"]);
  const params = await searchParams;
  const supabase = await createClient();
  const [studentResult, schoolsResult, requestsResult, guardiansResult, filesResult] = await Promise.all([
    supabase.from("student_profiles").select("*").eq("user_id", account.id).single(),
    supabase.from("schools").select("id,name,city").eq("active", true).order("name"),
    supabase.from("student_school_requests").select("id,school_id,status,source,created_at,decision_note,schools(name)").eq("student_user_id", account.id).order("created_at", { ascending: false }),
    supabase.from("guardian_student_links").select("id,guardian_user_id,guardian_name,relationship,status,invited_at,accepted_at").eq("student_user_id", account.id).neq("status", "removed").order("created_at"),
    supabase.from("portal_files").select("id,original_name,generated_name,storage_path,document_category,created_at").eq("context_type", "student_profile").eq("context_id", account.id).order("created_at", { ascending: false }),
  ]);
  if (!studentResult.data) redirect("/portal");
  const student = studentResult.data as StudentProfile;
  const readOnly = account.role === "alumni" || student.status === "alumni";
  const currentSchool = (schoolsResult.data ?? []).find((school) => school.id === student.school_id);
  const studentSchools = (schoolsResult.data ?? []).filter((school) => isStudentSchoolOption(school.name, process.env.NODE_ENV !== "production"));
  const pendingRequest = (requestsResult.data ?? []).find((request) => request.status === "pending");

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">Student portal</span><h1>Your profile</h1><p>Keep your personal, school, guardian, and participation information current.</p></div>
        <Link className="button button-dark" href="/portal/student/applications">View applications</Link>
      </div>

      {(params.welcome || student.status === "pending_school") && <div className="notice page-message"><strong>School approval pending.</strong> You can complete your profile now. Applications become available after an Owner approves your school connection.</div>}
      {params.saved && <div className="notice page-message">Your profile was saved.</div>}
      {params.guardian_invited && <div className="notice page-message">Guardian invitation sent.</div>}
      {readOnly && <div className="notice page-message"><strong>Alumni record:</strong> Your student history is preserved as read-only.</div>}

      <form action={saveStudentProfile} className="student-profile-layout">
        <section className="panel">
          <div className="panel-header"><div><h2>About you</h2><p>Information used across your GHSMTA opportunities.</p></div><span className={`badge ${student.status === "active" ? "badge-complete" : "badge-warning"}`}>{student.status.replaceAll("_", " ")}</span></div>
          <div className="panel-body form-grid two-column-form-grid">
            <div className="field"><label>Legal name</label><input className="input" name="legal_name" defaultValue={student.legal_name ?? account.full_name ?? ""} disabled={readOnly} required /></div>
            <div className="field"><label>Preferred name</label><input className="input" name="preferred_name" defaultValue={student.preferred_name ?? account.preferred_name ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>Pronouns</label><input className="input" name="pronouns" defaultValue={student.pronouns ?? account.pronouns ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>Mobile number</label><input className="input" name="phone" type="tel" defaultValue={account.phone_e164 ?? ""} disabled={readOnly} required /></div>
            <div className="field"><label>Graduation year</label><input className="input" name="graduation_year" type="number" min="2020" max="2100" defaultValue={student.graduation_year ?? ""} disabled={readOnly} required /></div>
            <div className="field"><label>School</label><select className="select" name="school_id" defaultValue={pendingRequest?.school_id ?? student.school_id ?? ""} disabled={readOnly} required><option value="">Choose school</option>{studentSchools.map((school) => <option key={school.id} value={school.id}>{school.name}{school.city ? ` — ${school.city}` : ""}</option>)}</select><small>{currentSchool ? `Current approved school: ${currentSchool.name}.` : "Your school must be approved by an Owner."}{pendingRequest ? " A new request is pending." : ""}</small></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>Emergency contact</h2><p>Visible to GHSMTA Owners.</p></div></div>
          <div className="panel-body form-grid three-column-form-grid">
            <div className="field"><label>Name</label><input className="input" name="emergency_contact_name" defaultValue={student.emergency_contact_name ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>Relationship</label><input className="input" name="emergency_contact_relationship" defaultValue={student.emergency_contact_relationship ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>Phone</label><input className="input" name="emergency_contact_phone" type="tel" defaultValue={student.emergency_contact_phone ?? ""} disabled={readOnly} /></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>Experience and accommodations</h2><p>Tell GHSMTA about your work and what helps you participate fully.</p></div></div>
          <div className="panel-body form-grid two-column-form-grid">
            <div className="field"><label>Performer credits</label><textarea className="textarea" name="performer_credits" rows={5} defaultValue={student.performer_credits ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>Production credits</label><textarea className="textarea" name="production_credits" rows={5} defaultValue={student.production_credits ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>Accessibility or accommodation requests</label><textarea className="textarea" name="accessibility_accommodations" rows={4} defaultValue={student.accessibility_accommodations ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>Dietary needs</label><textarea className="textarea" name="dietary_needs" rows={4} defaultValue={student.dietary_needs ?? ""} disabled={readOnly} /></div>
            <div className="field"><label>T-shirt size</label><select className="select" name="tshirt_size" defaultValue={student.tshirt_size ?? ""} disabled={readOnly}><option value="">Choose size</option>{["XS","S","M","L","XL","2XL","3XL","4XL"].map((size) => <option key={size}>{size}</option>)}</select></div>
          </div>
        </section>

        {!readOnly && <div className="student-sticky-save"><button className="button button-gold" type="submit">Save profile</button></div>}
      </form>

      <section className="panel">
        <div className="panel-header"><div><h2>Headshot and résumé</h2><p>Upload your current materials. Owners can view them with your profile.</p></div></div>
        <div className="panel-body student-document-grid">
          {!readOnly && <><StudentDocumentUploader studentId={account.id} contextId={account.id} documentType="Headshot" label="Headshot" accept="image/*,.heic,.heif" /><StudentDocumentUploader studentId={account.id} contextId={account.id} documentType="Resume" label="Résumé" accept=".pdf,.doc,.docx" /></>}
          <div className="student-file-list">{(filesResult.data ?? []).length === 0 ? <p>No profile documents uploaded yet.</p> : (filesResult.data ?? []).map((file) => <a className="record-link" href={`/portal/student/files/${file.id}`} key={file.id}><span><strong>{file.original_name}</strong><small>{file.document_category.replaceAll("_", " ")} · {new Date(file.created_at).toLocaleDateString()}</small></span><span>Download</span></a>)}</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Parents and guardians</h2><p>Multiple guardians are allowed. Only one signature is required for each form.</p></div></div>
        <div className="panel-body student-guardian-layout">
          <div>{(guardiansResult.data ?? []).length === 0 ? <p>No guardians connected yet.</p> : (guardiansResult.data ?? []).map((guardian) => <div className="record-link" key={guardian.id}><span><strong>{guardian.guardian_name ?? "Connected guardian"}</strong><small>{guardian.relationship ?? "Guardian"} · {guardian.status}</small></span>{!readOnly && <form action={removeGuardian.bind(null, guardian.id)}><button className="text-danger" type="submit">Remove</button></form>}</div>)}</div>
          {!readOnly && <form action={inviteGuardian} className="form-stack student-guardian-invite"><h3>Invite a guardian</h3><div className="field"><label>Name</label><input className="input" name="guardian_name" /></div><div className="field"><label>Email</label><input className="input" name="guardian_email" type="email" required /></div><div className="field"><label>Relationship</label><input className="input" name="relationship" placeholder="Parent, guardian, caregiver…" /></div><button className="button button-secondary" type="submit">Invite guardian</button></form>}
        </div>
      </section>
    </>
  );
}

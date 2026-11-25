import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function csv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  await requireProfile(["owner"]);
  const admin = createAdminClient();
  const [{ data: students }, { data: guardians }, { data: submissions }, { data: acknowledgements }] = await Promise.all([
    admin.from("student_profiles").select("user_id,legal_name,preferred_name,pronouns,school_name_snapshot,graduation_year,status,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,accessibility_accommodations,tshirt_size,dietary_needs,profiles!student_profiles_user_id_fkey(email,phone_e164),schools(name)").order("legal_name"),
    admin.from("guardian_student_links").select("student_user_id,status").neq("status", "removed"),
    admin.from("student_submissions").select("id,student_user_id,status"),
    admin.from("student_guardian_acknowledgements").select("submission_id"),
  ]);
  const signedIds = new Set((acknowledgements ?? []).map((row) => row.submission_id));
  const header = ["Legal name", "Preferred name", "Email", "Phone", "Pronouns", "School", "Graduation year", "Status", "Guardians", "Applications", "Submitted", "Guardian forms completed", "Emergency contact", "Emergency relationship", "Emergency phone", "Accessibility / accommodations", "T-shirt size", "Dietary needs"];
  const rows = (students ?? []).map((student) => {
    const profile = Array.isArray(student.profiles) ? student.profiles[0] : student.profiles;
    const school = Array.isArray(student.schools) ? student.schools[0] : student.schools;
    const studentSubmissions = (submissions ?? []).filter((submission) => submission.student_user_id === student.user_id);
    return [student.legal_name, student.preferred_name, profile?.email, profile?.phone_e164, student.pronouns, school?.name ?? student.school_name_snapshot, student.graduation_year, student.status, (guardians ?? []).filter((guardian) => guardian.student_user_id === student.user_id).length, studentSubmissions.length, studentSubmissions.filter((submission) => ["submitted", "complete"].includes(submission.status)).length, studentSubmissions.filter((submission) => signedIds.has(submission.id)).length, student.emergency_contact_name, student.emergency_contact_relationship, student.emergency_contact_phone, student.accessibility_accommodations, student.tshirt_size, student.dietary_needs].map(csv).join(",");
  });
  const content = [header.map(csv).join(","), ...rows].join("\r\n");
  return new Response(content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ghsmta-student-roster-${new Date().toISOString().slice(0, 10)}.csv"` } });
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export async function applyStudentLifecycle(profile: Profile): Promise<Profile> {
  if (profile.role !== "student") return profile;
  const admin = createAdminClient();
  const { data: student } = await admin.from("student_profiles").select("graduation_year,status").eq("user_id", profile.id).maybeSingle();
  if (!student?.graduation_year || student.status !== "active") return profile;
  const alumniDate = new Date(`${student.graduation_year}-07-01T00:00:00-04:00`);
  if (Date.now() < alumniDate.getTime()) return profile;
  const convertedAt = new Date().toISOString();
  await Promise.all([
    admin.from("student_profiles").update({ status: "alumni" }).eq("user_id", profile.id),
    admin.from("profiles").update({ role: "alumni" }).eq("id", profile.id),
    admin.from("student_portal_audit_log").insert({ actor_user_id: profile.id, student_user_id: profile.id, action: "automatic_alumni_conversion", entity_type: "student_profile", entity_id: profile.id, metadata: { graduation_year: student.graduation_year, converted_at: convertedAt } }),
  ]);
  return { ...profile, role: "alumni" };
}

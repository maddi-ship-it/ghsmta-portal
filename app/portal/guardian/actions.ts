"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function acknowledgeStudentSubmission(submissionId: string, formData: FormData) {
  const guardian = await requireProfile(["guardian"]);
  const typedName = String(formData.get("typed_name") ?? "").trim();
  const relationship = String(formData.get("relationship") ?? "").trim();
  const accepted = formData.get("accepted") === "on";
  if (!typedName || !accepted) throw new Error("Enter your name and accept the acknowledgement.");

  const supabase = await createClient();
  const { data: submission, error: submissionError } = await supabase
    .from("student_submissions")
    .select("id,student_user_id,program_id,student_programs(name,requires_guardian_signature)")
    .eq("id", submissionId)
    .single();
  if (submissionError || !submission) throw new Error(submissionError?.message ?? "Submission not found.");
  const program = Array.isArray(submission.student_programs) ? submission.student_programs[0] : submission.student_programs;
  if (!program?.requires_guardian_signature) throw new Error("This application does not require a guardian acknowledgement.");

  const headerStore = await headers();
  const acknowledgement = `I confirm that I am an authorized parent or guardian for this student and that the information submitted for ${program.name} may be reviewed by GHSMTA.`;
  const admin = createAdminClient();
  const { error } = await admin.from("student_guardian_acknowledgements").insert({
    submission_id: submissionId,
    guardian_user_id: guardian.id,
    typed_name: typedName,
    relationship: relationship || null,
    acknowledgement_text: acknowledgement,
    ip_address: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerStore.get("x-real-ip"),
    user_agent: headerStore.get("user-agent")?.slice(0, 1000) ?? null,
  });
  if (error) throw new Error(error.message);

  await admin.from("student_portal_audit_log").insert({
    actor_user_id: guardian.id,
    student_user_id: submission.student_user_id,
    action: "guardian_acknowledged",
    entity_type: "student_submission",
    entity_id: submissionId,
    metadata: { program_name: program.name },
  });
  await admin.from("user_notifications").insert({
    user_id: submission.student_user_id,
    notification_type: "guardian_acknowledgement",
    title: "Guardian form completed",
    body: `${typedName} completed the guardian acknowledgement for ${program.name}.`,
    href: `/portal/student/applications/${submissionId}`,
  });
  revalidatePath("/portal/guardian");
  revalidatePath(`/portal/guardian/submissions/${submissionId}`);
  redirect(`/portal/guardian/submissions/${submissionId}?signed=1`);
}

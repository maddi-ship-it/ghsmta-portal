"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { normalizePhoneE164 } from "@/lib/phone";
import { portalAuthCallbackUrl, portalSiteUrl } from "@/lib/site-url";
import { sendStudentPortalSms } from "@/lib/student-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

const STUDENTS_PATH = "/portal/admin/students";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function createStudentSupportChannel(studentId: string, displayName: string, createdBy: string) {
  const admin = createAdminClient();
  const { data: existingRows } = await admin.from("chat_direct_participants").select("channel_id").eq("user_id", studentId);
  if ((existingRows ?? []).length > 0) {
    const ids = (existingRows ?? []).map((row) => row.channel_id);
    const { data: existingChannel } = await admin.from("chat_channels").select("id").in("id", ids).eq("channel_type", "group_direct_message").ilike("description", "%Student Support%").maybeSingle();
    if (existingChannel) return existingChannel.id;
  }
  const { data: channel, error: channelError } = await admin.from("chat_channels").insert({
    channel_type: "group_direct_message",
    name: `Student Support — ${displayName}`,
    description: "GHSMTA Student Support · Student and Owners only",
    active: true,
    created_by: createdBy,
  }).select("id").single();
  if (channelError || !channel) throw new Error(channelError?.message ?? "Student support chat could not be created.");
  const { data: owners } = await admin.from("profiles").select("id").eq("role", "owner").eq("active", true);
  const participantIds = [...new Set([studentId, ...(owners ?? []).map((owner) => owner.id)])];
  const { error: participantError } = await admin.from("chat_direct_participants").insert(participantIds.map((userId) => ({ channel_id: channel.id, user_id: userId, added_by: createdBy })));
  if (participantError) throw new Error(participantError.message);
  return channel.id;
}

async function inviteStudentAccount({ email, fullName, schoolId, graduationYear, source, invitedBy, preapprove }: { email: string; fullName: string; schoolId: string; graduationYear: number; source: "owner" | "school" | "import"; invitedBy: string; preapprove: boolean }) {
  const admin = createAdminClient();
  const { data: school, error: schoolError } = await admin.from("schools").select("id,name").eq("id", schoolId).eq("active", true).single();
  if (schoolError || !school) throw new Error(schoolError?.message ?? "School not found.");
  const headerStore = await headers();
  let { data: existing } = await admin.from("profiles").select("id,role,email").eq("email", email).maybeSingle();
  if (existing && !["student", "alumni"].includes(existing.role)) throw new Error(`${email} already belongs to another portal role.`);
  if (!existing) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, portal_role: "student", school_id: schoolId, graduation_year: graduationYear },
      redirectTo: portalAuthCallbackUrl("/portal/student/profile?welcome=1", headerStore.get("origin")),
    });
    if (error || !data.user) throw new Error(error?.message ?? `Could not invite ${email}.`);
    existing = { id: data.user.id, role: "student", email };
  }
  await admin.from("student_invitations").insert({ email, full_name: fullName, school_id: schoolId, graduation_year: graduationYear, source, invited_by: invitedBy, auth_user_id: existing.id });
  await admin.from("student_profiles").upsert({
    user_id: existing.id,
    legal_name: fullName,
    graduation_year: graduationYear,
    school_id: preapprove ? schoolId : null,
    school_name_snapshot: preapprove ? school.name : null,
    status: preapprove ? "active" : "pending_school",
    approved_by: preapprove ? invitedBy : null,
    approved_at: preapprove ? new Date().toISOString() : null,
  }, { onConflict: "user_id" });
  await admin.from("student_school_requests").update({ status: "cancelled" }).eq("student_user_id", existing.id).eq("status", "pending");
  await admin.from("student_school_requests").insert({
    student_user_id: existing.id,
    school_id: schoolId,
    source: source === "owner" ? "owner_invite" : source === "import" ? "owner_import" : "school_invite",
    status: preapprove ? "approved" : "pending",
    requested_by: invitedBy,
    decided_by: preapprove ? invitedBy : null,
    decided_at: preapprove ? new Date().toISOString() : null,
  });
  if (preapprove) await createStudentSupportChannel(existing.id, fullName || email, invitedBy);
  return existing.id;
}

export async function approveStudentSchoolRequest(requestId: string) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const { data: request, error } = await admin.from("student_school_requests").select("id,student_user_id,school_id,status,schools(name)").eq("id", requestId).single();
  if (error || !request || request.status !== "pending") throw new Error(error?.message ?? "Pending request not found.");
  const school = Array.isArray(request.schools) ? request.schools[0] : request.schools;
  const { data: student } = await admin.from("profiles").select("email,full_name").eq("id", request.student_user_id).single();
  const now = new Date().toISOString();
  const { error: profileError } = await admin.from("student_profiles").update({ school_id: request.school_id, school_name_snapshot: school?.name ?? null, status: "active", approved_by: owner.id, approved_at: now }).eq("user_id", request.student_user_id);
  if (profileError) throw new Error(profileError.message);
  await admin.from("student_school_requests").update({ status: "approved", decided_by: owner.id, decided_at: now }).eq("id", requestId);
  await createStudentSupportChannel(request.student_user_id, student?.full_name ?? student?.email ?? "Student", owner.id);
  await admin.from("user_notifications").insert({ user_id: request.student_user_id, notification_type: "student_school_approved", title: "Your school connection was approved", body: `You now have full student portal access for ${school?.name ?? "your school"}.`, href: "/portal" });
  if (student?.email) await sendSmtpEmail({ to: [student.email], subject: "Your GHSMTA student account is approved", text: `Your school connection to ${school?.name ?? "your school"} was approved. Sign in to continue your GHSMTA profile.`, html: `<h2>Your GHSMTA student account is approved</h2><p>Your school connection to <strong>${school?.name ?? "your school"}</strong> was approved.</p><p>Sign in to continue your profile and view available opportunities.</p>` });
  revalidatePath(STUDENTS_PATH);
}

export async function denyStudentSchoolRequest(requestId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const note = text(formData, "decision_note");
  const admin = createAdminClient();
  const { data: request } = await admin.from("student_school_requests").select("student_user_id").eq("id", requestId).eq("status", "pending").single();
  if (!request) throw new Error("Pending request not found.");
  await admin.from("student_school_requests").update({ status: "denied", decision_note: note || null, decided_by: owner.id, decided_at: new Date().toISOString() }).eq("id", requestId);
  await admin.from("user_notifications").insert({ user_id: request.student_user_id, notification_type: "student_school_denied", title: "School connection needs attention", body: note || "GHSMTA could not approve the selected school. Update your profile or message an Owner for help.", href: "/portal/student/profile" });
  revalidatePath(STUDENTS_PATH);
}

export async function inviteStudentAsOwner(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const email = text(formData, "email").toLowerCase();
  const fullName = text(formData, "full_name");
  const schoolId = text(formData, "school_id");
  const graduationYear = Number(formData.get("graduation_year"));
  if (!email || !fullName || !schoolId || !Number.isInteger(graduationYear)) throw new Error("Name, email, school, and graduation year are required.");
  await inviteStudentAccount({ email, fullName, schoolId, graduationYear, source: "owner", invitedBy: owner.id, preapprove: true });
  revalidatePath(STUDENTS_PATH);
  redirect(`${STUDENTS_PATH}?invited=1`);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(current.trim()); current = ""; }
    else current += character;
  }
  values.push(current.trim());
  return values;
}

export async function importStudents(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file.");
  const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("The CSV must include a header and at least one student.");
  const headers = parseCsvLine(lines[0]).map((value) => value.toLowerCase().replaceAll(" ", "_"));
  const index = (name: string) => headers.indexOf(name);
  const admin = createAdminClient();
  const { data: schools } = await admin.from("schools").select("id,name").eq("active", true);
  let imported = 0;
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const email = values[index("email")]?.toLowerCase();
    const fullName = values[index("full_name")] ?? values[index("name")];
    const schoolName = values[index("school")] ?? values[index("school_name")];
    const graduationYear = Number(values[index("graduation_year")]);
    const school = (schools ?? []).find((candidate) => candidate.name.toLowerCase() === schoolName?.toLowerCase());
    if (!email || !fullName || !school || !Number.isInteger(graduationYear)) continue;
    await inviteStudentAccount({ email, fullName, schoolId: school.id, graduationYear, source: "import", invitedBy: owner.id, preapprove: true });
    imported += 1;
  }
  revalidatePath(STUDENTS_PATH);
  redirect(`${STUDENTS_PATH}?imported=${imported}`);
}

export async function assignStudentProgram(studentId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const programId = text(formData, "program_id");
  const isNominee = formData.get("is_nominee") === "on";
  if (!programId) throw new Error("Choose a student application.");
  const admin = createAdminClient();
  const { error } = await admin.from("student_program_assignments").upsert({ program_id: programId, student_user_id: studentId, assigned_by: owner.id, is_nominee: isNominee, internal_label: text(formData, "internal_label") || null, internal_notes: text(formData, "internal_notes") || null }, { onConflict: "program_id,student_user_id" });
  if (error) throw new Error(error.message);
  const { data: program } = await admin.from("student_programs").select("name").eq("id", programId).single();
  await admin.from("user_notifications").insert({ user_id: studentId, notification_type: "student_application_assigned", title: "A new student application is available", body: `${program?.name ?? "A GHSMTA opportunity"} is now available in your student portal.`, href: "/portal/student/applications" });
  revalidatePath(`${STUDENTS_PATH}/${studentId}`);
}

export async function removeStudentProgramAssignment(studentId: string, assignmentId: string) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const { data: assignment } = await admin.from("student_program_assignments").select("id,program_id").eq("id", assignmentId).eq("student_user_id", studentId).single();
  if (!assignment) throw new Error("Assignment not found.");
  const { data: submission } = await admin.from("student_submissions").select("id").eq("student_user_id", studentId).eq("program_id", assignment.program_id).maybeSingle();
  if (submission) throw new Error("This assignment cannot be removed after the student has started it. Archive the submission instead.");
  const { error } = await admin.from("student_program_assignments").delete().eq("id", assignmentId);
  if (error) throw new Error(error.message);
  await admin.from("student_portal_audit_log").insert({ actor_user_id: owner.id, student_user_id: studentId, action: "owner_removed_program_assignment", entity_type: "student_profile", entity_id: studentId, metadata: { program_id: assignment.program_id } });
  revalidatePath(`${STUDENTS_PATH}/${studentId}`);
}

export async function inviteGuardianAsOwner(studentId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const email = text(formData, "guardian_email").toLowerCase();
  const guardianName = text(formData, "guardian_name");
  const relationship = text(formData, "relationship");
  if (!email || !email.includes("@")) throw new Error("Enter a guardian email address.");
  const admin = createAdminClient();
  const { data: student } = await admin.from("student_profiles").select("legal_name,preferred_name").eq("user_id", studentId).single();
  if (!student) throw new Error("Student not found.");
  let { data: guardian } = await admin.from("profiles").select("id,role").eq("email", email).maybeSingle();
  if (guardian && guardian.role !== "guardian") throw new Error("That email already belongs to a non-guardian portal account.");
  if (!guardian) {
    const headerStore = await headers();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: guardianName || email, portal_role: "guardian" },
      redirectTo: portalAuthCallbackUrl("/portal/guardian", headerStore.get("origin")),
    });
    if (error || !data.user) throw new Error(error?.message ?? "Guardian invitation could not be sent.");
    guardian = { id: data.user.id, role: "guardian" };
  }
  const { error } = await admin.from("guardian_student_links").upsert({
    guardian_user_id: guardian.id,
    student_user_id: studentId,
    guardian_email: email,
    guardian_name: guardianName || null,
    relationship: relationship || null,
    status: "invited",
    invited_by: owner.id,
    invited_at: new Date().toISOString(),
    removed_at: null,
  }, { onConflict: "guardian_user_id,student_user_id" });
  if (error) throw new Error(error.message);
  await admin.from("user_notifications").insert({ user_id: guardian.id, notification_type: "guardian_invitation", title: "You were added as a guardian", body: `You were connected to ${student.preferred_name ?? student.legal_name ?? "a student"} in the GHSMTA Student Portal.`, href: "/portal/guardian" });
  await admin.from("student_portal_audit_log").insert({ actor_user_id: owner.id, student_user_id: studentId, action: "owner_invited_guardian", entity_type: "student_profile", entity_id: studentId, metadata: { guardian_email: email } });
  revalidatePath(`${STUDENTS_PATH}/${studentId}`);
}

export async function removeGuardianAsOwner(studentId: string, linkId: string) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const { error } = await admin.from("guardian_student_links").update({ status: "removed", removed_at: new Date().toISOString() }).eq("id", linkId).eq("student_user_id", studentId);
  if (error) throw new Error(error.message);
  await admin.from("student_portal_audit_log").insert({ actor_user_id: owner.id, student_user_id: studentId, action: "owner_removed_guardian", entity_type: "student_profile", entity_id: studentId, metadata: { guardian_link_id: linkId } });
  revalidatePath(`${STUDENTS_PATH}/${studentId}`);
}

export async function updateStudentAsOwner(studentId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const status = text(formData, "status");
  const schoolId = text(formData, "school_id") || null;
  const legalName = text(formData, "legal_name");
  const preferredName = text(formData, "preferred_name");
  const graduationYear = Number(formData.get("graduation_year"));
  if (!legalName || !["pending_school", "active", "alumni", "archived"].includes(status)) throw new Error("Name and status are required.");
  const { data: school } = schoolId ? await admin.from("schools").select("name").eq("id", schoolId).single() : { data: null };
  await admin.from("student_profiles").update({
    legal_name: legalName,
    preferred_name: preferredName || null,
    pronouns: text(formData, "pronouns") || null,
    school_id: schoolId,
    school_name_snapshot: school?.name ?? null,
    graduation_year: Number.isInteger(graduationYear) ? graduationYear : null,
    emergency_contact_name: text(formData, "emergency_contact_name") || null,
    emergency_contact_relationship: text(formData, "emergency_contact_relationship") || null,
    emergency_contact_phone: normalizePhoneE164(text(formData, "emergency_contact_phone")),
    performer_credits: text(formData, "performer_credits") || null,
    production_credits: text(formData, "production_credits") || null,
    accessibility_accommodations: text(formData, "accessibility_accommodations") || null,
    tshirt_size: text(formData, "tshirt_size") || null,
    dietary_needs: text(formData, "dietary_needs") || null,
    status,
    archived_by: status === "archived" ? owner.id : null,
    archived_at: status === "archived" ? new Date().toISOString() : null,
  }).eq("user_id", studentId);
  await admin.from("profiles").update({ full_name: legalName, preferred_name: preferredName || null, pronouns: text(formData, "pronouns") || null, role: status === "alumni" ? "alumni" : "student", active: status !== "archived", phone_e164: normalizePhoneE164(text(formData, "phone")) }).eq("id", studentId);
  if (status === "active") await createStudentSupportChannel(studentId, preferredName || legalName, owner.id);
  await admin.from("student_portal_audit_log").insert({ actor_user_id: owner.id, student_user_id: studentId, action: "owner_profile_update", entity_type: "student_profile", entity_id: studentId });
  revalidatePath(`${STUDENTS_PATH}/${studentId}`);
  revalidatePath(STUDENTS_PATH);
}

export async function sendStudentReminders(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const studentIds = [...new Set(formData.getAll("student_ids").map(String).filter(Boolean))];
  const subject = text(formData, "subject");
  const body = text(formData, "body");
  const includeGuardians = formData.get("include_guardians") === "on";
  const deliveryInApp = formData.get("delivery_in_app") === "on";
  const deliveryEmail = formData.get("delivery_email") === "on";
  const deliverySms = formData.get("delivery_sms") === "on";
  if (studentIds.length === 0) throw new Error("Choose at least one student.");
  if (!subject || !body) throw new Error("A subject and reminder message are required.");
  if (!deliveryInApp && !deliveryEmail && !deliverySms) throw new Error("Choose at least one delivery method.");

  const admin = createAdminClient();
  const recipientIds = new Set(studentIds);
  if (includeGuardians) {
    const { data: links } = await admin.from("guardian_student_links").select("guardian_user_id").in("student_user_id", studentIds).in("status", ["invited", "active"]);
    for (const link of links ?? []) recipientIds.add(link.guardian_user_id);
  }
  const { data: recipients, error } = await admin.from("profiles").select("id,email,phone_e164,notification_preferences").in("id", [...recipientIds]).eq("active", true);
  if (error) throw new Error(error.message);

  if (deliveryInApp && (recipients ?? []).length > 0) {
    const { error: notificationError } = await admin.from("user_notifications").insert((recipients ?? []).map((recipient) => ({ user_id: recipient.id, notification_type: "student_owner_reminder", title: subject, body: body.slice(0, 500), href: "/portal" })));
    if (notificationError) throw new Error(notificationError.message);
  }
  const portalUrl = `${portalSiteUrl()}/portal`;
  await Promise.all((recipients ?? []).map(async (recipient) => {
    const preferences = (recipient.notification_preferences ?? {}) as { email?: boolean; sms?: boolean };
    await Promise.all([
      deliveryEmail && preferences.email !== false && recipient.email
        ? sendSmtpEmail({ to: [recipient.email], subject, text: `${body}\n\nOpen the GHSMTA Portal: ${portalUrl}`, html: `<h2>${escapeHtml(subject)}</h2><p>${escapeHtml(body).replaceAll("\n", "<br />")}</p><p><a href="${portalUrl}">Open the GHSMTA Portal</a></p>` })
        : Promise.resolve(null),
      deliverySms && preferences.sms !== false && recipient.phone_e164
        ? sendStudentPortalSms(recipient.phone_e164, `GHSMTA: ${subject}\n${body}\n${portalUrl}`)
        : Promise.resolve(null),
    ]);
  }));
  await admin.from("student_portal_audit_log").insert(studentIds.map((studentId) => ({ actor_user_id: owner.id, student_user_id: studentId, action: "owner_reminder_sent", entity_type: "student_profile", entity_id: studentId, metadata: { subject, include_guardians: includeGuardians, delivery_in_app: deliveryInApp, delivery_email: deliveryEmail, delivery_sms: deliverySms } })));
  revalidatePath(STUDENTS_PATH);
  redirect(`${STUDENTS_PATH}?reminded=${recipients?.length ?? 0}`);
}

export async function saveSubmissionAsOwner(submissionId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const { data: submission } = await admin.from("student_submissions").select("student_user_id,program_id,responses").eq("id", submissionId).single();
  if (!submission) throw new Error("Submission not found.");
  const { data: fields } = await admin.from("student_program_fields").select("field_key,field_type").eq("program_id", submission.program_id).eq("active", true);
  const responses = { ...(submission.responses as Record<string, unknown>) };
  for (const field of fields ?? []) {
    if (["content", "file"].includes(field.field_type)) continue;
    responses[field.field_key] = field.field_type === "multi_select" ? formData.getAll(field.field_key).map(String) : field.field_type === "checkbox" ? formData.get(field.field_key) === "on" : text(formData, field.field_key) || null;
  }
  const status = text(formData, "status");
  const { error } = await admin.from("student_submissions").update({ responses, owner_notes: text(formData, "owner_notes") || null, status, returned_at: status === "returned" ? new Date().toISOString() : null, completed_at: status === "complete" ? new Date().toISOString() : null }).eq("id", submissionId);
  if (error) throw new Error(error.message);
  await admin.from("student_portal_audit_log").insert({ actor_user_id: owner.id, student_user_id: submission.student_user_id, action: "owner_submission_update", entity_type: "student_submission", entity_id: submissionId, metadata: { status } });
  if (status === "returned") await admin.from("user_notifications").insert({ user_id: submission.student_user_id, notification_type: "student_submission_returned", title: "Updates requested", body: text(formData, "owner_notes") || "A GHSMTA Owner requested updates to your application.", href: `/portal/student/applications/${submissionId}` });
  revalidatePath(`${STUDENTS_PATH}/${submission.student_user_id}`);
}

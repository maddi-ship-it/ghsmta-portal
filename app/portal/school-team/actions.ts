"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const TEAM_PATH = "/portal/school-team";
const MAX_ACTIVE_MEMBERS = 10;

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function teamRedirect(params: Record<string, string>): never {
  const query = new URLSearchParams(params);
  redirect(`${TEAM_PATH}?${query.toString()}`);
}

async function requireTeamManager(applicationId: string) {
  const profile = await requireProfile(["applicant"]);
  const supabase = await createClient();
  const { data: canManage, error } = await supabase.rpc(
    "can_manage_application_members",
    { p_application_id: applicationId },
  );

  if (error || !canManage) {
    throw new Error(
      error?.message ?? "Only the primary school account can manage team members.",
    );
  }

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select("id,school_name,production_title,is_archived")
    .eq("id", applicationId)
    .single();

  if (applicationError || !application || application.is_archived) {
    throw new Error(
      applicationError?.message ?? "This application cannot be managed.",
    );
  }

  return { profile, application };
}

async function createAccessLink({
  email,
  fullName,
  redirectTo,
  existingUser,
}: {
  email: string;
  fullName: string;
  redirectTo: string;
  existingUser: boolean;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: existingUser ? "magiclink" : "invite",
    email,
    options: {
      data: { full_name: fullName },
      redirectTo,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function inviteSchoolTeamMember(formData: FormData) {
  const applicationId = text(formData, "application_id");
  const fullName = text(formData, "full_name");
  const email = normalizeEmail(text(formData, "email"));
  const canEditApplication = formData.get("can_edit_application") === "on";

  if (!applicationId || !fullName || !email || !email.includes("@")) {
    throw new Error("Enter the team member's name and a valid email address.");
  }

  const { profile, application } = await requireTeamManager(applicationId);
  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("application_members")
    .select("user_id", { count: "exact", head: true })
    .eq("application_id", applicationId)
    .eq("active", true);

  if (countError) {
    throw new Error(countError.message);
  }

  if ((count ?? 0) >= MAX_ACTIVE_MEMBERS) {
    throw new Error(
      `A school application can have up to ${MAX_ACTIVE_MEMBERS} active users.`,
    );
  }

  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,email,full_name,role,active")
    .ilike("email", email)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (existingProfile && existingProfile.role !== "applicant") {
    throw new Error(
      "That email belongs to a staff account and cannot be added as a school sub-user.",
    );
  }

  if (existingProfile && !existingProfile.active) {
    throw new Error(
      "That portal account is inactive. A GHSMTA Owner must reactivate it before it can be added.",
    );
  }

  if (existingProfile?.id === profile.id) {
    throw new Error("Your account is already part of this school team.");
  }

  const headerStore = await headers();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    headerStore.get("origin") ??
    "http://localhost:3000";
  const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent(TEAM_PATH)}`;

  const linkData = await createAccessLink({
    email,
    fullName,
    redirectTo,
    existingUser: Boolean(existingProfile),
  });

  const userId = existingProfile?.id ?? linkData.user.id;

  const { error: upsertProfileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: fullName,
      role: "applicant",
      active: existingProfile?.active ?? true,
    },
    { onConflict: "id" },
  );

  if (upsertProfileError) {
    throw new Error(upsertProfileError.message);
  }

  const { error: memberError } = await admin.from("application_members").upsert(
    {
      application_id: applicationId,
      user_id: userId,
      member_role: "collaborator",
      can_edit_application: canEditApplication,
      can_manage_members: false,
      active: true,
      invited_by: profile.id,
      joined_at: new Date().toISOString(),
      removed_at: null,
    },
    { onConflict: "application_id,user_id" },
  );

  if (memberError) {
    throw new Error(memberError.message);
  }

  await admin
    .from("chat_channels")
    .update({ active: true })
    .eq("application_id", applicationId)
    .eq("channel_type", "school_dm");

  await admin.from("user_notifications").insert({
    user_id: userId,
    notification_type: "school_team_invite",
    title: `You've been added to ${application.school_name}`,
    body: canEditApplication
      ? "You can view and edit the school's application, schedule details, appeals, results, and School Messaging."
      : "You can view the school's application, schedule, appeals, results, and School Messaging.",
    href: TEAM_PATH,
    related_application_id: applicationId,
  });

  const safeSchool = escapeHtml(application.school_name);
  const safeName = escapeHtml(fullName);
  const safeProduction = escapeHtml(application.production_title ?? "");
  const accessDescription = canEditApplication
    ? "view and edit the application"
    : "view the application";

  const emailResult = await sendSmtpEmail({
    to: [email],
    subject: `You've been added to the ${application.school_name} GHSMTA account`,
    text: `${profile.full_name ?? profile.email ?? "The primary school contact"} added you to ${application.school_name}${application.production_title ? ` — ${application.production_title}` : ""} in the GHSMTA Portal. You can ${accessDescription}. Open this secure link: ${linkData.properties.action_link}`,
    html: `<h2>You've been added to a GHSMTA school account</h2><p>Hello ${safeName},</p><p>${escapeHtml(profile.full_name ?? profile.email ?? "The primary school contact")} added you to <strong>${safeSchool}</strong>${safeProduction ? ` for <strong>${safeProduction}</strong>` : ""}.</p><p>You can ${accessDescription}, use the private School Messaging, update permitted schedule information, submit appeals, and view released results.</p><p><a href="${linkData.properties.action_link}">Open the GHSMTA Portal</a></p><p>This secure link is intended only for ${escapeHtml(email)}.</p>`,
  });

  if (!emailResult.ok) {
    throw new Error(
      `The user was added, but the invitation email could not be sent: ${emailResult.detail}`,
    );
  }

  await admin.from("owner_activity_log").insert({
    activity_type: "school_team_member_added",
    title: `${application.school_name} added a school sub-user`,
    detail: `${fullName} (${email})`,
    actor_id: profile.id,
    application_id: applicationId,
    metadata: {
      user_id: userId,
      can_edit_application: canEditApplication,
    },
  });

  revalidatePath(TEAM_PATH);
  revalidatePath("/portal/chat");
  revalidatePath("/portal/admin/applications");
  teamRedirect({ invited: fullName });
}

export async function updateSchoolTeamMemberAccess(formData: FormData) {
  const applicationId = text(formData, "application_id");
  const userId = text(formData, "user_id");
  const canEditApplication = formData.get("can_edit_application") === "on";

  if (!applicationId || !userId) {
    throw new Error("School team member not found.");
  }

  await requireTeamManager(applicationId);
  const admin = createAdminClient();
  const { data: member, error: memberReadError } = await admin
    .from("application_members")
    .select("member_role")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .single();

  if (memberReadError || !member) {
    throw new Error(memberReadError?.message ?? "School team member not found.");
  }

  if (member.member_role === "primary") {
    throw new Error("The primary school account always has editing access.");
  }

  const { error } = await admin
    .from("application_members")
    .update({ can_edit_application: canEditApplication })
    .eq("application_id", applicationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(TEAM_PATH);
  teamRedirect({ updated: "1" });
}

export async function resendSchoolTeamInvite(formData: FormData) {
  const applicationId = text(formData, "application_id");
  const userId = text(formData, "user_id");

  if (!applicationId || !userId) {
    throw new Error("School team member not found.");
  }

  const { profile, application } = await requireTeamManager(applicationId);
  const admin = createAdminClient();
  const { data: memberProfile, error } = await admin
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", userId)
    .single();

  if (error || !memberProfile?.email || memberProfile.role !== "applicant") {
    throw new Error(error?.message ?? "This user cannot receive an invite.");
  }

  const headerStore = await headers();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    headerStore.get("origin") ??
    "http://localhost:3000";
  const linkData = await createAccessLink({
    email: memberProfile.email,
    fullName: memberProfile.full_name ?? memberProfile.email,
    redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(TEAM_PATH)}`,
    existingUser: true,
  });

  const result = await sendSmtpEmail({
    to: [memberProfile.email],
    subject: `Access the ${application.school_name} GHSMTA account`,
    text: `${profile.full_name ?? profile.email ?? "The primary school contact"} resent your GHSMTA Portal access link. Open it here: ${linkData.properties.action_link}`,
    html: `<h2>GHSMTA Portal access</h2><p>${escapeHtml(profile.full_name ?? profile.email ?? "The primary school contact")} resent your access link for <strong>${escapeHtml(application.school_name)}</strong>.</p><p><a href="${linkData.properties.action_link}">Open the GHSMTA Portal</a></p>`,
  });

  if (!result.ok) {
    throw new Error(result.detail);
  }

  teamRedirect({ resent: memberProfile.full_name ?? memberProfile.email });
}

export async function removeSchoolTeamMember(formData: FormData) {
  const applicationId = text(formData, "application_id");
  const userId = text(formData, "user_id");

  if (!applicationId || !userId) {
    throw new Error("School team member not found.");
  }

  const { profile, application } = await requireTeamManager(applicationId);
  const admin = createAdminClient();
  const { data: member, error: memberReadError } = await admin
    .from("application_members")
    .select("member_role,profiles!application_members_user_id_fkey(full_name,email)")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .single();

  if (memberReadError || !member) {
    throw new Error(memberReadError?.message ?? "School team member not found.");
  }

  if (member.member_role === "primary") {
    throw new Error("The primary school account cannot remove itself.");
  }

  const { error } = await admin
    .from("application_members")
    .update({
      active: false,
      can_edit_application: false,
      can_manage_members: false,
      removed_at: new Date().toISOString(),
    })
    .eq("application_id", applicationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  const relatedProfile = Array.isArray(member.profiles)
    ? member.profiles[0]
    : member.profiles;
  const removedName =
    relatedProfile?.full_name ?? relatedProfile?.email ?? "School team member";

  await admin.from("owner_activity_log").insert({
    activity_type: "school_team_member_removed",
    title: `${application.school_name} removed a school sub-user`,
    detail: removedName,
    actor_id: profile.id,
    application_id: applicationId,
    metadata: { user_id: userId },
  });

  revalidatePath(TEAM_PATH);
  revalidatePath("/portal/chat");
  revalidatePath("/portal/admin/applications");
  teamRedirect({ removed: removedName });
}

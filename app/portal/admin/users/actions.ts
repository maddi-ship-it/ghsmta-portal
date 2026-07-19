"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

const USER_PATH = "/portal/admin/users";

function selectedIds(formData: FormData) {
  return [...new Set(formData.getAll("user_ids").map(String).filter(Boolean))];
}

function revalidateUsers() {
  revalidatePath(USER_PATH);
  revalidatePath("/portal/admin/scoring");
  revalidatePath("/portal/admin/setup");
}

export async function updateUserAccess(userId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const role = String(formData.get("role") ?? "applicant") as AppRole;
  const active = formData.get("active") === "on";

  if (owner.id === userId && (role !== "owner" || !active)) {
    throw new Error("Owners cannot remove or deactivate their own owner access.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role, active }).eq("id", userId);
  if (error) throw new Error(error.message);
  revalidateUsers();
}

export async function bulkUpdateUsers(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const userIds = selectedIds(formData);
  const operation = String(formData.get("bulk_operation") ?? "");

  if (userIds.length === 0) throw new Error("Select at least one user.");

  const updates: Record<string, unknown> = {};
  if (operation === "role") {
    updates.role = String(formData.get("bulk_role") ?? "applicant") as AppRole;
  } else if (operation === "activate") {
    updates.active = true;
  } else if (operation === "deactivate") {
    updates.active = false;
  } else {
    throw new Error("Choose a valid bulk user action.");
  }

  if (userIds.includes(owner.id) && (updates.role !== undefined && updates.role !== "owner" || updates.active === false)) {
    throw new Error("Your own Owner account cannot be demoted or deactivated.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(updates).in("id", userIds);
  if (error) throw new Error(error.message);
  revalidateUsers();
  redirect(`${USER_PATH}?updated=${userIds.length}`);
}

export async function forcePasswordReset(userId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", userId)
    .single();

  if (profileError || !profile?.email) {
    throw new Error(profileError?.message ?? "This user does not have an email address.");
  }

  const headerStore = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? headerStore.get("origin") ?? "http://localhost:3000";
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: profile.email,
    options: { redirectTo: `${siteUrl}/auth/callback?next=/update-password` },
  });

  if (error) throw new Error(error.message);

  const result = await sendSmtpEmail({
    to: [profile.email],
    subject: "Reset your GHSMTA Portal password",
    text: `An Owner has required a password reset for your GHSMTA Portal account. Open this secure link: ${data.properties.action_link}`,
    html: `<h2>GHSMTA Portal password reset</h2><p>An Owner has required a password reset for your account.</p><p><a href="${data.properties.action_link}">Choose a new password</a></p><p>This link is intended only for ${profile.full_name ?? profile.email}.</p>`,
  });

  if (!result.ok) throw new Error(result.detail);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      force_password_reset: true,
      password_reset_requested_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (updateError) throw new Error(updateError.message);
  revalidateUsers();
  redirect(`${USER_PATH}?reset_sent=1`);
}

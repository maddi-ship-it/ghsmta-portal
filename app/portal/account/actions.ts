"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { normalizePhoneE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type AccountActionResult = { ok: boolean; error?: string; message?: string };

export async function updateAccountDetails(
  _previous: AccountActionResult,
  formData: FormData,
): Promise<AccountActionResult> {
  await requireProfile();
  const phone = normalizePhoneE164(String(formData.get("phone_e164") ?? ""));
  if (!phone) return { ok: false, error: "Enter a valid mobile number." };

  const preferences = {
    email: formData.get("notify_email") === "on",
    sms: formData.get("notify_sms") === "on",
    in_app: true,
  };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_account_profile", {
    p_full_name: String(formData.get("full_name") ?? ""),
    p_preferred_name: String(formData.get("preferred_name") ?? ""),
    p_phone_e164: phone,
    p_pronouns: String(formData.get("pronouns") ?? ""),
    p_organization: String(formData.get("organization") ?? ""),
    p_notification_preferences: preferences,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/account");
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: "Account details saved. Verify the mobile number again if it changed.",
  };
}

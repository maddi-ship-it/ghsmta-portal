import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  IMPERSONATION_COOKIE_NAME,
  readImpersonationCookieValue,
} from "@/lib/impersonation";
import { isActiveOwnerImpersonation } from "@/lib/impersonation-access";
import { createClient } from "@/lib/supabase/server";
import { PHONE_VERIFICATION_ENABLED } from "@/lib/security-features";
import type { AppRole, Profile } from "@/lib/types";

const PROFILE_COLUMNS = [
  "id",
  "email",
  "full_name",
  "preferred_name",
  "phone_e164",
  "phone_verified_at",
  "phone_required_at",
  "pronouns",
  "organization",
  "notification_preferences",
  "role",
  "active",
  "force_password_reset",
  "password_reset_requested_at",
  "theme_preference",
].join(",");

export async function requireProfile(
  allowedRoles?: AppRole[],
  options: { enforceSecurity?: boolean } = {},
): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/login?error=access");
  }

  const typedProfile = profile as unknown as Profile;
  if (!typedProfile.active) {
    redirect("/login?error=access");
  }

  if (allowedRoles && !allowedRoles.includes(typedProfile.role)) {
    redirect("/portal");
  }

  const cookieStore = await cookies();
  const impersonation = readImpersonationCookieValue(
    cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value,
  );
  const isOwnerImpersonation = isActiveOwnerImpersonation(
    impersonation,
    typedProfile.id,
  );

  if (options.enforceSecurity !== false && !isOwnerImpersonation) {
    if (
      PHONE_VERIFICATION_ENABLED &&
      typedProfile.phone_required_at &&
      !typedProfile.phone_verified_at
    ) {
      redirect("/verify-phone");
    }

  }

  return typedProfile;
}

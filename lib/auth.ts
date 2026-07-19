import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
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
  "mfa_required",
  "mfa_grace_until",
  "role",
  "active",
  "force_password_reset",
  "password_reset_requested_at",
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

  if (options.enforceSecurity !== false) {
    if (
      typedProfile.phone_required_at &&
      !typedProfile.phone_verified_at
    ) {
      redirect("/verify-phone");
    }

    if (typedProfile.mfa_required) {
      const graceDeadline = typedProfile.mfa_grace_until
        ? new Date(typedProfile.mfa_grace_until).getTime()
        : 0;
      const graceExpired = graceDeadline <= Date.now();

      if (graceExpired) {
        const { data: aal, error: aalError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (aalError) {
          redirect("/mfa/enroll?error=assurance");
        }

        if (aal.currentLevel !== "aal2") {
          if (aal.nextLevel === "aal2") {
            redirect("/mfa/verify");
          }
          redirect("/mfa/enroll");
        }
      }
    }
  }

  return typedProfile;
}

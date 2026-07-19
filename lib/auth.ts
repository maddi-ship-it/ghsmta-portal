import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

export async function requireProfile(allowedRoles?: AppRole[]): Promise<Profile> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,active,force_password_reset,password_reset_requested_at")
    .eq("id", user.id)
    .single();

  if (error || !profile || !profile.active) redirect("/login?error=access");

  const typedProfile = profile as Profile;
  if (allowedRoles && !allowedRoles.includes(typedProfile.role)) {
    redirect("/portal");
  }

  return typedProfile;
}

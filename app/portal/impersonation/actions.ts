"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import {
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_MAX_AGE_SECONDS,
  readImpersonationCookieValue,
  serializeImpersonationCookie,
} from "@/lib/impersonation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function displayName(profile: {
  email: string | null;
  full_name: string | null;
  preferred_name?: string | null;
}) {
  return profile.preferred_name ?? profile.full_name ?? profile.email ?? "Unknown user";
}

function safeHeader(value: string | null) {
  return value?.slice(0, 500) ?? null;
}

function parseSessionFromMagicLinkRedirect(location: string, siteUrl: string) {
  const url = new URL(location, siteUrl);
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(fragment || url.search.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    throw new Error("Supabase did not return a usable impersonation session.");
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

export async function startApplicantImpersonation(targetUserId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const reason = String(formData.get("impersonation_reason") ?? "").trim();

  if (reason.length < 3) {
    throw new Error("Enter a reason before impersonating an applicant.");
  }

  if (owner.id === targetUserId) {
    throw new Error("Owners cannot impersonate their own account.");
  }

  const supabase = await createClient();
  const {
    data: { session: ownerSession },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !ownerSession) {
    throw new Error(sessionError?.message ?? "Your Owner session could not be preserved.");
  }

  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,email,full_name,preferred_name,role,active,force_password_reset")
    .eq("id", targetUserId)
    .single();

  if (targetError || !target) {
    throw new Error(targetError?.message ?? "Applicant account not found.");
  }

  if (!target.active || target.role !== "applicant" || !target.email) {
    throw new Error("Only active applicant accounts with email sign-in can be impersonated.");
  }

  if (target.force_password_reset) {
    throw new Error("This applicant must reset their password before impersonation is available.");
  }

  const headerStore = await headers();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    headerStore.get("origin") ??
    "http://localhost:3000";
  const startedAt = new Date().toISOString();

  const { data: audit, error: auditError } = await admin
    .from("portal_impersonation_sessions")
    .insert({
      owner_user_id: owner.id,
      target_user_id: target.id,
      reason: reason.slice(0, 1_000),
      started_at: startedAt,
      ip_address: safeHeader(
        headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          headerStore.get("x-real-ip"),
      ),
      user_agent: safeHeader(headerStore.get("user-agent")),
    })
    .select("id")
    .single();

  if (auditError || !audit) {
    throw new Error(auditError?.message ?? "Could not create impersonation audit record.");
  }

  await admin.from("owner_activity_log").insert({
    activity_type: "impersonation_started",
    title: `${displayName(owner)} started applicant impersonation`,
    detail: `Viewing as ${displayName(target)}. Reason: ${reason.slice(0, 500)}`,
    actor_id: owner.id,
    metadata: {
      impersonation_session_id: audit.id,
      target_user_id: target.id,
      target_email: target.email,
    },
  });

  const linkResult = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: target.email,
  });

  if (linkResult.error) {
    await admin
      .from("portal_impersonation_sessions")
      .update({ ended_at: new Date().toISOString(), exit_reason: "magic_link_failed" })
      .eq("id", audit.id);
    throw new Error(linkResult.error.message);
  }

  const verifyResponse = await fetch(linkResult.data.properties.action_link, {
    redirect: "manual",
  });
  const verifyLocation = verifyResponse.headers.get("location");

  if (!verifyLocation) {
    throw new Error("Supabase did not return an impersonation redirect.");
  }

  const targetSession = parseSessionFromMagicLinkRedirect(verifyLocation, siteUrl);
  const cookieStore = await cookies();
  cookieStore.set(
    IMPERSONATION_COOKIE_NAME,
    serializeImpersonationCookie({
      auditId: audit.id,
      ownerId: owner.id,
      ownerEmail: owner.email,
      ownerName: displayName(owner),
      ownerAccessToken: ownerSession.access_token,
      ownerRefreshToken: ownerSession.refresh_token,
      targetId: target.id,
      targetEmail: target.email,
      targetName: displayName(target),
      startedAt,
      reason: reason.slice(0, 1_000),
    }),
    {
      httpOnly: true,
      maxAge: IMPERSONATION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );

  const { error: setSessionError } = await supabase.auth.setSession(targetSession);

  if (setSessionError) {
    cookieStore.delete(IMPERSONATION_COOKIE_NAME);
    await admin
      .from("portal_impersonation_sessions")
      .update({ ended_at: new Date().toISOString(), exit_reason: "session_swap_failed" })
      .eq("id", audit.id);
    throw new Error(setSessionError.message);
  }

  redirect("/portal?impersonating=1");
}

export async function stopImpersonation() {
  const cookieStore = await cookies();
  const payload = readImpersonationCookieValue(
    cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value,
  );

  if (!payload) {
    cookieStore.delete(IMPERSONATION_COOKIE_NAME);
    redirect("/login");
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { error } = await supabase.auth.setSession({
    access_token: payload.ownerAccessToken,
    refresh_token: payload.ownerRefreshToken,
  });

  cookieStore.delete(IMPERSONATION_COOKIE_NAME);

  await admin
    .from("portal_impersonation_sessions")
    .update({
      ended_at: new Date().toISOString(),
      exit_reason: error ? "restore_failed" : "owner_returned",
    })
    .eq("id", payload.auditId);

  await admin.from("owner_activity_log").insert({
    activity_type: error ? "impersonation_restore_failed" : "impersonation_ended",
    title: error
      ? `${payload.ownerName ?? payload.ownerEmail ?? "Owner"} could not restore Owner session`
      : `${payload.ownerName ?? payload.ownerEmail ?? "Owner"} ended applicant impersonation`,
    detail: `Viewed as ${payload.targetName ?? payload.targetEmail ?? "applicant"}.`,
    actor_id: payload.ownerId,
    metadata: {
      impersonation_session_id: payload.auditId,
      target_user_id: payload.targetId,
      target_email: payload.targetEmail,
    },
  });

  if (error) {
    redirect("/login?message=Owner session restore failed. Please sign in again.");
  }

  redirect("/portal/admin/users?impersonation_ended=1");
}

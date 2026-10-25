import { NextResponse } from "next/server";

import {
  loadAdjudicationObserverSnapshot,
  resolveAdjudicationObserverAccess,
} from "@/lib/adjudication-observer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBSERVER_ROLES = new Set(["adjudicator", "advisory_member"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const { applicationId } = await context.params;
  if (!UUID_PATTERN.test(applicationId)) {
    return NextResponse.json({ error: "Invalid application." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json(
      { error: "The shadow workspace could not be refreshed." },
      { status: 500 },
    );
  }
  if (!profile?.active || !OBSERVER_ROLES.has(profile.role)) {
    return NextResponse.json(
      { error: "You do not have access to this shadow workspace." },
      { status: 403 },
    );
  }

  try {
    const admin = createAdminClient();
    const access = await resolveAdjudicationObserverAccess({
      admin,
      applicationId,
      userId: user.id,
    });
    if (!access.allowed) {
      return NextResponse.json(
        { error: "You are not assigned to this application as a shadow." },
        { status: 403 },
      );
    }

    const snapshot = await loadAdjudicationObserverSnapshot({
      admin,
      applicationId,
    });
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Shadow adjudication workspace refresh failed", {
      applicationId,
      message: error instanceof Error ? error.message : "Unknown error",
      userId: user.id,
    });
    return NextResponse.json(
      { error: "The shadow workspace could not be refreshed." },
      { status: 500 },
    );
  }
}

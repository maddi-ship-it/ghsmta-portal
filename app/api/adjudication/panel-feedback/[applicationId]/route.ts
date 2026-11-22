import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.active) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const admin = createAdminClient();
  const assignmentResult = profile.role === "owner"
    ? { data: [{ id: "owner" }], error: null }
    : await admin
        .from("adjudicator_assignments")
        .select("id")
        .eq("application_id", applicationId)
        .eq("adjudicator_user_id", user.id)
        .or("can_score.eq.true,can_comment.eq.true")
        .or("removed_at.is.null,status.eq.complete")
        .limit(1);
  if (assignmentResult.error) {
    return NextResponse.json(
      { error: "Panel access could not be verified." },
      { status: 500 },
    );
  }

  let advisoryAccess = false;
  if (profile.role === "advisory_member") {
    const result = await supabase.rpc("can_advisory_review_application", {
      p_application_id: applicationId,
      p_user_id: user.id,
    });
    if (result.error) {
      return NextResponse.json(
        { error: "Advisory access could not be verified." },
        { status: 500 },
      );
    }
    advisoryAccess = Boolean(result.data);
  }

  if (!(assignmentResult.data?.length || advisoryAccess)) {
    return NextResponse.json(
      { error: "You are not assigned to this adjudication panel." },
      { status: 403 },
    );
  }

  const { data, error } = await admin
    .from("adjudication_panel_feedback")
    .select("*")
    .eq("application_id", applicationId)
    .eq("status", "approved");
  if (error) {
    return NextResponse.json(
      { error: "Final comments could not be refreshed." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { feedback: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

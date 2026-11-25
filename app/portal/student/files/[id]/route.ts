import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  // RLS verifies student, linked guardian, or Owner access before a URL is issued.
  const { data: file } = await supabase
    .from("portal_files")
    .select("id,context_type,context_id,original_name,storage_path")
    .eq("id", id)
    .in("context_type", ["student_profile", "student_submission"])
    .is("archived_at", null)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const admin = createAdminClient();
  let studentUserId = file.context_type === "student_profile" ? file.context_id : null;
  if (file.context_type === "student_submission") {
    const { data: submission } = await admin.from("student_submissions").select("student_user_id").eq("id", file.context_id).maybeSingle();
    studentUserId = submission?.student_user_id ?? null;
  }
  if (studentUserId) {
    await admin.from("student_portal_audit_log").insert({ actor_user_id: user.id, student_user_id: studentUserId, action: "student_file_downloaded", entity_type: "portal_file", entity_id: file.id, metadata: { file_name: file.original_name, context_type: file.context_type } });
  }
  const { data, error } = await admin.storage.from("portal-files").createSignedUrl(file.storage_path, 5 * 60, { download: file.original_name });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "The secure file link could not be created." }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}

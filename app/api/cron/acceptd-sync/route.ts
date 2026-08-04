import { syncAllEnabledAcceptdPrograms } from "@/lib/acceptd/sync";
import { logEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await syncAllEnabledAcceptdPrograms("cron");
    const summary = {
      ok: true,
      programs: results.length,
      applications_seen: results.reduce((total, result) => total + result.applicationsSeen, 0),
      applications_synced: results.reduce((total, result) => total + result.applicationsSynced, 0),
      applications_failed: results.reduce((total, result) => total + result.applicationsFailed, 0),
    };
    logEvent("info", "cron.acceptd_sync.completed", summary);
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Acceptd reconciliation failed.";
    logEvent("error", "cron.acceptd_sync.failed", { message });
    return Response.json({ error: message }, { status: 500 });
  }
}

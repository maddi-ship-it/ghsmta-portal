import { AcceptdSyncLiveRefresh } from "@/components/acceptd-sync-live-refresh";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import {
  mapAcceptdUser,
  refreshAcceptdQuestionSchema,
  saveAcceptdProgramMapping,
  syncAcceptdNow,
  unmapAcceptdUser,
} from "./actions";

type SearchParams = {
  configured?: string;
  mapped?: string;
  unmapped?: string;
  synced?: string;
  schema_synced?: string;
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function AcceptdAdminPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireProfile(["owner"]);
  const params = await searchParams;
  const supabase = await createClient();
  const [mappingsResult, cyclesResult, formsResult, profilesResult, userMappingsResult] =
    await Promise.all([
      supabase.from("acceptd_program_mappings").select("*").order("created_at"),
      supabase
        .from("award_cycles")
        .select("id,cycle_key,name,season_year,status,is_active")
        .order("season_year", { ascending: false })
        .order("name"),
      supabase
        .from("application_form_versions")
        .select("id,cycle_id,name,version_number,status")
        .order("version_number", { ascending: false }),
      supabase
        .from("profiles")
        .select("id,email,full_name,organization")
        .eq("role", "applicant")
        .eq("active", true)
        .order("full_name"),
      supabase.from("acceptd_user_mappings").select("*").order("created_at"),
    ]);
  for (const result of [mappingsResult, cyclesResult, formsResult, profilesResult, userMappingsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const mappings = mappingsResult.data ?? [];
  const cycles = cyclesResult.data ?? [];
  const forms = formsResult.data ?? [];
  const profiles = profilesResult.data ?? [];
  const userMappings = userMappingsResult.data ?? [];
  const userMappingByAcceptdId = new Map(
    userMappings.map((mapping) => [Number(mapping.acceptd_user_id), mapping]),
  );
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const webhookHeader = process.env.ACCEPTD_WEBHOOK_SIGNATURE_HEADER?.trim();
  const integrationReady = Boolean(
    process.env.ACCEPTD_API_TOKEN &&
      process.env.ACCEPTD_WEBHOOK_SECRET &&
      webhookHeader,
  );
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://YOUR-PORTAL-DOMAIN";
  const defaultCycle =
    cycles.find((cycle) => cycle.cycle_key === "26-27-dir-app") ??
    cycles.find(
      (cycle) =>
        cycle.is_active &&
        cycle.season_year.includes("2026") &&
        cycle.name.toLowerCase().includes("director"),
    );
  const defaultForm =
    forms.find(
      (form) => form.cycle_id === defaultCycle?.id && form.status === "published",
    ) ?? forms.find((form) => form.cycle_id === defaultCycle?.id);

  return (
    <div className="form-stack">
      <AcceptdSyncLiveRefresh />
      {(params.configured || params.mapped || params.unmapped || params.synced || params.schema_synced) && (
        <div className="notice page-message">
          {params.schema_synced
            ? "The hidden Acceptd question schema is up to date."
            : params.mapped
              ? "The user was mapped and their Acceptd application was synchronized."
              : params.unmapped
                ? "The Acceptd user mapping was removed."
                : params.synced
                  ? "Acceptd applications were synchronized."
                  : "Acceptd program settings were saved."}
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Server configuration</span>
            <h2>Webhook and API readiness</h2>
          </div>
          <span className={`badge${integrationReady ? " badge-complete" : ""}`}>
            {integrationReady ? "Ready" : "Needs environment variables"}
          </span>
        </div>
        <div className="panel-body detail-grid">
          <div className="detail-item"><span>Webhook URL</span><strong>{siteUrl}/api/integrations/acceptd/webhook</strong></div>
          <div className="detail-item"><span>Signature header</span><strong>{webhookHeader || "Not configured"}</strong></div>
          <div className="detail-item"><span>Webhook secret</span><strong>{process.env.ACCEPTD_WEBHOOK_SECRET ? "Configured" : "Missing"}</strong></div>
          <div className="detail-item"><span>Acceptd API token</span><strong>{process.env.ACCEPTD_API_TOKEN ? "Configured" : "Missing"}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Program connection</span>
            <h2>{mappings.length ? "Acceptd program mappings" : "Connect the 2026–27 application"}</h2>
            <p>The target form keeps its applicant-entered stages and receives a separate hidden, read-only Acceptd stage.</p>
          </div>
        </div>
        <div className="panel-body">
          {mappings.map((mapping) => {
            return (
              <form action={saveAcceptdProgramMapping} className="form-stack" key={mapping.id}>
                <input type="hidden" name="mapping_id" value={mapping.id} />
                <div className="form-grid two-columns">
                  <div className="field"><label htmlFor={`acceptd_program_id_${mapping.id}`}>Acceptd program ID</label><input className="input" id={`acceptd_program_id_${mapping.id}`} name="acceptd_program_id" inputMode="numeric" defaultValue={mapping.acceptd_program_id} required /></div>
                  <div className="field"><label htmlFor={`acceptd_program_name_${mapping.id}`}>Acceptd program name</label><input className="input" id={`acceptd_program_name_${mapping.id}`} name="acceptd_program_name" defaultValue={mapping.acceptd_program_name} required /></div>
                  <div className="field"><label htmlFor={`portal_cycle_id_${mapping.id}`}>Portal program</label><select className="select" id={`portal_cycle_id_${mapping.id}`} name="portal_cycle_id" defaultValue={mapping.portal_cycle_id} required>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.season_year} — {cycle.name}</option>)}</select></div>
                  <div className="field"><label htmlFor={`portal_form_version_id_${mapping.id}`}>Target form</label><select className="select" id={`portal_form_version_id_${mapping.id}`} name="portal_form_version_id" defaultValue={mapping.portal_form_version_id} required>{forms.map((form) => <option key={form.id} value={form.id}>{cycleById.get(form.cycle_id)?.season_year ?? "Program"} — v{form.version_number} — {form.name} ({form.status})</option>)}</select></div>
                  <div className="field"><label htmlFor={`schema_sources_${mapping.id}`}>Schema source program IDs</label><input className="input" id={`schema_sources_${mapping.id}`} name="schema_source_program_ids" defaultValue={(mapping.schema_source_program_ids ?? []).join(",")} /><p className="field-help">Use 162204 to discover the 628 fields observed in 2025–26. New conditional questions are added automatically.</p></div>
                  <div className="field"><label>Sync scope</label><label className="check-row"><input name="enabled" type="checkbox" value="true" defaultChecked={mapping.enabled} />Enable webhooks and reconciliation</label><label className="check-row"><input name="sync_drafts" type="checkbox" value="true" defaultChecked={mapping.sync_drafts} />Sync draft applications</label></div>
                </div>
                <div className="heading-actions">
                  <button className="button button-secondary" type="submit">Save connection</button>
                  <button className="button button-secondary" formAction={refreshAcceptdQuestionSchema.bind(null, mapping.id)} type="submit">Refresh hidden schema</button>
                  <button className="button button-dark" formAction={syncAcceptdNow.bind(null, mapping.id)} type="submit">Sync applications now</button>
                </div>
                <div className="detail-grid">
                  <div className="detail-item"><span>Question schema</span><strong>{formatTimestamp(mapping.last_schema_sync_at)}</strong></div>
                  <div className="detail-item"><span>Applications</span><strong>{formatTimestamp(mapping.last_application_sync_at)}</strong></div>
                  <div className="detail-item"><span>Last result</span><strong>{mapping.last_sync_status}</strong></div>
                  {mapping.last_error && <div className="detail-item"><span>Last error</span><strong>{mapping.last_error}</strong></div>}
                </div>
              </form>
            );
          })}
          {mappings.length === 0 && (
            <form action={saveAcceptdProgramMapping} className="form-stack">
              <div className="form-grid two-columns">
                <div className="field"><label htmlFor="acceptd_program_id">Acceptd program ID</label><input className="input" id="acceptd_program_id" name="acceptd_program_id" inputMode="numeric" defaultValue="175284" required /></div>
                <div className="field"><label htmlFor="acceptd_program_name">Acceptd program name</label><input className="input" id="acceptd_program_name" name="acceptd_program_name" defaultValue="2026-27 GHSMTA Director's Application" required /></div>
                <div className="field"><label htmlFor="portal_cycle_id">Portal program</label><select className="select" id="portal_cycle_id" name="portal_cycle_id" defaultValue={defaultCycle?.id ?? ""} required><option value="">Choose the 26–27 program</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.season_year} — {cycle.name}</option>)}</select></div>
                <div className="field"><label htmlFor="portal_form_version_id">Target form</label><select className="select" id="portal_form_version_id" name="portal_form_version_id" defaultValue={defaultForm?.id ?? ""} required><option value="">Choose its published form</option>{forms.map((form) => <option key={form.id} value={form.id}>{cycleById.get(form.cycle_id)?.season_year ?? "Program"} — v{form.version_number} — {form.name} ({form.status})</option>)}</select></div>
                <div className="field"><label htmlFor="schema_source_program_ids">Schema source program IDs</label><input className="input" id="schema_source_program_ids" name="schema_source_program_ids" defaultValue="162204" /><p className="field-help">The historic program exposes 628 known questions; conditional questions will be added when first seen.</p></div>
                <div className="field"><label>Sync scope</label><label className="check-row"><input name="enabled" type="checkbox" value="true" defaultChecked />Enable webhooks and reconciliation</label><label className="check-row"><input name="sync_drafts" type="checkbox" value="true" defaultChecked />Sync draft applications</label></div>
              </div>
              <button className="button button-dark" type="submit">Save Acceptd connection</button>
            </form>
          )}
        </div>
      </section>

      {mappings.map((mapping) => (
        <AcceptdProgramStatus
          key={mapping.id}
          mappingId={mapping.id}
          profiles={profiles}
          profileById={profileById}
          supabase={supabase}
          userMappingByAcceptdId={userMappingByAcceptdId}
        />
      ))}
    </div>
  );
}

async function AcceptdProgramStatus({
  mappingId,
  profiles,
  profileById,
  supabase,
  userMappingByAcceptdId,
}: {
  mappingId: string;
  profiles: Array<{ id: string; email: string | null; full_name: string | null; organization: string | null }>;
  profileById: Map<string, { id: string; email: string | null; full_name: string | null; organization: string | null }>;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userMappingByAcceptdId: Map<number, Record<string, unknown>>;
}) {
  const [snapshotsResult, runsResult, questionCountResult] = await Promise.all([
    supabase
      .from("acceptd_application_snapshots")
      .select("id,acceptd_application_id,acceptd_user_id,acceptd_applicant_name,acceptd_applicant_email,portal_application_id,mapping_status,issue,last_seen_at,last_synced_at")
      .eq("program_mapping_id", mappingId)
      .order("last_seen_at", { ascending: false }),
    supabase
      .from("acceptd_sync_runs")
      .select("id,trigger_source,status,applications_seen,applications_synced,applications_unmapped,applications_failed,questions_discovered,started_at,finished_at,error")
      .eq("program_mapping_id", mappingId)
      .order("started_at", { ascending: false })
      .limit(8),
    supabase
      .from("acceptd_question_mappings")
      .select("id", { count: "exact", head: true })
      .eq("program_mapping_id", mappingId),
  ]);
  for (const result of [snapshotsResult, runsResult, questionCountResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const snapshots = snapshotsResult.data ?? [];
  const runs = runsResult.data ?? [];

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div><span className="eyebrow">Identity reconciliation</span><h2>Acceptd users</h2><p>Map each source account once. The application then creates or links and continues syncing automatically.</p></div>
          <span className="badge">{snapshots.length} applications</span>
        </div>
        <div className="panel-body">
          {snapshots.length === 0 ? (
            <div className="empty-state"><h3>No Acceptd records staged yet.</h3><p>Run “Sync applications now” to load the current program roster.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Acceptd applicant</th><th>Portal applicant</th><th>Status</th><th>Last sync</th><th>Action</th></tr></thead>
                <tbody>
                  {snapshots.map((snapshot) => {
                    const acceptdUserId = Number(snapshot.acceptd_user_id);
                    const userMapping = userMappingByAcceptdId.get(acceptdUserId);
                    const mappedProfile = userMapping
                      ? profileById.get(String(userMapping.portal_profile_id))
                      : null;
                    return (
                      <tr key={snapshot.id}>
                        <td><strong>{snapshot.acceptd_applicant_name || `Application ${snapshot.acceptd_application_id}`}</strong><small>{snapshot.acceptd_applicant_email ?? `Acceptd user ${snapshot.acceptd_user_id ?? "unknown"}`}</small></td>
                        <td>{mappedProfile ? <><strong>{mappedProfile.full_name ?? mappedProfile.email}</strong><small>{mappedProfile.organization ?? mappedProfile.email}</small></> : "Not mapped"}</td>
                        <td><span className="badge">{snapshot.mapping_status}</span>{snapshot.issue && <small>{snapshot.issue}</small>}</td>
                        <td>{formatTimestamp(snapshot.last_synced_at ?? snapshot.last_seen_at)}</td>
                        <td>
                          {userMapping ? (
                            <form action={unmapAcceptdUser.bind(null, String(userMapping.id))}><button className="text-button" type="submit">Remove mapping</button></form>
                          ) : snapshot.acceptd_user_id ? (
                            <form action={mapAcceptdUser.bind(null, mappingId)} className="form-stack">
                              <input type="hidden" name="acceptd_user_id" value={snapshot.acceptd_user_id} />
                              <input type="hidden" name="acceptd_name" value={snapshot.acceptd_applicant_name ?? ""} />
                              <input type="hidden" name="acceptd_email" value={snapshot.acceptd_applicant_email ?? ""} />
                              <select className="select" name="portal_profile_id" required><option value="">Choose portal user</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name ?? profile.email}{profile.organization ? ` — ${profile.organization}` : ""}</option>)}</select>
                              <button className="button button-secondary" type="submit">Map and sync</button>
                            </form>
                          ) : "Acceptd user ID missing"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><span className="eyebrow">Monitoring</span><h2>Sync history</h2></div><span className="badge">{questionCountResult.count ?? 0} known · ~688 expected</span></div>
        <div className="panel-body">
          {runs.length === 0 ? <div className="empty-state"><p>No sync runs yet.</p></div> : (
            <div className="table-wrap"><table><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Applications</th><th>Questions added</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{formatTimestamp(run.started_at)}</td><td>{run.trigger_source}</td><td><span className="badge">{run.status}</span>{run.error && <small>{run.error}</small>}</td><td>{run.applications_synced} synced · {run.applications_unmapped} unmapped · {run.applications_failed} failed</td><td>{run.questions_discovered}</td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>
    </>
  );
}

import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import {
  REPORT_CATEGORIES,
  REPORT_DEFINITIONS,
  findReportDefinition,
  type ReportDefinition,
  type ReportFormat,
} from "@/lib/reports/report-definitions";
import { loadReport, parseReportFilters, type ReportRow } from "@/lib/reports/report-data";
import { createClient } from "@/lib/supabase/server";

import {
  deleteReportPreset,
  saveReportPreset,
  saveReportSchedule,
  sendOwnerDigestFromReports,
  toggleReportSchedule,
} from "./actions";

type ReportsParams = {
  report?: string;
  category?: string;
  catalog_q?: string;
  cycle_id?: string;
  date_from?: string;
  date_to?: string;
  school?: string;
  status?: string;
  include_archived?: string;
  include_internal_notes?: string;
  include_contact_info?: string;
  include_adjudicator_identities?: string;
  include_protected_scores?: string;
  variant?: string;
  sort?: string;
  direction?: string;
  success?: string;
  error?: string;
};

type CycleOption = {
  id: string;
  name: string | null;
  season_year: string | null;
  status: string | null;
};

type DigestSetting = {
  enabled: boolean;
  recipient_email: string | null;
  delivery_hour: number;
  time_zone: string;
  include_empty?: boolean | null;
  last_sent_at: string | null;
};

type ReportRun = {
  id: string;
  report_key: string;
  report_title: string;
  requested_format: string;
  row_count: number;
  created_at: string;
  file_name: string | null;
};

type ReportPreset = {
  id: string;
  report_key: string;
  name: string;
  description: string | null;
  format: string;
  variant: string;
  favorite: boolean;
  created_at: string;
};

type ReportSchedule = {
  id: string;
  report_key: string;
  name: string;
  enabled: boolean;
  format: string;
  variant: string;
  delivery_emails: string[];
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
};

function asSearchParams(params: ReportsParams) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (!value || key === "success" || key === "error") return;
    searchParams.set(key, value);
  });
  return searchParams;
}

function reportsHref(params: ReportsParams, updates: Record<string, string | null>) {
  const next = asSearchParams(params);
  Object.entries(updates).forEach(([key, value]) => {
    if (value) next.set(key, value);
    else next.delete(key);
  });
  const query = next.toString();
  return query ? `/portal/admin/reports?${query}` : "/portal/admin/reports";
}

function downloadHref(params: ReportsParams, definition: ReportDefinition, format: ReportFormat) {
  const next = asSearchParams(params);
  next.delete("report");
  next.delete("category");
  next.delete("catalog_q");
  next.set("format", format);
  return `/api/admin/reports/${definition.id}?${next.toString()}`;
}

function formatDate(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
}

function cellValue(row: ReportRow, key: string) {
  const value = row[key];
  if (value == null || value === "") return "—";
  return String(value);
}

function HiddenReportFields({
  params,
  definition,
  selectedSort,
  filters,
}: {
  params: ReportsParams;
  definition: ReportDefinition;
  selectedSort: string;
  filters: ReturnType<typeof parseReportFilters>;
}) {
  const hiddenFields: Record<string, string> = {
    report_key: definition.id,
    cycle_id: params.cycle_id ?? "",
    date_from: params.date_from ?? "",
    date_to: params.date_to ?? "",
    school: params.school ?? "",
    status: params.status ?? "",
    variant: filters.variant,
    sort: selectedSort,
    direction: filters.direction,
  };
  return (
    <>
      {Object.entries(hiddenFields).map(([key, value]) => (
        <input key={key} name={key} type="hidden" value={value} />
      ))}
      {filters.includeArchived && <input name="include_archived" type="hidden" value="on" />}
      {filters.includeInternalNotes && <input name="include_internal_notes" type="hidden" value="on" />}
      {filters.includeContactInfo && <input name="include_contact_info" type="hidden" value="on" />}
      {filters.includeAdjudicatorIdentities && <input name="include_adjudicator_identities" type="hidden" value="on" />}
      {filters.includeProtectedScores && <input name="include_protected_scores" type="hidden" value="on" />}
    </>
  );
}

function matchesCatalogSearch(definition: ReportDefinition, query: string) {
  if (!query) return true;
  const haystack = [
    definition.title,
    definition.description,
    definition.category,
    definition.source,
    definition.id,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function DigestSummary({
  digest,
  ownerEmail,
}: {
  digest: DigestSetting | null;
  ownerEmail: string | null;
}) {
  return (
    <div className="panel-body report-digest-details">
      <div>
        <span>Recipient</span>
        <strong>{digest?.recipient_email || ownerEmail || "No recipient configured"}</strong>
      </div>
      <div>
        <span>Scheduled delivery</span>
        <strong>
          {digest?.enabled
            ? `${digest.delivery_hour}:00 · ${digest.time_zone}`
            : "Scheduled delivery disabled"}
        </strong>
      </div>
      <div>
        <span>Empty digest</span>
        <strong>{digest?.include_empty ? "Send even when quiet" : "Skip if quiet"}</strong>
      </div>
      <div>
        <span>Last sent</span>
        <strong>{formatDate(digest?.last_sent_at)}</strong>
      </div>
    </div>
  );
}

export default async function OwnerReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportsParams>;
}) {
  const owner = await requireProfile(["owner"]);
  const params = await searchParams;
  const selectedDefinition =
    findReportDefinition(params.report ?? "") ?? REPORT_DEFINITIONS[0];
  if (!selectedDefinition) throw new Error("No reports are configured.");
  const catalogQuery = params.catalog_q?.trim() ?? "";
  const selectedCategory = (REPORT_CATEGORIES as string[]).includes(params.category ?? "")
    ? params.category ?? ""
    : "";

  const supabase = await createClient();
  const [cycleResult, digestResult, runResult, presetResult, scheduleResult] = await Promise.all([
    supabase
      .from("award_cycles")
      .select("id,name,season_year,status")
      .neq("status", "archived")
      .order("season_year", { ascending: false }),
    supabase
      .from("owner_digest_settings")
      .select("enabled,recipient_email,delivery_hour,time_zone,include_empty,last_sent_at")
      .eq("owner_user_id", owner.id)
      .maybeSingle(),
    supabase
      .from("report_runs")
      .select("id,report_key,report_title,requested_format,row_count,file_name,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("report_presets")
      .select("id,report_key,name,description,format,variant,favorite,created_at")
      .eq("owner_user_id", owner.id)
      .order("favorite", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("report_schedules")
      .select("id,report_key,name,enabled,format,variant,delivery_emails,next_run_at,last_run_at,last_status")
      .eq("owner_user_id", owner.id)
      .order("next_run_at", { ascending: true })
      .limit(12),
  ]);

  if (cycleResult.error) throw new Error(cycleResult.error.message);
  if (digestResult.error) throw new Error(digestResult.error.message);

  const cycles = (cycleResult.data ?? []) as CycleOption[];
  const recentRuns = runResult.error ? [] : ((runResult.data ?? []) as ReportRun[]);
  const recentPresets = presetResult.error ? [] : ((presetResult.data ?? []) as ReportPreset[]);
  const recentSchedules = scheduleResult.error ? [] : ((scheduleResult.data ?? []) as ReportSchedule[]);
  const runWarning = [runResult.error, presetResult.error, scheduleResult.error].some(Boolean)
    ? "Report run history, presets, and schedules will appear after the Reports Center migration is applied."
    : "";

  const urlParams = asSearchParams(params);
  const filters = parseReportFilters(urlParams);
  const loadedReport = await loadReport(supabase, selectedDefinition.id, filters);
  const previewRows = loadedReport.rows.slice(0, 30);
  const filteredCatalog = REPORT_DEFINITIONS.filter((definition) => {
    if (selectedCategory && definition.category !== selectedCategory) return false;
    return matchesCatalogSearch(definition, catalogQuery);
  });
  const selectedSort = params.sort || loadedReport.columns[0]?.key || "";

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Owner administration</span>
          <h1>Reports Center</h1>
          <p>
            Generate operational, scoring, scheduling, user, billing-adjacent,
            audit, and release reports with internal/external visibility
            controls.
          </p>
        </div>
      </div>

      {params.success && (
        <div className="notice-banner success-banner page-message">
          {params.success}
        </div>
      )}
      {params.error && <div className="form-error page-message">{params.error}</div>}

      <section className="panel report-digest-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Email delivery</span>
            <h2>Daily Owner Digest</h2>
            <p>
              A role-restricted owner email with action items, blocked
              workflows, scoring gaps, schedule exceptions, appeals, and recent
              owner activity.
            </p>
          </div>
          <form action={sendOwnerDigestFromReports}>
            <input name="report" type="hidden" value={selectedDefinition.id} />
            <button className="button button-gold" type="submit">
              Send digest now
            </button>
          </form>
        </div>
        <DigestSummary
          digest={(digestResult.data as DigestSetting | null) ?? null}
          ownerEmail={owner.email}
        />
      </section>

      <div className="report-center-layout">
        <aside className="panel report-catalog-panel">
          <div className="panel-header">
            <div>
              <h2>Report catalog</h2>
              <p>{filteredCatalog.length} of {REPORT_DEFINITIONS.length} reports shown.</p>
            </div>
          </div>
          <div className="panel-body">
            <form className="report-catalog-filters" method="get">
              <input name="report" type="hidden" value={selectedDefinition.id} />
              <div className="field">
                <label htmlFor="catalog_q">Find report</label>
                <input
                  className="input"
                  defaultValue={params.catalog_q ?? ""}
                  id="catalog_q"
                  name="catalog_q"
                  placeholder="Score, appeal, users, schedule…"
                  type="search"
                />
              </div>
              <div className="field">
                <label htmlFor="category">Category</label>
                <select
                  className="select"
                  defaultValue={selectedCategory}
                  id="category"
                  name="category"
                >
                  <option value="">All categories</option>
                  {REPORT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <button className="button button-secondary button-compact" type="submit">
                Filter catalog
              </button>
            </form>

            <div className="report-catalog-list">
              {filteredCatalog.map((definition) => (
                <Link
                  className={
                    definition.id === selectedDefinition.id
                      ? "report-catalog-card is-active"
                      : "report-catalog-card"
                  }
                  href={reportsHref(params, { report: definition.id })}
                  key={definition.id}
                >
                  <span>{definition.category}</span>
                  <strong>{definition.title}</strong>
                  <small>{definition.description}</small>
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <main className="report-preview-stack">
          <section className="panel report-builder-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">{selectedDefinition.category}</span>
                <h2>{selectedDefinition.title}</h2>
                <p>{selectedDefinition.description}</p>
              </div>
              <div className="report-download-actions">
                {selectedDefinition.formats.includes("pdf") && (
                  <Link
                    className="button button-dark"
                    href={downloadHref(params, selectedDefinition, "pdf")}
                    prefetch={false}
                  >
                    Download PDF
                  </Link>
                )}
                {selectedDefinition.formats.includes("csv") && (
                  <Link
                    className="button button-secondary"
                    href={downloadHref(params, selectedDefinition, "csv")}
                    prefetch={false}
                  >
                    Download CSV
                  </Link>
                )}
              </div>
            </div>

            {selectedDefinition.confidentialityNote && (
              <div className="notice-banner page-message">
                {selectedDefinition.confidentialityNote}
              </div>
            )}

            <div className="panel-body">
              <form className="report-filter-grid" method="get">
                <input name="report" type="hidden" value={selectedDefinition.id} />
                <input name="category" type="hidden" value={selectedCategory} />
                <input name="catalog_q" type="hidden" value={catalogQuery} />

                <div className="field">
                  <label htmlFor="cycle_id">Cycle</label>
                  <select
                    className="select"
                    defaultValue={params.cycle_id ?? ""}
                    id="cycle_id"
                    name="cycle_id"
                  >
                    <option value="">All active cycles</option>
                    {cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.season_year} · {cycle.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="school">School</label>
                  <input
                    className="input"
                    defaultValue={params.school ?? ""}
                    id="school"
                    name="school"
                    placeholder="School name"
                  />
                </div>
                <div className="field">
                  <label htmlFor="status">Status</label>
                  <input
                    className="input"
                    defaultValue={params.status ?? ""}
                    id="status"
                    name="status"
                    placeholder="submitted, pending, paid…"
                  />
                </div>
                <div className="field">
                  <label htmlFor="date_from">From</label>
                  <input
                    className="input"
                    defaultValue={params.date_from ?? ""}
                    id="date_from"
                    name="date_from"
                    type="date"
                  />
                </div>
                <div className="field">
                  <label htmlFor="date_to">To</label>
                  <input
                    className="input"
                    defaultValue={params.date_to ?? ""}
                    id="date_to"
                    name="date_to"
                    type="date"
                  />
                </div>
                <div className="field">
                  <label htmlFor="variant">Variant</label>
                  <select
                    className="select"
                    defaultValue={loadedReport.filters.variant}
                    id="variant"
                    name="variant"
                  >
                    <option value="internal">Internal</option>
                    {selectedDefinition.supportsExternalVariant && (
                      <option value="external">External / sanitized</option>
                    )}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sort">Sort</label>
                  <select
                    className="select"
                    defaultValue={selectedSort}
                    id="sort"
                    name="sort"
                  >
                    {loadedReport.columns.map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="direction">Direction</label>
                  <select
                    className="select"
                    defaultValue={loadedReport.filters.direction}
                    id="direction"
                    name="direction"
                  >
                    <option value="asc">A to Z / oldest first</option>
                    <option value="desc">Z to A / newest first</option>
                  </select>
                </div>

                <label className="check-card compact-check-card">
                  <input
                    defaultChecked={loadedReport.filters.includeArchived}
                    name="include_archived"
                    type="checkbox"
                  />
                  <span><strong>Include archived</strong><small>Bring historical applications into scope.</small></span>
                </label>
                <label className="check-card compact-check-card">
                  <input
                    defaultChecked={loadedReport.filters.includeInternalNotes}
                    name="include_internal_notes"
                    type="checkbox"
                  />
                  <input name="include_internal_notes" type="hidden" value="0" />
                  <span><strong>Internal notes</strong><small>Owner/advisory notes in eligible reports.</small></span>
                </label>
                <label className="check-card compact-check-card">
                  <input
                    defaultChecked={loadedReport.filters.includeContactInfo}
                    name="include_contact_info"
                    type="checkbox"
                  />
                  <input name="include_contact_info" type="hidden" value="0" />
                  <span><strong>Contact info</strong><small>Names, email, and phone fields.</small></span>
                </label>
                <label className="check-card compact-check-card">
                  <input
                    defaultChecked={loadedReport.filters.includeAdjudicatorIdentities}
                    name="include_adjudicator_identities"
                    type="checkbox"
                  />
                  <input name="include_adjudicator_identities" type="hidden" value="0" />
                  <span><strong>Panel identities</strong><small>Adjudicator/staff identity fields.</small></span>
                </label>
                <label className="check-card compact-check-card">
                  <input
                    defaultChecked={loadedReport.filters.includeProtectedScores}
                    name="include_protected_scores"
                    type="checkbox"
                  />
                  <input name="include_protected_scores" type="hidden" value="0" />
                  <span><strong>Protected scores</strong><small>Raw scores, comments, and observations.</small></span>
                </label>

                <button className="button button-dark" type="submit">
                  Update preview
                </button>
                <Link className="button button-secondary" href="/portal/admin/reports">
                  Reset
                </Link>
              </form>
            </div>
          </section>

          <section className="metric-grid report-metric-grid">
            <article className="metric-card">
              <span className="metric-label">Rows</span>
              <strong className="metric-value">{loadedReport.rows.length}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-label">Visible columns</span>
              <strong className="metric-value">{loadedReport.columns.length}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-label">Formats</span>
              <strong className="metric-value">{selectedDefinition.formats.join(" / ").toUpperCase()}</strong>
            </article>
          </section>

          {loadedReport.warnings.length > 0 && (
            <section className="panel report-warning-panel">
              <div className="panel-body">
                <strong>Data notes</strong>
                <ul>
                  {loadedReport.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section className="panel report-save-panel">
            <div className="panel-header">
              <div>
                <h2>Save or schedule this setup</h2>
                <p>
                  Presets keep your current filters; schedules email the chosen
                  export to owner-approved recipients once the schedule table is
                  available.
                </p>
              </div>
            </div>
            <div className="panel-body report-save-grid">
              <form action={saveReportPreset} className="form-stack">
                <HiddenReportFields
                  definition={selectedDefinition}
                  filters={loadedReport.filters}
                  params={params}
                  selectedSort={selectedSort}
                />
                <div className="field">
                  <label htmlFor="preset_name">Preset name</label>
                  <input
                    className="input"
                    id="preset_name"
                    name="preset_name"
                    placeholder={`${selectedDefinition.title} — filtered`}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="preset_description">Description</label>
                  <input
                    className="input"
                    id="preset_description"
                    name="preset_description"
                    placeholder="Optional note for future Owners"
                  />
                </div>
                <div className="field">
                  <label htmlFor="preset_format">Format</label>
                  <select
                    className="select"
                    defaultValue={selectedDefinition.formats[0] ?? "pdf"}
                    id="preset_format"
                    name="format"
                  >
                    {selectedDefinition.formats.map((format) => (
                      <option key={format} value={format}>
                        {format.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="check-row">
                  <input name="favorite" type="checkbox" />
                  Mark as favorite
                </label>
                <button className="button button-secondary" type="submit">
                  Save preset
                </button>
              </form>

              <form action={saveReportSchedule} className="form-stack">
                <HiddenReportFields
                  definition={selectedDefinition}
                  filters={loadedReport.filters}
                  params={params}
                  selectedSort={selectedSort}
                />
                <div className="field">
                  <label htmlFor="schedule_name">Schedule name</label>
                  <input
                    className="input"
                    id="schedule_name"
                    name="schedule_name"
                    placeholder={`${selectedDefinition.title} — daily`}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="delivery_emails">Delivery emails</label>
                  <textarea
                    className="textarea"
                    defaultValue={owner.email ?? ""}
                    id="delivery_emails"
                    name="delivery_emails"
                    rows={2}
                  />
                </div>
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="schedule_format">Format</label>
                    <select
                      className="select"
                      defaultValue={selectedDefinition.formats[0] ?? "pdf"}
                      id="schedule_format"
                      name="format"
                    >
                      {selectedDefinition.formats.map((format) => (
                        <option key={format} value={format}>
                          {format.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="delivery_hour">Daily hour</label>
                    <select className="select" defaultValue="8" id="delivery_hour" name="delivery_hour">
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(new Date(2020, 0, 1, hour))}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="time_zone">Time zone</label>
                    <input
                      className="input"
                      defaultValue="America/New_York"
                      id="time_zone"
                      name="time_zone"
                    />
                  </div>
                </div>
                <button className="button button-dark" type="submit">
                  Schedule report
                </button>
              </form>
            </div>

            <div className="report-saved-lists">
              <div>
                <h3>Saved presets</h3>
                {recentPresets.length === 0 ? (
                  <p>No saved presets yet.</p>
                ) : (
                  recentPresets.map((preset) => (
                    <article className="report-saved-card" key={preset.id}>
                      <div>
                        <strong>{preset.name}</strong>
                        <small>
                          {findReportDefinition(preset.report_key)?.title ?? preset.report_key} · {preset.format.toUpperCase()} · {preset.variant}
                          {preset.favorite ? " · Favorite" : ""}
                        </small>
                      </div>
                      <form action={deleteReportPreset.bind(null, preset.id)}>
                        <button className="button button-ghost button-compact" type="submit">
                          Delete
                        </button>
                      </form>
                    </article>
                  ))
                )}
              </div>
              <div>
                <h3>Scheduled reports</h3>
                {recentSchedules.length === 0 ? (
                  <p>No scheduled reports yet.</p>
                ) : (
                  recentSchedules.map((schedule) => (
                    <article className="report-saved-card" key={schedule.id}>
                      <div>
                        <strong>{schedule.name}</strong>
                        <small>
                          {findReportDefinition(schedule.report_key)?.title ?? schedule.report_key} · {schedule.format.toUpperCase()} · next {formatDate(schedule.next_run_at)}
                          {schedule.last_status ? ` · last ${schedule.last_status}` : ""}
                        </small>
                      </div>
                      <form action={toggleReportSchedule.bind(null, schedule.id, !schedule.enabled)}>
                        <button className="button button-secondary button-compact" type="submit">
                          {schedule.enabled ? "Pause" : "Resume"}
                        </button>
                      </form>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="panel report-panel">
            <div className="panel-header">
              <div>
                <h2>Preview</h2>
                <p>
                  Showing {previewRows.length} of {loadedReport.rows.length} rows.
                  Downloads include the selected export format’s full available
                  dataset.
                </p>
              </div>
            </div>
            <div className="table-wrap report-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {loadedReport.columns.slice(0, 8).map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={`${selectedDefinition.id}-${index}`}>
                      {loadedReport.columns.slice(0, 8).map((column) => (
                        <td key={column.key}>
                          {cellValue(row, column.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {previewRows.length === 0 && (
                    <tr>
                      <td colSpan={Math.max(loadedReport.columns.slice(0, 8).length, 1)}>
                        No rows match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Recent report runs</h2>
                <p>
                  Owner-only audit history for generated exports.
                </p>
              </div>
            </div>
            <div className="panel-body">
              {runWarning && <div className="notice-banner page-message">{runWarning}</div>}
              {recentRuns.length === 0 ? (
                <p>No report run history yet.</p>
              ) : (
                <div className="owner-activity-list">
                  {recentRuns.map((run) => (
                    <article key={run.id}>
                      <strong>{run.report_title}</strong>
                      <p>
                        {run.row_count} rows · {run.requested_format.toUpperCase()}
                        {run.file_name ? ` · ${run.file_name}` : ""}
                      </p>
                      <small>{formatDate(run.created_at)}</small>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

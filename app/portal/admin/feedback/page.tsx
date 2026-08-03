import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

type QueueParams = {
  status?: string;
  type?: string;
  priority?: string;
  q?: string;
  page?: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function queueHref(params: QueueParams, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") query.set(key, value);
  }
  query.set("page", String(page));
  return `/portal/admin/feedback?${query.toString()}`;
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<QueueParams>;
}) {
  await requireProfile(["owner"]);
  const params = await searchParams;
  const supabase = await createClient();
  const status = params.status || "open";
  const type = ["bug_report", "feature_request"].includes(params.type ?? "")
    ? params.type
    : "";
  const priority = ["low", "normal", "high", "urgent"].includes(
    params.priority ?? "",
  )
    ? params.priority
    : "";
  const search = (params.q ?? "").trim().slice(0, 100);
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;

  let ticketQuery = supabase
    .from("portal_feedback_requests")
    .select(
      "id,reference_code,request_type,title,description,priority,status,submitted_by,created_at,updated_at,closed_at",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status === "open") ticketQuery = ticketQuery.neq("status", "closed");
  else if (FEEDBACK_STATUSES.includes(status as never)) {
    ticketQuery = ticketQuery.eq("status", status);
  }
  if (type) ticketQuery = ticketQuery.eq("request_type", type);
  if (priority) ticketQuery = ticketQuery.eq("priority", priority);
  if (search) ticketQuery = ticketQuery.ilike("title", `%${search}%`);

  const [ticketResult, allResult, openResult, urgentResult, closedResult] =
    await Promise.all([
      ticketQuery,
      supabase.from("portal_feedback_requests").select("id", { count: "exact", head: true }),
      supabase.from("portal_feedback_requests").select("id", { count: "exact", head: true }).neq("status", "closed"),
      supabase.from("portal_feedback_requests").select("id", { count: "exact", head: true }).eq("priority", "urgent").neq("status", "closed"),
      supabase.from("portal_feedback_requests").select("id", { count: "exact", head: true }).eq("status", "closed"),
    ]);
  for (const result of [ticketResult, allResult, openResult, urgentResult, closedResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const tickets = ticketResult.data ?? [];
  const submitterIds = [...new Set(tickets.map((ticket) => ticket.submitted_by))];
  const profileResult = submitterIds.length
    ? await supabase.from("profiles").select("id,full_name,email").in("id", submitterIds)
    : { data: [], error: null };
  if (profileResult.error) throw new Error(profileResult.error.message);
  const profiles = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile]));
  const totalPages = Math.max(1, Math.ceil((ticketResult.count ?? 0) / PAGE_SIZE));

  return (
    <div className="feedback-admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Owner administration</span>
          <h1>Bug &amp; feature tickets</h1>
          <p>Review complete request context, update progress, and close resolved tickets.</p>
        </div>
      </header>

      <section className="feedback-queue-metrics" aria-label="Ticket totals">
        <article><small>All tickets</small><strong>{allResult.count ?? 0}</strong></article>
        <article><small>Open</small><strong>{openResult.count ?? 0}</strong></article>
        <article><small>Urgent and open</small><strong>{urgentResult.count ?? 0}</strong></article>
        <article><small>Closed</small><strong>{closedResult.count ?? 0}</strong></article>
      </section>

      <section className="panel feedback-queue-panel">
        <div className="panel-header">
          <div><h2>Ticket queue</h2><p>{ticketResult.count ?? 0} matching tickets</p></div>
        </div>
        <form className="feedback-queue-filters" method="get">
          <div className="field"><label htmlFor="ticket_status">Status</label><select className="select" defaultValue={status} id="ticket_status" name="status"><option value="open">All open</option><option value="all">All statuses</option>{FEEDBACK_STATUSES.map((value) => <option key={value} value={value}>{FEEDBACK_STATUS_LABELS[value]}</option>)}</select></div>
          <div className="field"><label htmlFor="ticket_type">Type</label><select className="select" defaultValue={type} id="ticket_type" name="type"><option value="">All types</option><option value="bug_report">Bug report</option><option value="feature_request">Feature request</option></select></div>
          <div className="field"><label htmlFor="ticket_priority">Priority</label><select className="select" defaultValue={priority} id="ticket_priority" name="priority"><option value="">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></div>
          <div className="field feedback-ticket-search"><label htmlFor="ticket_search">Search title</label><input className="input" defaultValue={search} id="ticket_search" name="q" placeholder="Ticket title" /></div>
          <button className="button button-secondary" type="submit">Apply filters</button>
        </form>

        <div className="feedback-admin-list">
          {tickets.map((ticket) => {
            const submitter = profiles.get(ticket.submitted_by);
            return (
              <article className="feedback-admin-row" key={ticket.id}>
                <div className="feedback-admin-row-main">
                  <div className="feedback-admin-row-badges"><span className={`status-pill status-${ticket.status}`}>{FEEDBACK_STATUS_LABELS[ticket.status as keyof typeof FEEDBACK_STATUS_LABELS] ?? ticket.status}</span><span className={`badge badge-priority-${ticket.priority}`}>{ticket.priority}</span><span className="badge">{ticket.request_type === "bug_report" ? "Bug report" : "Feature request"}</span></div>
                  <h3>{ticket.title}</h3>
                  <p>{ticket.description}</p>
                  <small>{ticket.reference_code ?? "Pending reference"} · {submitter?.full_name ?? submitter?.email ?? "Unknown submitter"} · Updated {formatDate(ticket.updated_at)}</small>
                </div>
                <Link className="button button-secondary button-compact" href={`/portal/admin/feedback/${ticket.id}`}>View full ticket</Link>
              </article>
            );
          })}
          {tickets.length === 0 && <div className="empty-state"><h2>No matching tickets</h2><p>Adjust the filters or check again after a new report is submitted.</p></div>}
        </div>
      </section>

      {totalPages > 1 && (
        <nav className="feedback-pagination" aria-label="Ticket pages">
          {page > 1 && <Link className="button button-secondary" href={queueHref(params, page - 1)}>Previous</Link>}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages && <Link className="button button-secondary" href={queueHref(params, page + 1)}>Next</Link>}
        </nav>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  closeFeedbackTicket,
  reopenFeedbackTicket,
  updateFeedbackTicket,
} from "@/app/portal/admin/feedback/actions";
import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { requireProfile } from "@/lib/auth";
import { FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES } from "@/lib/feedback";
import { roleLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type DetailParams = { success?: string; error?: string };

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}

function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function FeedbackTicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<DetailParams>;
}) {
  await requireProfile(["owner"]);
  const [{ id }, messages] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [ticketResult, eventResult, fileResult] = await Promise.all([
    supabase.from("portal_feedback_requests").select("*").eq("id", id).maybeSingle(),
    supabase.from("portal_feedback_events").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    supabase.from("portal_files").select("id,original_name,generated_name,storage_path,mime_type,file_size,uploaded_by,created_at").eq("context_id", id).in("context_type", ["bug_report", "feature_request"]).order("created_at"),
  ]);
  if (ticketResult.error) throw new Error(ticketResult.error.message);
  if (!ticketResult.data) notFound();
  if (eventResult.error) throw new Error(eventResult.error.message);
  if (fileResult.error) throw new Error(fileResult.error.message);
  const ticket = ticketResult.data;
  const events = eventResult.data ?? [];
  const files = fileResult.data ?? [];

  const profileIds = [...new Set([
    ticket.submitted_by,
    ticket.closed_by,
    ticket.status_changed_by,
    ...events.map((event) => event.changed_by),
  ].filter((value): value is string => Boolean(value)))];
  const profileResult = profileIds.length
    ? await supabase.from("profiles").select("id,full_name,email,role").in("id", profileIds)
    : { data: [], error: null };
  if (profileResult.error) throw new Error(profileResult.error.message);
  const profiles = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile]));
  const submitter = profiles.get(ticket.submitted_by);

  const attachments = await Promise.all(
    files.map(async (file) => {
      const { data } = await supabase.storage.from("portal-files").createSignedUrl(file.storage_path, 60 * 30);
      return { ...file, signedUrl: data?.signedUrl ?? null };
    }),
  );
  const pageUrl = safeHttpUrl(ticket.page_url);
  const closed = ticket.status === "closed";

  return (
    <div className="feedback-ticket-detail-page">
      <Link className="text-button feedback-back-link" href="/portal/admin/feedback">← Back to ticket queue</Link>
      <header className="page-heading feedback-ticket-heading">
        <div>
          <span className="eyebrow">{ticket.reference_code ?? "Portal ticket"}</span>
          <h1>{ticket.title}</h1>
          <p>{ticket.request_type === "bug_report" ? "Bug report" : "Feature request"} submitted by {submitter?.full_name ?? submitter?.email ?? "Unknown user"}.</p>
        </div>
        <div className="feedback-ticket-heading-badges"><span className={`status-pill status-${ticket.status}`}>{FEEDBACK_STATUS_LABELS[ticket.status as keyof typeof FEEDBACK_STATUS_LABELS] ?? ticket.status}</span><span className={`badge badge-priority-${ticket.priority}`}>{ticket.priority}</span></div>
      </header>

      {messages.success && <div className="notice page-message">{messages.success}</div>}
      {messages.error && <div className="form-error page-message">{messages.error}</div>}

      <div className="feedback-ticket-layout">
        <main className="feedback-ticket-main">
          <section className="panel">
            <div className="panel-header"><div><h2>Request detail</h2><p>The complete description supplied by the requester.</p></div></div>
            <div className="panel-body feedback-ticket-description"><p>{ticket.description}</p></div>
          </section>

          <section className="panel">
            <div className="panel-header"><div><h2>Attachments</h2><p>Screenshots and supporting files included with this ticket.</p></div></div>
            <div className="panel-body feedback-ticket-files">
              {attachments.map((file) => file.signedUrl ? <a href={file.signedUrl} key={file.id} rel="noreferrer" target="_blank"><span aria-hidden="true">▱</span><span><strong>{file.original_name}</strong><small>{file.mime_type ?? "Unknown type"} · {file.file_size ? `${(file.file_size / 1024 / 1024).toFixed(1)} MB` : "Unknown size"}</small></span></a> : <div key={file.id}><strong>{file.original_name}</strong><small>Secure link unavailable</small></div>)}
              {attachments.length === 0 && <p className="empty-copy">No attachments were submitted.</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header"><div><h2>Request context</h2><p>Technical details captured when the ticket was submitted.</p></div></div>
            <dl className="feedback-ticket-context">
              <div><dt>Submitted by</dt><dd>{submitter?.full_name ?? "Unknown"}<small>{submitter?.email}{submitter?.role ? ` · ${roleLabel(submitter.role)}` : ""}</small></dd></div>
              <div><dt>Submitted</dt><dd>{formatDate(ticket.created_at)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(ticket.updated_at)}</dd></div>
              <div><dt>Screen</dt><dd>{ticket.screen_width && ticket.screen_height ? `${ticket.screen_width} × ${ticket.screen_height}` : "Not captured"}</dd></div>
              <div className="feedback-context-wide"><dt>Page</dt><dd>{pageUrl ? <a href={pageUrl} rel="noreferrer" target="_blank">{ticket.page_url}</a> : ticket.page_url ?? "Not captured"}</dd></div>
              <div className="feedback-context-wide"><dt>Browser</dt><dd><code>{ticket.browser_info ?? "Not captured"}</code></dd></div>
              <div className="feedback-context-wide"><dt>Client context</dt><dd><code>{JSON.stringify(ticket.client_context ?? {}, null, 2)}</code></dd></div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel-header"><div><h2>Ticket history</h2><p>Status and response changes are retained for Owner audit.</p></div></div>
            <ol className="feedback-ticket-history">
              {events.map((event) => {
                const actor = profiles.get(event.changed_by);
                return <li key={event.id}><span aria-hidden="true" /><div><strong>{event.event_type.replaceAll("_", " ")}</strong><p>{event.previous_status && event.new_status ? `${FEEDBACK_STATUS_LABELS[event.previous_status as keyof typeof FEEDBACK_STATUS_LABELS] ?? event.previous_status} → ${FEEDBACK_STATUS_LABELS[event.new_status as keyof typeof FEEDBACK_STATUS_LABELS] ?? event.new_status}` : FEEDBACK_STATUS_LABELS[event.new_status as keyof typeof FEEDBACK_STATUS_LABELS] ?? event.new_status}</p>{event.note && <blockquote>{event.note}</blockquote>}<small>{actor?.full_name ?? actor?.email ?? "Portal user"} · {formatDate(event.created_at)}</small></div></li>;
              })}
            </ol>
          </section>
        </main>

        <aside className="feedback-ticket-sidebar">
          <section className="panel feedback-ticket-controls">
            <div className="panel-header"><div><h2>Owner controls</h2><p>{closed ? "Reopen this ticket if work resumes." : "Update the requester-facing status and response."}</p></div></div>
            <div className="panel-body">
              {!closed ? (
                <>
                  <form action={updateFeedbackTicket.bind(null, id)} className="form-stack">
                    <div className="field"><label htmlFor="ticket_detail_status">Status</label><select className="select" defaultValue={ticket.status} id="ticket_detail_status" name="status">{FEEDBACK_STATUSES.filter((status) => status !== "closed").map((status) => <option key={status} value={status}>{FEEDBACK_STATUS_LABELS[status]}</option>)}</select></div>
                    <div className="field"><label htmlFor="ticket_owner_notes">Response visible to requester</label><textarea className="textarea" defaultValue={ticket.owner_notes ?? ""} id="ticket_owner_notes" maxLength={10000} name="owner_notes" rows={8} /></div>
                    <button className="button button-primary" type="submit">Save ticket update</button>
                  </form>
                  <form action={closeFeedbackTicket.bind(null, id)} className="feedback-close-form">
                    <ConfirmedSubmitButton className="button button-danger" description="Closing removes this ticket from the open queue and saves the closure response in its audit history and requester view." destructive label="Close ticket" reasonLabel="Closure response" reasonMaxLength={10000} reasonName="closure_note" reasonPlaceholder="Explain what was completed or why the ticket is being closed" requireReason title="Close this ticket?" />
                  </form>
                </>
              ) : (
                <>
                  <div className="feedback-closed-summary"><strong>Closed {formatDate(ticket.closed_at)}</strong><p>{ticket.owner_notes ?? "No closure response was recorded."}</p></div>
                  <form action={reopenFeedbackTicket.bind(null, id)}><ConfirmedSubmitButton className="button button-secondary" description="The ticket will return to the open queue with Reviewing status." label="Reopen ticket" title="Reopen this ticket?" /></form>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

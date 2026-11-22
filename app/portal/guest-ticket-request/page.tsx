import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { saveGuestTicketRequest } from "./actions";

type GuestTicketQuery = {
  error?: string;
  saved?: string;
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function GuestTicketRequestPage({
  searchParams,
}: {
  searchParams: Promise<GuestTicketQuery>;
}) {
  const profile = await requireProfile(["adjudicator", "advisory_member"]);
  const query = await searchParams;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: staffRows, error: staffError } = await admin
    .from("schedule_slot_staff")
    .select("slot_id")
    .eq("user_id", profile.id)
    .eq("participation_mode", "panel");
  if (staffError) throw new Error(staffError.message);

  const slotIds = [...new Set((staffRows ?? []).map((row) => row.slot_id))];
  const [slotsResult, bookingsResult, requestsResult] = slotIds.length
    ? await Promise.all([
        admin
          .from("schedule_slots")
          .select("id,title,starts_at,ends_at")
          .in("id", slotIds)
          .in("status", ["open", "closed"])
          .gt("starts_at", now)
          .order("starts_at"),
        admin
          .from("schedule_school_bookings")
          .select("slot_id,application_id")
          .in("slot_id", slotIds)
          .eq("approval_status", "confirmed"),
        admin
          .from("adjudication_guest_ticket_requests")
          .select("slot_id,needs_guest_ticket,submitted_at")
          .eq("user_id", profile.id)
          .in("slot_id", slotIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  const loadError =
    slotsResult.error ?? bookingsResult.error ?? requestsResult.error;
  if (loadError) throw new Error(loadError.message);

  const applicationIds = (bookingsResult.data ?? []).map(
    (booking) => booking.application_id,
  );
  const applicationsResult = applicationIds.length
    ? await admin
        .from("applications")
        .select("id,school_name,production_title")
        .in("id", applicationIds)
    : { data: [], error: null };
  if (applicationsResult.error) throw new Error(applicationsResult.error.message);

  const bookingBySlot = new Map(
    (bookingsResult.data ?? []).map((booking) => [booking.slot_id, booking]),
  );
  const applicationById = new Map(
    (applicationsResult.data ?? []).map((application) => [
      application.id,
      application,
    ]),
  );
  const requestBySlot = new Map(
    (requestsResult.data ?? []).map((request) => [request.slot_id, request]),
  );
  const shows = (slotsResult.data ?? []).flatMap((slot) => {
    const booking = bookingBySlot.get(slot.id);
    const application = booking
      ? applicationById.get(booking.application_id)
      : null;
    return application ? [{ ...slot, application }] : [];
  });

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Resources</span>
          <h1>GUEST TICKET REQUEST</h1>
          <p>
            Tell GHSMTA whether you need one guest ticket for each adjudication
            visit on your panel schedule.
          </p>
        </div>
      </header>

      {query.saved ? (
        <div className="notice page-message" role="status">
          {query.saved}
        </div>
      ) : null}
      {query.error ? (
        <div className="form-error page-message" role="alert">
          {query.error}
        </div>
      ) : null}

      <section className="panel guest-ticket-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Your upcoming visits</span>
            <h2>Submit or update a request</h2>
            <p>One response is saved for each show. You can change it later.</p>
          </div>
        </div>
        <div className="panel-body">
          {shows.length ? (
            <form action={saveGuestTicketRequest} className="form-stack">
              <div className="field">
                <label htmlFor="guest_ticket_slot">Adjudication visit</label>
                <select
                  className="select"
                  id="guest_ticket_slot"
                  name="slot_id"
                  required
                >
                  <option value="">Choose a show</option>
                  {shows.map((show) => (
                    <option key={show.id} value={show.id}>
                      {show.application.school_name} — {show.application.production_title ?? "Untitled production"} — {DATE_FORMATTER.format(new Date(show.starts_at))}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="guest-ticket-choice">
                <legend>Do you need one guest ticket?</legend>
                <label className="check-card">
                  <input name="needs_guest_ticket" type="radio" value="yes" required />
                  <span><strong>Yes</strong><small>Add one guest ticket for me.</small></span>
                </label>
                <label className="check-card">
                  <input name="needs_guest_ticket" type="radio" value="no" required />
                  <span><strong>No</strong><small>I only need my panel ticket.</small></span>
                </label>
              </fieldset>

              <button className="button button-gold" type="submit">
                Save guest-ticket request
              </button>
            </form>
          ) : (
            <div className="empty-state">
              <h3>No upcoming panel visits</h3>
              <p>
                A guest-ticket request will become available after you join or
                are assigned to an adjudication panel.
              </p>
            </div>
          )}
        </div>
      </section>

      {shows.length ? (
        <section className="panel">
          <div className="panel-header"><div><h2>Saved responses</h2><p>Your current response for every upcoming show.</p></div></div>
          <div className="panel-body guest-ticket-response-list">
            {shows.map((show) => {
              const request = requestBySlot.get(show.id);
              return (
                <article className="guest-ticket-response" key={show.id}>
                  <div>
                    <strong>{show.application.school_name}</strong>
                    <span>{show.application.production_title ?? "Untitled production"}</span>
                    <small>{DATE_FORMATTER.format(new Date(show.starts_at))}</small>
                  </div>
                  <span className={`badge ${request ? "badge-complete" : "badge-draft"}`}>
                    {request
                      ? request.needs_guest_ticket
                        ? "1 guest ticket"
                        : "No guest ticket"
                      : "Response needed"}
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

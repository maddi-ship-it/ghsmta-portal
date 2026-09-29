import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabel, statusLabel } from "@/lib/format";
import type { Application } from "@/lib/types";

type DashboardScheduleSlot = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
};

type DashboardBooking = {
  slot_id: string;
  application_id: string;
  applications:
    | { id: string; school_name: string; production_title: string | null }
    | Array<{ id: string; school_name: string; production_title: string | null }>
    | null;
};

function formatAdjudicationDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatAdjudicationTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))} ET`;
}

export default async function PortalDashboard() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("id,cycle_id,school_name,production_title,status,updated_at,award_cycles!inner(is_active,status)")
    .eq("is_archived", false)
    .eq("award_cycles.is_active", true)
    .neq("award_cycles.status", "archived")
    .order("updated_at", { ascending: false });
  const applications = (data ?? []) as unknown as Application[];

  let adjudicationVisits: Array<{
    slot: DashboardScheduleSlot;
    application: { id: string; school_name: string; production_title: string | null } | null;
  }> = [];

  if (["adjudicator", "advisory_member"].includes(profile.role)) {
    const [staffResult, assignmentResult] = await Promise.all([
      supabase
        .from("schedule_slot_staff")
        .select("slot_id")
        .eq("user_id", profile.id),
      profile.role === "adjudicator"
        ? supabase
            .from("adjudicator_assignments")
            .select("schedule_slot_id")
            .eq("adjudicator_user_id", profile.id)
            .is("removed_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (staffResult.error) throw new Error(staffResult.error.message);
    if (assignmentResult.error) throw new Error(assignmentResult.error.message);

    const slotIds = Array.from(new Set([
      ...(staffResult.data ?? []).map((row) => row.slot_id),
      ...(assignmentResult.data ?? [])
        .map((row) => row.schedule_slot_id)
        .filter((value): value is string => Boolean(value)),
    ]));

    if (slotIds.length > 0) {
      const [slotResult, bookingResult] = await Promise.all([
        supabase
          .from("schedule_slots")
          .select("id,title,starts_at,ends_at,location")
          .in("id", slotIds)
          .order("starts_at"),
        supabase
          .from("schedule_school_bookings")
          .select("slot_id,application_id,applications(id,school_name,production_title)")
          .in("slot_id", slotIds),
      ]);

      if (slotResult.error) throw new Error(slotResult.error.message);
      if (bookingResult.error) throw new Error(bookingResult.error.message);

      const bookingBySlot = new Map(
        ((bookingResult.data ?? []) as DashboardBooking[]).map((booking) => {
          const application = Array.isArray(booking.applications)
            ? booking.applications[0] ?? null
            : booking.applications;
          return [booking.slot_id, application] as const;
        }),
      );

      adjudicationVisits = ((slotResult.data ?? []) as DashboardScheduleSlot[]).map((slot) => ({
        slot,
        application: bookingBySlot.get(slot.id) ?? null,
      }));
    }
  }

  const counts = {
    total: applications.length,
    draft: applications.filter((item) => item.status === "draft").length,
    submitted: applications.filter((item) => item.status === "submitted").length,
    review: applications.filter((item) => item.status === "under_review").length,
  };

  const intro = profile.role === "applicant"
    ? "Manage your school’s application and submission status."
    : profile.role === "adjudicator"
      ? "Review the applications currently assigned to you."
      : profile.role === "program_manager"
        ? "Coordinate submitted applications and scholarship applicant conversations."
      : `View the current awards cycle as an ${roleLabel(profile.role).toLowerCase()}.`;

  return (
    <>
      <div className="page-heading">
        <div><h1>Welcome, {profile.full_name?.split(" ")[0] ?? "there"}.</h1><p>{intro}</p></div>
        <Link className="button button-dark" href="/portal/admin/applications">View applications</Link>
      </div>

      <section className="metric-grid" aria-label="Application overview">
        <article className="metric-card"><span className="metric-label">Accessible</span><strong className="metric-value">{counts.total}</strong></article>
        <article className="metric-card"><span className="metric-label">Draft</span><strong className="metric-value">{counts.draft}</strong></article>
        <article className="metric-card"><span className="metric-label">Submitted</span><strong className="metric-value">{counts.submitted}</strong></article>
        <article className="metric-card"><span className="metric-label">In review</span><strong className="metric-value">{counts.review}</strong></article>
      </section>

      {["adjudicator", "advisory_member"].includes(profile.role) && (
        <section className="panel dashboard-adjudication-dates">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Your schedule</span>
              <h2>Adjudication dates</h2>
              <p>Your booked school visits and panel assignments.</p>
            </div>
            <Link href="/portal/schedule">View schedule</Link>
          </div>
          {adjudicationVisits.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <h3>No adjudication dates assigned yet.</h3>
              <p>Your dates will appear here when you join or are assigned to a booked timeslot.</p>
            </div>
          ) : (
            <div className="dashboard-adjudication-date-grid">
              {adjudicationVisits.map(({ slot, application }) => (
                <article className="dashboard-adjudication-date-card" key={slot.id}>
                  <time dateTime={slot.starts_at}>{formatAdjudicationDate(slot.starts_at)}</time>
                  <strong>{application?.school_name ?? slot.title}</strong>
                  <span>{application?.production_title ?? "School assignment pending"}</span>
                  <small>{formatAdjudicationTime(slot.starts_at, slot.ends_at)}{slot.location ? ` · ${slot.location}` : ""}</small>
                  {application && <Link href={`/portal/adjudication/${application.id}`}>Open adjudication</Link>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-header"><h2>Recently updated</h2><Link href="/portal/admin/applications">See all</Link></div>
        {applications.length === 0 ? (
          <div className="empty-state">
            <h3>No applications are available yet.</h3>
            <p>{profile.role === "applicant" ? "Once an owner opens an awards cycle, your application can be created here." : profile.role === "program_manager" ? "Submitted applications will appear here when they become available." : "Create or activate an awards cycle, then applicant records will appear here according to your role."}</p>
          </div>
        ) : (
          <div className="table-wrap"><table className="data-table"><thead><tr><th>School</th><th>Production</th><th>Status</th><th>Updated</th></tr></thead><tbody>
            {applications.slice(0, 8).map((application) => (
              <tr key={application.id}>
                <td><Link href={`/portal/applications/${application.id}`}>{application.school_name}</Link></td>
                <td>{application.production_title ?? "Not entered"}</td>
                <td><span className={`badge badge-${application.status}`}>{statusLabel(application.status)}</span></td>
                <td>{new Date(application.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}

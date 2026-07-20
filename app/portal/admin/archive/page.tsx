import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const EASTERN_TIME_ZONE = "America/New_York";

type ArchivedCycle = {
  id: string;
  name: string;
  season_year: string;
  program_type: string;
  status: string;
  updated_at: string;
};

type ArchivedApplication = {
  id: string;
  cycle_id: string;
  school_name: string;
  production_title: string | null;
  status: string;
  archived_at: string | null;
  archive_reason: string | null;
  updated_at: string;
};

type ArchivedAssignment = {
  id: string;
  application_id: string;
  adjudicator_user_id: string;
  status: string;
  due_at: string | null;
  assigned_at: string;
};

type ArchivedSlot = {
  id: string;
  cycle_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: string;
};

type ArchivedBooking = {
  slot_id: string;
  application_id: string;
};

type ArchivedChannel = {
  id: string;
  application_id: string | null;
  channel_type: string;
  name: string;
  active: boolean;
};

type ArchivedFile = {
  id: string;
  application_id: string | null;
  archived_at: string | null;
};

type ArchivedAppeal = {
  id: string;
  application_id: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type FormRow = {
  id: string;
  cycle_id: string;
};

type RubricRow = {
  id: string;
  cycle_id: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function countByApplication<T extends { application_id: string | null }>(
  rows: T[],
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.application_id) continue;
    counts.set(row.application_id, (counts.get(row.application_id) ?? 0) + 1);
  }
  return counts;
}

export default async function OwnerArchivePage() {
  await requireProfile(["owner"]);
  const supabase = await createClient();

  const [{ data: cycleData, error: cycleError }, { data: applicationData, error: applicationError }] =
    await Promise.all([
      supabase
        .from("award_cycles")
        .select("id,name,season_year,program_type,status,updated_at")
        .eq("status", "archived")
        .order("season_year", { ascending: false })
        .order("name"),
      supabase
        .from("applications")
        .select(
          "id,cycle_id,school_name,production_title,status,archived_at,archive_reason,updated_at",
        )
        .eq("is_archived", true)
        .order("archived_at", { ascending: false })
        .order("school_name"),
    ]);

  if (cycleError) throw new Error(cycleError.message);
  if (applicationError) throw new Error(applicationError.message);

  const cycles = (cycleData ?? []) as ArchivedCycle[];
  const applications = (applicationData ?? []) as ArchivedApplication[];
  const cycleIds = cycles.map((cycle) => cycle.id);
  const applicationIds = applications.map((application) => application.id);

  const [
    assignmentResult,
    slotResult,
    bookingResult,
    channelResult,
    fileResult,
    appealResult,
    formResult,
    rubricResult,
  ] = await Promise.all([
    applicationIds.length
      ? supabase
          .from("adjudicator_assignments")
          .select("id,application_id,adjudicator_user_id,status,due_at,assigned_at")
          .in("application_id", applicationIds)
          .order("assigned_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    cycleIds.length
      ? supabase
          .from("schedule_slots")
          .select("id,cycle_id,title,starts_at,ends_at,location,status")
          .in("cycle_id", cycleIds)
          .order("starts_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("schedule_school_bookings")
      .select("slot_id,application_id")
      .order("booked_at", { ascending: false }),
    applicationIds.length
      ? supabase
          .from("chat_channels")
          .select("id,application_id,channel_type,name,active")
          .in("application_id", applicationIds)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length
      ? supabase
          .from("portal_files")
          .select("id,application_id,archived_at")
          .in("application_id", applicationIds)
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length
      ? supabase
          .from("appeals")
          .select("id,application_id")
          .in("application_id", applicationIds)
      : Promise.resolve({ data: [], error: null }),
    cycleIds.length
      ? supabase
          .from("application_form_versions")
          .select("id,cycle_id")
          .in("cycle_id", cycleIds)
      : Promise.resolve({ data: [], error: null }),
    cycleIds.length
      ? supabase
          .from("scoring_rubrics")
          .select("id,cycle_id")
          .in("cycle_id", cycleIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const result of [
    assignmentResult,
    slotResult,
    bookingResult,
    channelResult,
    fileResult,
    appealResult,
    formResult,
    rubricResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const assignments = (assignmentResult.data ?? []) as ArchivedAssignment[];
  const slots = (slotResult.data ?? []) as ArchivedSlot[];
  const archivedSlotIds = new Set(slots.map((slot) => slot.id));
  const bookings = ((bookingResult.data ?? []) as ArchivedBooking[]).filter(
    (booking) => archivedSlotIds.has(booking.slot_id),
  );
  const channels = (channelResult.data ?? []) as ArchivedChannel[];
  const files = (fileResult.data ?? []) as ArchivedFile[];
  const appeals = (appealResult.data ?? []) as ArchivedAppeal[];
  const forms = (formResult.data ?? []) as FormRow[];
  const rubrics = (rubricResult.data ?? []) as RubricRow[];

  const adjudicatorIds = [
    ...new Set(assignments.map((assignment) => assignment.adjudicator_user_id)),
  ];
  const profileResult = adjudicatorIds.length
    ? await supabase
        .from("profiles")
        .select("id,full_name,email")
        .in("id", adjudicatorIds)
    : { data: [], error: null };
  if (profileResult.error) throw new Error(profileResult.error.message);
  const profiles = (profileResult.data ?? []) as ProfileRow[];

  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const applicationMap = new Map(
    applications.map((application) => [application.id, application]),
  );
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const bookingMap = new Map(bookings.map((booking) => [booking.slot_id, booking]));
  const assignmentCounts = countByApplication(assignments);
  const channelCounts = countByApplication(channels);
  const fileCounts = countByApplication(files);
  const appealCounts = countByApplication(appeals);
  const schoolStaffChannelMap = new Map(
    channels
      .filter((channel) => channel.channel_type === "school")
      .map((channel) => [channel.application_id, channel]),
  );
  const ownerDmMap = new Map(
    channels
      .filter((channel) => channel.channel_type === "school_dm")
      .map((channel) => [channel.application_id, channel]),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Owner administration</span>
          <h1>View archive</h1>
          <p>
            Historical seasons are kept out of operational workspaces while
            remaining available here for records, audits, and reference.
          </p>
        </div>
        <Link className="button button-secondary" href="/portal">
          Return to active portal
        </Link>
      </div>

      <section className="metric-grid" aria-label="Archive overview">
        <article className="metric-card">
          <span className="metric-label">Archived programs</span>
          <strong className="metric-value">{cycles.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Applications</span>
          <strong className="metric-value">{applications.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Schedule slots</span>
          <strong className="metric-value">{slots.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Former assignments</span>
          <strong className="metric-value">{assignments.length}</strong>
        </article>
      </section>

      <nav className="archive-jump-nav" aria-label="Archive sections">
        <a href="#program-archive">Programs</a>
        <a href="#application-archive">Applications</a>
        <a href="#schedule-archive">Scheduling</a>
        <a href="#assignment-archive">Assignments</a>
      </nav>

      <section className="panel" id="program-archive">
        <div className="panel-header">
          <div>
            <h2>Archived programs</h2>
            <p>Forms and rubrics are preserved with their original program.</p>
          </div>
        </div>
        {cycles.length === 0 ? (
          <div className="empty-state"><h3>No archived programs.</h3></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Season</th><th>Program</th><th>Type</th><th>Forms</th><th>Rubrics</th><th>Archived</th></tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => (
                  <tr key={cycle.id}>
                    <td>{cycle.season_year}</td>
                    <td><strong>{cycle.name}</strong></td>
                    <td>{cycle.program_type.replaceAll("_", " ")}</td>
                    <td>{forms.filter((form) => form.cycle_id === cycle.id).length}</td>
                    <td>{rubrics.filter((rubric) => rubric.cycle_id === cycle.id).length}</td>
                    <td>{formatDate(cycle.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" id="application-archive">
        <div className="panel-header">
          <div>
            <h2>Archived applications</h2>
            <p>Open a historical record or its preserved conversations.</p>
          </div>
        </div>
        {applications.length === 0 ? (
          <div className="empty-state"><h3>No archived applications.</h3></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Program</th><th>School</th><th>Production</th><th>Archived</th><th>Related records</th><th /></tr>
              </thead>
              <tbody>
                {applications.map((application) => {
                  const cycle = cycleMap.get(application.cycle_id);
                  const staffChannel = schoolStaffChannelMap.get(application.id);
                  const ownerDm = ownerDmMap.get(application.id);
                  return (
                    <tr key={application.id}>
                      <td><strong>{cycle?.season_year ?? "Historical"}</strong><small>{cycle?.name ?? "Archived program"}</small></td>
                      <td><strong>{application.school_name}</strong><small>{application.archive_reason ?? "No archive note"}</small></td>
                      <td>{application.production_title ?? "—"}</td>
                      <td>{formatDate(application.archived_at ?? application.updated_at)}</td>
                      <td>
                        <small>{assignmentCounts.get(application.id) ?? 0} assignments · {fileCounts.get(application.id) ?? 0} files · {appealCounts.get(application.id) ?? 0} appeals · {channelCounts.get(application.id) ?? 0} chats</small>
                      </td>
                      <td>
                        <div className="application-row-actions">
                          <Link href={`/portal/applications/${application.id}`}>Open record</Link>
                          {ownerDm && <Link href={`/portal/chat?archive=1&channel=${ownerDm.id}`}>School Messaging</Link>}
                          {staffChannel && <Link href={`/portal/chat?archive=1&channel=${staffChannel.id}`}>Staff chat</Link>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" id="schedule-archive">
        <div className="panel-header">
          <div>
            <h2>Archived scheduling</h2>
            <p>Closed historical slots and their original school reservations.</p>
          </div>
        </div>
        {slots.length === 0 ? (
          <div className="empty-state"><h3>No archived schedule slots.</h3></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Date &amp; time</th><th>Program</th><th>Slot</th><th>School</th><th>Location</th><th>Status</th></tr></thead>
              <tbody>
                {slots.map((slot) => {
                  const booking = bookingMap.get(slot.id);
                  const application = booking ? applicationMap.get(booking.application_id) : null;
                  const cycle = cycleMap.get(slot.cycle_id);
                  return (
                    <tr key={slot.id}>
                      <td>{formatDateTime(slot.starts_at)}</td>
                      <td>{cycle?.season_year ?? "Historical"}<small>{cycle?.name}</small></td>
                      <td><strong>{slot.title}</strong></td>
                      <td>{application?.school_name ?? "Unbooked"}<small>{application?.production_title}</small></td>
                      <td>{slot.location ?? "—"}</td>
                      <td><span className="badge">{slot.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" id="assignment-archive">
        <div className="panel-header">
          <div>
            <h2>Former adjudication assignments</h2>
            <p>Assignments remain attached to their archived applications and scorecards.</p>
          </div>
        </div>
        {assignments.length === 0 ? (
          <div className="empty-state"><h3>No former assignments.</h3></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>School</th><th>Production</th><th>Adjudicator</th><th>Status</th><th>Due</th><th>Assigned</th></tr></thead>
              <tbody>
                {assignments.map((assignment) => {
                  const application = applicationMap.get(assignment.application_id);
                  const adjudicator = profileMap.get(assignment.adjudicator_user_id);
                  return (
                    <tr key={assignment.id}>
                      <td><strong>{application?.school_name ?? "Archived application"}</strong></td>
                      <td>{application?.production_title ?? "—"}</td>
                      <td>{adjudicator?.full_name ?? adjudicator?.email ?? "Former user"}</td>
                      <td><span className="badge">{assignment.status.replaceAll("_", " ")}</span></td>
                      <td>{formatDate(assignment.due_at)}</td>
                      <td>{formatDate(assignment.assigned_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

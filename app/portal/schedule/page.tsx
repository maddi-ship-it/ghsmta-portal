import { requireProfile } from "@/lib/auth";
import { roleLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Application, AwardCycle, Profile } from "@/lib/types";

import {
  bookOwnScheduleSlot,
  createScheduleSlot,
  joinScheduleSlot,
  ownerAddStaff,
  ownerAssignSchool,
  removeScheduleSchoolBooking,
  removeScheduleStaff,
  updateScheduleSlot,
} from "./actions";

type ScheduleSlotStatus = "draft" | "open" | "closed" | "cancelled";

type ScheduleSlot = {
  id: string;
  cycle_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  school_instructions: string | null;
  status: ScheduleSlotStatus;
  created_at: string;
  updated_at: string;
};

type SlotAvailability = {
  slot_id: string;
  is_booked: boolean;
  is_mine: boolean;
  my_application_id: string | null;
};

type StaffBooking = {
  booking_id: string;
  slot_id: string;
  application_id: string;
  cycle_id: string;
  school_name: string;
  production_title: string | null;
  application_status: string;
  booked_at: string;
};

type StaffEnrollment = {
  enrollment_id: string;
  slot_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: AppRole;
  joined_at: string;
};

type ScheduleSearchParams = {
  success?: string;
  error?: string;
};

const EASTERN_TIME_ZONE = "America/New_York";

function formatSlotDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatSlotTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

function localInputValue(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function statusLabel(status: ScheduleSlotStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function personName(person: StaffEnrollment) {
  return person.full_name ?? person.email ?? "Portal user";
}

function staffRoleLabel(role: AppRole) {
  return role === "advisory_member" ? "Advisory" : roleLabel(role);
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<ScheduleSearchParams>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const supabase = await createClient();

  const [
    { data: slotData, error: slotError },
    { data: cycleData },
    { data: serverTimeData },
  ] = await Promise.all([
    supabase
      .from("schedule_slots")
      .select(
        "id,cycle_id,title,starts_at,ends_at,location,school_instructions,status,created_at,updated_at",
      )
      .order("starts_at", { ascending: true }),
    supabase
      .from("award_cycles")
      .select(
        "id,cycle_key,name,season_year,program_type,description,status,opens_at,closes_at,is_active,cloned_from_cycle_id,created_at,updated_at",
      )
      .order("season_year", { ascending: false })
      .order("name"),
    supabase.rpc("get_schedule_server_time"),
  ]);

  const slots = (slotData ?? []) as ScheduleSlot[];
  const cycles = (cycleData ?? []) as AwardCycle[];
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const serverTime = new Date(String(serverTimeData)).getTime();

  let applicantApplications: Application[] = [];
  let availability: SlotAvailability[] = [];
  let staffBookings: StaffBooking[] = [];
  let staffDirectory: StaffEnrollment[] = [];
  let ownerApplications: Application[] = [];
  let ownerStaff: Profile[] = [];

  if (profile.role === "applicant") {
    const [{ data: applicationData }, { data: availabilityData }] =
      await Promise.all([
        supabase
          .from("applications")
          .select(
            "id,cycle_id,form_version_id,applicant_user_id,school_name,production_title,status,submitted_at,form_version,form_data,owner_notes,current_stage_id,external_applicant_name,external_applicant_email,source_system,source_record_id,source_stage,is_archived,archived_payload,cloned_from_application_id,created_at,updated_at",
          )
          .eq("applicant_user_id", profile.id)
          .eq("is_archived", false)
          .order("updated_at", { ascending: false }),
        supabase.rpc("get_schedule_slot_availability"),
      ]);

    applicantApplications = (applicationData ?? []) as Application[];
    availability = (availabilityData ?? []) as SlotAvailability[];
  } else {
    const [{ data: bookingData }, { data: directoryData }] = await Promise.all([
      supabase.rpc("get_schedule_bookings_for_staff"),
      supabase.rpc("get_schedule_staff_directory"),
    ]);

    staffBookings = (bookingData ?? []) as StaffBooking[];
    staffDirectory = (directoryData ?? []) as StaffEnrollment[];

    if (profile.role === "owner") {
      const [{ data: applicationData }, { data: profileData }] =
        await Promise.all([
          supabase
            .from("applications")
            .select(
              "id,cycle_id,form_version_id,applicant_user_id,school_name,production_title,status,submitted_at,form_version,form_data,owner_notes,current_stage_id,external_applicant_name,external_applicant_email,source_system,source_record_id,source_stage,is_archived,archived_payload,cloned_from_application_id,created_at,updated_at",
            )
            .eq("is_archived", false)
            .order("school_name"),
          supabase
            .from("profiles")
            .select("id,email,full_name,role,active")
            .in("role", ["adjudicator", "advisory_member"])
            .eq("active", true)
            .order("full_name"),
        ]);

      ownerApplications = (applicationData ?? []) as Application[];
      ownerStaff = (profileData ?? []) as Profile[];
    }
  }

  const availabilityMap = new Map(
    availability.map((item) => [item.slot_id, item]),
  );
  const bookingMap = new Map(
    staffBookings.map((booking) => [booking.slot_id, booking]),
  );
  const staffBySlot = new Map<string, StaffEnrollment[]>();

  for (const enrollment of staffDirectory) {
    const existing = staffBySlot.get(enrollment.slot_id) ?? [];
    existing.push(enrollment);
    staffBySlot.set(enrollment.slot_id, existing);
  }

  const applicantBooking = availability.find((item) => item.is_mine);
  const bookedSlot = applicantBooking
    ? slots.find((slot) => slot.id === applicantBooking.slot_id)
    : null;
  const bookedApplication = applicantBooking?.my_application_id
    ? applicantApplications.find(
        (application) => application.id === applicantBooking.my_application_id,
      )
    : null;

  return (
    <>
      <div className="page-heading schedule-page-heading">
        <div>
          <h1>Scheduling</h1>
          <p>
            {profile.role === "applicant"
              ? "Choose one available GHSMTA schedule slot for your school."
              : profile.role === "owner"
                ? "Build schedule slots, manage school reservations, and coordinate adjudicators and advisory members."
                : "Join the schedule slots you can attend and see the other participating reviewers."}
          </p>
        </div>
      </div>

      {params.success && <div className="success-banner">{params.success}</div>}
      {params.error && <div className="form-error page-message">{params.error}</div>}

      {slotError && (
        <div className="form-error page-message">
          Schedule slots could not be loaded: {slotError.message}
        </div>
      )}

      {profile.role === "owner" && (
        <section className="panel schedule-create-panel">
          <div className="panel-header">
            <div>
              <h2>Create schedule slot</h2>
              <p>Times are entered and displayed in Eastern Time.</p>
            </div>
          </div>
          <div className="panel-body">
            <form action={createScheduleSlot} className="schedule-create-form">
              <div className="field">
                <label htmlFor="cycle_id">Program</label>
                <select className="select" id="cycle_id" name="cycle_id" required>
                  <option value="">Choose a program</option>
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.season_year} — {cycle.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="title">Slot title</label>
                <input
                  className="input"
                  id="title"
                  name="title"
                  placeholder="Adjudication visit"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="starts_at">Starts</label>
                <input className="input" id="starts_at" name="starts_at" type="datetime-local" required />
              </div>
              <div className="field">
                <label htmlFor="ends_at">Ends</label>
                <input className="input" id="ends_at" name="ends_at" type="datetime-local" required />
              </div>
              <div className="field">
                <label htmlFor="location">Location</label>
                <input className="input" id="location" name="location" />
              </div>
              <div className="field">
                <label htmlFor="status">Status</label>
                <select className="select" defaultValue="open" id="status" name="status">
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="field schedule-create-instructions">
                <label htmlFor="school_instructions">School instructions</label>
                <textarea
                  className="textarea"
                  id="school_instructions"
                  name="school_instructions"
                  placeholder="Arrival, parking, check-in, or other instructions visible to the school."
                />
              </div>
              <button className="button button-dark schedule-create-submit" type="submit">
                Create slot
              </button>
            </form>
          </div>
        </section>
      )}

      {profile.role === "applicant" && bookedSlot && bookedApplication ? (
        <section className="panel schedule-locked-booking">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Registered</span>
              <h2>{bookedSlot.title}</h2>
              <p>
                {bookedApplication.school_name}
                {bookedApplication.production_title
                  ? ` — ${bookedApplication.production_title}`
                  : ""}
              </p>
            </div>
            <span className="badge badge-complete">Locked</span>
          </div>
          <div className="panel-body schedule-booking-summary">
            <strong>{formatSlotDate(bookedSlot.starts_at)}</strong>
            <span>{formatSlotTime(bookedSlot.starts_at, bookedSlot.ends_at)} ET</span>
            {bookedSlot.location && <span>{bookedSlot.location}</span>}
            {bookedSlot.school_instructions && <p>{bookedSlot.school_instructions}</p>}
            <div className="info-banner">
              Your school cannot remove or change this reservation. Contact GHSMTA staff if a change is required.
            </div>
          </div>
        </section>
      ) : (
        <section className="schedule-slot-grid">
          {slots.length === 0 ? (
            <div className="panel empty-state schedule-empty-state">
              <h3>No schedule slots are configured.</h3>
              <p>Slots will appear here when an owner creates them.</p>
            </div>
          ) : (
            slots.map((slot) => {
              const cycle = cycleMap.get(slot.cycle_id);
              const slotAvailability = availabilityMap.get(slot.id);
              const booking = bookingMap.get(slot.id);
              const participants = staffBySlot.get(slot.id) ?? [];
              const currentEnrollment = participants.find(
                (participant) => participant.user_id === profile.id,
              );
              const slotApplications =
                profile.role === "applicant"
                  ? applicantApplications.filter(
                      (application) => application.cycle_id === slot.cycle_id,
                    )
                  : [];
              const ownerSlotApplications = ownerApplications.filter(
                (application) => application.cycle_id === slot.cycle_id,
              );
              const ownerAvailableStaff = ownerStaff.filter(
                (person) =>
                  !participants.some(
                    (participant) => participant.user_id === person.id,
                  ),
              );
              const isPast = new Date(slot.starts_at).getTime() <= serverTime;
              const canSelfJoin =
                slot.status === "open" &&
                !isPast &&
                !currentEnrollment;
              const canSchoolBook =
                slot.status === "open" &&
                !isPast &&
                !slotAvailability?.is_booked &&
                slotApplications.length > 0;

              if (profile.role === "applicant" && slot.status === "draft") {
                return null;
              }

              return (
                <article className="panel schedule-slot-card" key={slot.id}>
                  <div className="schedule-slot-accent" />
                  <div className="panel-header schedule-slot-header">
                    <div>
                      <span className="eyebrow">
                        {cycle ? `${cycle.season_year} · ${cycle.name}` : "Program"}
                      </span>
                      <h2>{slot.title}</h2>
                      <p>{formatSlotDate(slot.starts_at)}</p>
                    </div>
                    <span className={`badge schedule-status schedule-status-${slot.status}`}>
                      {statusLabel(slot.status)}
                    </span>
                  </div>

                  <div className="panel-body schedule-slot-body">
                    <div className="schedule-slot-meta">
                      <span><strong>Time</strong>{formatSlotTime(slot.starts_at, slot.ends_at)} ET</span>
                      <span><strong>Location</strong>{slot.location || "To be announced"}</span>
                    </div>

                    {slot.school_instructions && (
                      <p className="schedule-school-instructions">{slot.school_instructions}</p>
                    )}

                    {profile.role === "applicant" ? (
                      <div className="schedule-school-action">
                        {slotAvailability?.is_booked ? (
                          <button className="button button-secondary" disabled type="button">
                            Unavailable
                          </button>
                        ) : canSchoolBook ? (
                          <form action={bookOwnScheduleSlot} className="form-stack">
                            <input name="slot_id" type="hidden" value={slot.id} />
                            {slotApplications.length === 1 ? (
                              <input
                                name="application_id"
                                type="hidden"
                                value={slotApplications[0].id}
                              />
                            ) : (
                              <div className="field">
                                <label htmlFor={`application_${slot.id}`}>Application</label>
                                <select
                                  className="select"
                                  id={`application_${slot.id}`}
                                  name="application_id"
                                  required
                                >
                                  <option value="">Choose your application</option>
                                  {slotApplications.map((application) => (
                                    <option key={application.id} value={application.id}>
                                      {application.school_name}
                                      {application.production_title
                                        ? ` — ${application.production_title}`
                                        : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <button className="button button-dark" type="submit">
                              Register school for this slot
                            </button>
                          </form>
                        ) : (
                          <button className="button button-secondary" disabled type="button">
                            {isPast ? "Slot has passed" : "Not available for your application"}
                          </button>
                        )}
                        <small>
                          Schools can choose one slot and cannot remove themselves after registering.
                        </small>
                      </div>
                    ) : (
                      <>
                        <div className="schedule-school-card">
                          <span className="eyebrow">School</span>
                          {booking ? (
                            <>
                              <strong>{booking.school_name}</strong>
                              <span>{booking.production_title || "Production title not entered"}</span>
                            </>
                          ) : (
                            <span>No school has selected this slot.</span>
                          )}
                        </div>

                        <div className="schedule-participants">
                          <div className="schedule-section-heading">
                            <div>
                              <span className="eyebrow">Review team</span>
                              <h3>Adjudicators &amp; advisory members</h3>
                            </div>
                            <span className="badge">{participants.length}</span>
                          </div>

                          {participants.length === 0 ? (
                            <p className="muted-copy">No reviewers have joined this slot.</p>
                          ) : (
                            <div className="schedule-participant-list">
                              {participants.map((participant) => (
                                <div className="schedule-participant" key={participant.enrollment_id}>
                                  <span className="user-avatar">
                                    {personName(participant).slice(0, 1).toUpperCase()}
                                  </span>
                                  <span>
                                    <strong>{personName(participant)}</strong>
                                    <small>{staffRoleLabel(participant.role)}</small>
                                  </span>
                                  {profile.role === "owner" && (
                                    <form action={removeScheduleStaff.bind(null, participant.enrollment_id)}>
                                      <button className="text-button danger-text" type="submit">
                                        Remove
                                      </button>
                                    </form>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {(profile.role === "adjudicator" ||
                          profile.role === "advisory_member") && (
                          <div className="schedule-join-action">
                            {currentEnrollment ? (
                              <>
                                <button className="button button-secondary" disabled type="button">
                                  Joined as {staffRoleLabel(currentEnrollment.role)}
                                </button>
                                <small>Only an owner can remove you from this slot.</small>
                              </>
                            ) : (
                              <form action={joinScheduleSlot}>
                                <input name="slot_id" type="hidden" value={slot.id} />
                                <button
                                  className="button button-dark"
                                  disabled={!canSelfJoin}
                                  type="submit"
                                >
                                  {isPast ? "Slot has passed" : "Join this slot"}
                                </button>
                              </form>
                            )}
                          </div>
                        )}

                        {profile.role === "owner" && (
                          <div className="schedule-owner-controls">
                            <details>
                              <summary>Edit slot</summary>
                              <form
                                action={updateScheduleSlot.bind(null, slot.id)}
                                className="form-stack compact-form"
                              >
                                <div className="field">
                                  <label>Title</label>
                                  <input className="input" defaultValue={slot.title} name="title" required />
                                </div>
                                <div className="two-column-grid">
                                  <div className="field">
                                    <label>Starts</label>
                                    <input
                                      className="input"
                                      defaultValue={localInputValue(slot.starts_at)}
                                      name="starts_at"
                                      type="datetime-local"
                                      required
                                    />
                                  </div>
                                  <div className="field">
                                    <label>Ends</label>
                                    <input
                                      className="input"
                                      defaultValue={localInputValue(slot.ends_at)}
                                      name="ends_at"
                                      type="datetime-local"
                                      required
                                    />
                                  </div>
                                </div>
                                <div className="field">
                                  <label>Location</label>
                                  <input className="input" defaultValue={slot.location ?? ""} name="location" />
                                </div>
                                <div className="field">
                                  <label>School instructions</label>
                                  <textarea
                                    className="textarea"
                                    defaultValue={slot.school_instructions ?? ""}
                                    name="school_instructions"
                                  />
                                </div>
                                <div className="field">
                                  <label>Status</label>
                                  <select className="select" defaultValue={slot.status} name="status">
                                    <option value="draft">Draft</option>
                                    <option value="open">Open</option>
                                    <option value="closed">Closed</option>
                                    <option value="cancelled">Cancelled</option>
                                  </select>
                                </div>
                                <button className="button button-dark button-compact" type="submit">
                                  Save slot
                                </button>
                              </form>
                            </details>

                            <div className="schedule-owner-action-grid">
                              <div className="schedule-owner-action">
                                <h4>School reservation</h4>
                                {booking ? (
                                  <form action={removeScheduleSchoolBooking.bind(null, booking.booking_id)}>
                                    <button className="button button-secondary button-compact" type="submit">
                                      Remove school
                                    </button>
                                  </form>
                                ) : (
                                  <form action={ownerAssignSchool.bind(null, slot.id)} className="form-stack compact-form">
                                    <div className="field">
                                      <label htmlFor={`owner_application_${slot.id}`}>School application</label>
                                      <select
                                        className="select"
                                        id={`owner_application_${slot.id}`}
                                        name="application_id"
                                        required
                                      >
                                        <option value="">Choose school</option>
                                        {ownerSlotApplications.map((application) => (
                                          <option key={application.id} value={application.id}>
                                            {application.school_name}
                                            {application.production_title
                                              ? ` — ${application.production_title}`
                                              : ""}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <button className="button button-secondary button-compact" type="submit">
                                      Assign school
                                    </button>
                                  </form>
                                )}
                              </div>

                              <div className="schedule-owner-action">
                                <h4>Add reviewer</h4>
                                <form action={ownerAddStaff.bind(null, slot.id)} className="form-stack compact-form">
                                  <div className="field">
                                    <label htmlFor={`owner_staff_${slot.id}`}>Portal user</label>
                                    <select
                                      className="select"
                                      id={`owner_staff_${slot.id}`}
                                      name="user_id"
                                      required
                                    >
                                      <option value="">Choose person</option>
                                      {ownerAvailableStaff.map((person) => (
                                        <option key={person.id} value={person.id}>
                                          {person.full_name ?? person.email} — {roleLabel(person.role)}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <button className="button button-secondary button-compact" type="submit">
                                    Add reviewer
                                  </button>
                                </form>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>
      )}
    </>
  );
}

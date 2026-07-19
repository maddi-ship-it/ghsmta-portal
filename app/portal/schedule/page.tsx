import Link from "next/link";

import { ApplicantScheduleBoard } from "@/components/applicant-schedule-board";
import { ScheduleOwnerTools } from "@/components/schedule-owner-tools";
import { requireProfile } from "@/lib/auth";
import { roleLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Application, AwardCycle, Profile } from "@/lib/types";

import {
  acceptScheduleWaitlistOffer,
  bookOwnScheduleSlot,
  createScheduleSlot,
  declineScheduleWaitlistOffer,
  joinScheduleDateWaitlist,
  joinScheduleSlot,
  ownerAddStaff,
  ownerAssignSchool,
  ownerOfferWaitlistSlot,
  leaveScheduleDateWaitlist,
  removeScheduleSchoolBooking,
  removeScheduleStaff,
  updateOwnScheduleSchoolDetails,
  ownerUpdateScheduleSchoolDetails,
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
  school_booking_opens_at: string | null;
  school_booking_closes_at: string | null;
  series_id: string | null;
  series_sequence: number | null;
  created_at: string;
  updated_at: string;
};


type ScheduleSlotSchoolDetails = {
  slot_id: string;
  venue_name: string | null;
  venue_address: string | null;
  arrival_entrance: string | null;
  parking_instructions: string | null;
  accessibility_notes: string | null;
  wifi_network: string | null;
  wifi_password: string | null;
  day_of_contact_name: string | null;
  day_of_contact_phone: string | null;
  edit_deadline: string | null;
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

type ScheduleSort =
  | "date_asc"
  | "date_desc"
  | "school_asc"
  | "school_desc"
  | "status"
  | "staff_desc"
  | "waitlist_desc";

type ScheduleView = "list" | "cards";
type ScheduleFilter =
  | "all"
  | "open"
  | "booked"
  | "unbooked"
  | "waitlisted"
  | "understaffed"
  | "mine";

type ScheduleWaitlistEntry = {
  id: string;
  cycle_id: string;
  application_id: string;
  requested_date: string;
  time_preference: "morning" | "afternoon" | "evening" | "any";
  status: "waiting" | "offered" | "accepted" | "declined" | "removed" | "expired";
  offered_slot_id: string | null;
  offer_expires_at: string | null;
  applicant_notes: string | null;
  owner_notes: string | null;
  created_at: string;
  updated_at: string;
};

type ScheduleSearchParams = {
  success?: string;
  error?: string;
  sort?: ScheduleSort;
  view?: ScheduleView;
  filter?: ScheduleFilter;
  q?: string;
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

function easternDateKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatWaitlistDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
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

function formatAccessDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function schoolAccessLabel(slot: ScheduleSlot, serverTime: number) {
  if (!slot.school_booking_opens_at) return "Hidden";

  const opensAt = new Date(slot.school_booking_opens_at).getTime();
  const closesAt = slot.school_booking_closes_at
    ? new Date(slot.school_booking_closes_at).getTime()
    : null;

  if (opensAt > serverTime) {
    return `Opens ${formatAccessDateTime(slot.school_booking_opens_at)}`;
  }

  if (closesAt && closesAt <= serverTime) return "School selection closed";

  return closesAt
    ? `Open until ${formatAccessDateTime(slot.school_booking_closes_at!)}`
    : "Open to schools";
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<ScheduleSearchParams>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const allowedSorts: ScheduleSort[] = [
    "date_asc",
    "date_desc",
    "school_asc",
    "school_desc",
    "status",
    "staff_desc",
    "waitlist_desc",
  ];
  const selectedSort: ScheduleSort = allowedSorts.includes(params.sort as ScheduleSort)
    ? (params.sort as ScheduleSort)
    : "date_asc";
  const selectedView: ScheduleView = params.view === "cards" ? "cards" : "list";
  const allowedFilters: ScheduleFilter[] = [
    "all",
    "open",
    "booked",
    "unbooked",
    "waitlisted",
    "understaffed",
    "mine",
  ];
  const selectedFilter: ScheduleFilter = allowedFilters.includes(
    params.filter as ScheduleFilter,
  )
    ? (params.filter as ScheduleFilter)
    : "all";
  const scheduleSearch = (params.q ?? "").trim();
  const supabase = await createClient();

  const [{ data: cycleData }, { data: serverTimeData }] = await Promise.all([
    supabase
      .from("award_cycles")
      .select(
        "id,cycle_key,name,season_year,program_type,description,status,opens_at,closes_at,is_active,cloned_from_cycle_id,created_at,updated_at",
      )
      .eq("is_active", true)
      .neq("status", "archived")
      .order("season_year", { ascending: false })
      .order("name"),
    supabase.rpc("get_schedule_server_time"),
  ]);

  const cycles = (cycleData ?? []) as AwardCycle[];
  const activeCycleIds = cycles.map((cycle) => cycle.id);
  const slotResult = activeCycleIds.length
    ? await supabase
        .from("schedule_slots")
        .select(
          "id,cycle_id,title,starts_at,ends_at,location,school_instructions,status,school_booking_opens_at,school_booking_closes_at,series_id,series_sequence,created_at,updated_at",
        )
        .in("cycle_id", activeCycleIds)
        .order("starts_at", { ascending: true })
    : { data: [], error: null };
  const { data: slotData, error: slotError } = slotResult;
  const slots = (slotData ?? []) as ScheduleSlot[];
  const { data: schoolDetailsData, error: schoolDetailsError } = slots.length
    ? await supabase
        .from("schedule_slot_school_details")
        .select("slot_id,venue_name,venue_address,arrival_entrance,parking_instructions,accessibility_notes,wifi_network,wifi_password,day_of_contact_name,day_of_contact_phone,edit_deadline,updated_at")
        .in("slot_id", slots.map((slot) => slot.id))
    : { data: [], error: null };
  if (schoolDetailsError) throw new Error(schoolDetailsError.message);
  const schoolDetails = (schoolDetailsData ?? []) as ScheduleSlotSchoolDetails[];
  const schoolDetailsMap = new Map(schoolDetails.map((details) => [details.slot_id, details]));
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

    const activeSlotIds = new Set(slots.map((slot) => slot.id));
    staffBookings = ((bookingData ?? []) as StaffBooking[]).filter(
      (booking) => activeSlotIds.has(booking.slot_id),
    );
    staffDirectory = ((directoryData ?? []) as StaffEnrollment[]).filter(
      (enrollment) => activeSlotIds.has(enrollment.slot_id),
    );

    if (profile.role === "owner" || profile.role === "advisory_member") {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id,email,full_name,role,active")
        .in("role", ["adjudicator", "advisory_member"])
        .eq("active", true)
        .order("full_name");

      ownerStaff = (profileData ?? []) as Profile[];
    }

    if (profile.role === "owner") {
      const { data: applicationData } = await supabase
        .from("applications")
        .select(
          "id,cycle_id,form_version_id,applicant_user_id,school_name,production_title,status,submitted_at,form_version,form_data,owner_notes,current_stage_id,external_applicant_name,external_applicant_email,source_system,source_record_id,source_stage,is_archived,archived_payload,cloned_from_application_id,created_at,updated_at",
        )
        .eq("is_archived", false)
        .order("school_name");

      ownerApplications = (applicationData ?? []) as Application[];
    }
  }

  const waitlistResult = activeCycleIds.length
    ? await supabase
        .from("schedule_date_waitlist")
        .select(
          "id,cycle_id,application_id,requested_date,time_preference,status,offered_slot_id,offer_expires_at,applicant_notes,owner_notes,created_at,updated_at",
        )
        .in("cycle_id", activeCycleIds)
        .in("status", ["waiting", "offered", "accepted"])
        .order("requested_date", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  const { data: waitlistData, error: waitlistError } = waitlistResult;

  if (waitlistError) {
    throw new Error(`Schedule waitlist could not be loaded: ${waitlistError.message}`);
  }

  const waitlistEntries = (waitlistData ?? []) as ScheduleWaitlistEntry[];

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

  const waitlistCountByDate = new Map<string, number>();
  for (const entry of waitlistEntries) {
    if (!['waiting', 'offered'].includes(entry.status)) continue;
    const key = `${entry.cycle_id}:${entry.requested_date}`;
    waitlistCountByDate.set(key, (waitlistCountByDate.get(key) ?? 0) + 1);
  }

  const slotWaitlistCount = (slot: ScheduleSlot) =>
    waitlistCountByDate.get(`${slot.cycle_id}:${easternDateKey(slot.starts_at)}`) ?? 0;

  const slotIsBooked = (slot: ScheduleSlot) =>
    Boolean(bookingMap.get(slot.id)) || Boolean(availabilityMap.get(slot.id)?.is_booked);

  const normalizedSearch = scheduleSearch.toLowerCase();

  const displaySlots = slots
    .filter((slot) => {
      const booking = bookingMap.get(slot.id);
      const participants = staffBySlot.get(slot.id) ?? [];
      const availabilityItem = availabilityMap.get(slot.id);
      const cycle = cycleMap.get(slot.cycle_id);
      const searchable = [
        slot.title,
        slot.location,
        booking?.school_name,
        booking?.production_title,
        cycle?.name,
        cycle?.season_year,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (normalizedSearch && !searchable.includes(normalizedSearch)) {
        return false;
      }

      switch (selectedFilter) {
        case 'open':
          return slot.status === 'open';
        case 'booked':
          return slotIsBooked(slot);
        case 'unbooked':
          return !slotIsBooked(slot);
        case 'waitlisted':
          return slotWaitlistCount(slot) > 0;
        case 'understaffed':
          return participants.length < 3;
        case 'mine':
          return Boolean(availabilityItem?.is_mine) ||
            participants.some((participant) => participant.user_id === profile.id);
        default:
          return true;
      }
    })
    .sort((left, right) => {
      if (selectedSort.startsWith('school')) {
        const leftSchool = bookingMap.get(left.id)?.school_name ?? '';
        const rightSchool = bookingMap.get(right.id)?.school_name ?? '';
        const result = leftSchool.localeCompare(rightSchool, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (result !== 0) return selectedSort === 'school_desc' ? -result : result;
      }

      if (selectedSort === 'status') {
        const statusOrder: Record<ScheduleSlotStatus, number> = {
          open: 0,
          draft: 1,
          closed: 2,
          cancelled: 3,
        };
        const result = statusOrder[left.status] - statusOrder[right.status];
        if (result !== 0) return result;
      }

      if (selectedSort === 'staff_desc') {
        const result =
          (staffBySlot.get(right.id)?.length ?? 0) -
          (staffBySlot.get(left.id)?.length ?? 0);
        if (result !== 0) return result;
      }

      if (selectedSort === 'waitlist_desc') {
        const result = slotWaitlistCount(right) - slotWaitlistCount(left);
        if (result !== 0) return result;
      }

      const dateResult =
        new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime();
      return selectedSort === 'date_desc' ? -dateResult : dateResult;
    });

  const applicantBooking = availability.find((item) => item.is_mine);
  const bookedSlot = applicantBooking
    ? slots.find((slot) => slot.id === applicantBooking.slot_id)
    : null;
  const bookedApplication = applicantBooking?.my_application_id
    ? applicantApplications.find(
        (application) => application.id === applicantBooking.my_application_id,
      )
    : null;
  const bookedSchoolDetails = bookedSlot ? schoolDetailsMap.get(bookedSlot.id) ?? null : null;

  const ownerBulkSlots =
    profile.role === "owner"
      ? slots
          .filter(
            (slot) =>
              slot.status !== "cancelled" &&
              new Date(slot.starts_at).getTime() > serverTime,
          )
          .map((slot) => {
            const cycle = cycleMap.get(slot.cycle_id);
            return {
              id: slot.id,
              title: slot.title,
              program: cycle
                ? `${cycle.season_year} — ${cycle.name}`
                : "Program",
              date: formatSlotDate(slot.starts_at),
              time: `${formatSlotTime(slot.starts_at, slot.ends_at)} ET`,
              accessLabel: schoolAccessLabel(slot, serverTime),
            };
          })
      : [];

  const applicationLookup = new Map(
    [...applicantApplications, ...ownerApplications].map((application) => [
      application.id,
      application,
    ]),
  );

  const applicantWaitlistEntries = waitlistEntries.filter((entry) =>
    applicantApplications.some((application) => application.id === entry.application_id),
  );

  const applicantWaitlistDates = Array.from(
    new Map(
      slots
        .filter(
          (slot) =>
            slot.status !== "cancelled" &&
            new Date(slot.starts_at).getTime() > serverTime &&
            applicantApplications.some(
              (application) => application.cycle_id === slot.cycle_id,
            ),
        )
        .map((slot) => [
          `${slot.cycle_id}:${easternDateKey(slot.starts_at)}`,
          {
            cycleId: slot.cycle_id,
            date: easternDateKey(slot.starts_at),
            label: formatSlotDate(slot.starts_at),
          },
        ]),
    ).values(),
  );

  const ownerWaitlistEntries = waitlistEntries.filter((entry) =>
    ["waiting", "offered"].includes(entry.status),
  );

  const applicantScheduleSlots = profile.role === "applicant"
    ? displaySlots.map((slot) => {
        const cycle = cycleMap.get(slot.cycle_id);
        const slotAvailability = availabilityMap.get(slot.id);
        const slotApplications = applicantApplications.filter(
          (application) => application.cycle_id === slot.cycle_id,
        );
        const isPast = new Date(slot.starts_at).getTime() <= serverTime;
        const schoolAccessOpen =
          Boolean(slot.school_booking_opens_at) &&
          new Date(slot.school_booking_opens_at!).getTime() <= serverTime &&
          (!slot.school_booking_closes_at ||
            new Date(slot.school_booking_closes_at).getTime() > serverTime);

        return {
          id: slot.id,
          title: slot.title,
          dateLabel: formatSlotDate(slot.starts_at),
          timeLabel: formatSlotTime(slot.starts_at, slot.ends_at),
          locationLabel:
            slot.location || schoolDetailsMap.get(slot.id)?.venue_name || "TBA",
          cycleLabel: cycle
            ? `${cycle.season_year} · ${cycle.name}`
            : "Program",
          waitlistCount: slotWaitlistCount(slot),
          applications: slotApplications.map((application) => ({
            id: application.id,
            label: `${application.school_name}${
              application.production_title
                ? ` — ${application.production_title}`
                : ""
            }`,
          })),
          isPast,
          canSchoolBook:
            slot.status === "open" &&
            schoolAccessOpen &&
            !isPast &&
            !slotAvailability?.is_booked &&
            slotApplications.length > 0,
        };
      })
    : [];

  return (
    <>
      <div className="page-heading schedule-page-heading">
        <div>
          <h1>Scheduling</h1>
          <p>
            {profile.role === "applicant"
              ? "Choose one available GHSMTA schedule slot for your school."
              : profile.role === "owner"
                ? "Build active schedule slots, manage school reservations, and coordinate adjudicators and advisory members."
                : "Join the active schedule slots you can attend and see the other participating reviewers."}
          </p>
        </div>
        {profile.role === "owner" && (
          <Link className="button button-secondary" href="/portal/admin/archive#schedule-archive">
            View archived schedule
          </Link>
        )}
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
              <div className="field">
                <label htmlFor="school_access_mode">School selection</label>
                <select
                  className="select"
                  defaultValue="hidden"
                  id="school_access_mode"
                  name="school_access_mode"
                >
                  <option value="hidden">Keep hidden from schools</option>
                  <option value="open_now">Open to schools now</option>
                  <option value="scheduled">Schedule opening</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="school_booking_opens_at">Scheduled school opening</label>
                <input
                  className="input"
                  id="school_booking_opens_at"
                  name="school_booking_opens_at"
                  type="datetime-local"
                />
              </div>
              <div className="field">
                <label htmlFor="school_booking_closes_at">School selection closes</label>
                <input
                  className="input"
                  id="school_booking_closes_at"
                  name="school_booking_closes_at"
                  type="datetime-local"
                />
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

      {profile.role === "owner" && (
        <ScheduleOwnerTools
          cycles={cycles.map((cycle) => ({
            id: cycle.id,
            name: cycle.name,
            season_year: cycle.season_year,
          }))}
          slots={ownerBulkSlots}
        />
      )}

      <section className="schedule-workspace-toolbar">
        <div className="schedule-view-toggle" aria-label="Schedule view">
          <Link
            className={selectedView === "list" ? "active" : ""}
            href={{
              pathname: "/portal/schedule",
              query: { ...params, view: "list" },
            }}
          >
            List
          </Link>
          <Link
            className={selectedView === "cards" ? "active" : ""}
            href={{
              pathname: "/portal/schedule",
              query: { ...params, view: "cards" },
            }}
          >
            Cards
          </Link>
        </div>

        <form className="schedule-workspace-filters" method="get">
          <input name="view" type="hidden" value={selectedView} />
          <label className="sr-only" htmlFor="schedule_search">Search schedule</label>
          <input
            className="input"
            defaultValue={scheduleSearch}
            id="schedule_search"
            name="q"
            placeholder="Search school, production, location"
            type="search"
          />
          <label className="sr-only" htmlFor="schedule_filter">Filter schedule</label>
          <select className="select" defaultValue={selectedFilter} id="schedule_filter" name="filter">
            <option value="all">All slots</option>
            <option value="open">Open slots</option>
            <option value="booked">Booked</option>
            <option value="unbooked">Unbooked</option>
            <option value="waitlisted">Has waitlist</option>
            <option value="understaffed">Understaffed</option>
            <option value="mine">My schedule</option>
          </select>
          <label className="sr-only" htmlFor="schedule_sort">Sort schedule</label>
          <select className="select" defaultValue={selectedSort} id="schedule_sort" name="sort">
            <option value="date_asc">Date — earliest first</option>
            <option value="date_desc">Date — latest first</option>
            <option value="school_asc">School — A to Z</option>
            <option value="school_desc">School — Z to A</option>
            <option value="status">Status</option>
            <option value="staff_desc">Reviewer count</option>
            <option value="waitlist_desc">Waitlist count</option>
          </select>
          <button className="button button-secondary button-compact" type="submit">Apply</button>
          {(scheduleSearch || selectedFilter !== "all" || selectedSort !== "date_asc") && (
            <Link className="text-button" href={`/portal/schedule?view=${selectedView}`}>Reset</Link>
          )}
        </form>
      </section>

      {profile.role === "applicant" && !bookedSlot && (
        <details
          className="panel schedule-waitlist-panel schedule-waitlist-disclosure"
          open={applicantWaitlistEntries.some((entry) => entry.status === "offered")}
        >
          <summary className="panel-header">
            <div>
              <span className="eyebrow">Date waitlist</span>
              <h2>Join a preferred date</h2>
              <p>Join a date waitlist when the available times do not work or are already full.</p>
            </div>
            <span className="badge">{applicantWaitlistEntries.filter((entry) => ["waiting", "offered"].includes(entry.status)).length}</span>
          </summary>
          <div className="panel-body schedule-waitlist-body">
            <form action={joinScheduleDateWaitlist} className="schedule-waitlist-form">
              <div className="field">
                <label htmlFor="waitlist_application">Application</label>
                <select className="select" id="waitlist_application" name="application_id" required>
                  <option value="">Choose application</option>
                  {applicantApplications.map((application) => (
                    <option key={application.id} value={application.id}>
                      {application.school_name}{application.production_title ? ` — ${application.production_title}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="waitlist_date">Preferred date</label>
                <select className="select" id="waitlist_date" name="requested_date" required>
                  <option value="">Choose date</option>
                  {applicantWaitlistDates.map((option) => (
                    <option key={`${option.cycleId}:${option.date}`} value={option.date}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="waitlist_preference">Time preference</label>
                <select className="select" defaultValue="any" id="waitlist_preference" name="time_preference">
                  <option value="any">Any time</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
              <div className="field schedule-waitlist-notes">
                <label htmlFor="waitlist_notes">Notes</label>
                <input className="input" id="waitlist_notes" name="notes" placeholder="Travel or timing considerations" />
              </div>
              <button className="button button-dark" disabled={applicantWaitlistDates.length === 0} type="submit">
                Join date waitlist
              </button>
            </form>

            {applicantWaitlistEntries.length > 0 && (
              <div className="schedule-waitlist-list">
                {applicantWaitlistEntries.map((entry) => {
                  const offeredSlot = entry.offered_slot_id
                    ? slots.find((slot) => slot.id === entry.offered_slot_id)
                    : null;
                  return (
                    <article className="schedule-waitlist-row" key={entry.id}>
                      <div>
                        <strong>{formatWaitlistDate(entry.requested_date)}</strong>
                        <span>{entry.time_preference === "any" ? "Any time" : entry.time_preference}</span>
                        {offeredSlot && (
                          <small>Offered: {formatSlotTime(offeredSlot.starts_at, offeredSlot.ends_at)} ET</small>
                        )}
                      </div>
                      <span className={`badge schedule-waitlist-status schedule-waitlist-status-${entry.status}`}>
                        {entry.status}
                      </span>
                      <div className="schedule-waitlist-actions">
                        {entry.status === "offered" && (
                          <>
                            <form action={acceptScheduleWaitlistOffer.bind(null, entry.id)}>
                              <button className="button button-dark button-compact" type="submit">Accept</button>
                            </form>
                            <form action={declineScheduleWaitlistOffer.bind(null, entry.id)}>
                              <button className="button button-secondary button-compact" type="submit">Decline</button>
                            </form>
                          </>
                        )}
                        {["waiting", "offered"].includes(entry.status) && (
                          <form action={leaveScheduleDateWaitlist.bind(null, entry.id)}>
                            <button className="text-button danger-text" type="submit">Leave</button>
                          </form>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      )}

      {profile.role === "owner" && ownerWaitlistEntries.length > 0 && (
        <section className="panel schedule-owner-waitlist-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Owner queue</span>
              <h2>Schedule date waitlist</h2>
              <p>Offer an open slot on the school’s requested date.</p>
            </div>
            <span className="badge">{ownerWaitlistEntries.length}</span>
          </div>
          <div className="panel-body schedule-owner-waitlist-list">
            {ownerWaitlistEntries.map((entry) => {
              const application = applicationLookup.get(entry.application_id);
              const eligibleSlots = slots.filter(
                (slot) =>
                  slot.cycle_id === entry.cycle_id &&
                  slot.status === "open" &&
                  easternDateKey(slot.starts_at) === entry.requested_date &&
                  !bookingMap.has(slot.id) &&
                  new Date(slot.starts_at).getTime() > serverTime,
              );

              return (
                <article className="schedule-owner-waitlist-row" key={entry.id}>
                  <div>
                    <strong>{application?.school_name ?? "School"}</strong>
                    <span>{application?.production_title || formatWaitlistDate(entry.requested_date)}</span>
                    <small>{formatWaitlistDate(entry.requested_date)} · {entry.time_preference}</small>
                  </div>
                  <span className={`badge schedule-waitlist-status schedule-waitlist-status-${entry.status}`}>{entry.status}</span>
                  <form action={ownerOfferWaitlistSlot.bind(null, entry.id)} className="schedule-waitlist-offer-form">
                    <select className="select" defaultValue={entry.offered_slot_id ?? ""} name="slot_id" required>
                      <option value="">Choose open slot</option>
                      {eligibleSlots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {formatSlotTime(slot.starts_at, slot.ends_at)} ET · {slot.title}
                        </option>
                      ))}
                    </select>
                    <select className="select" defaultValue="24" name="expires_hours">
                      <option value="12">12-hour offer</option>
                      <option value="24">24-hour offer</option>
                      <option value="48">48-hour offer</option>
                      <option value="72">72-hour offer</option>
                    </select>
                    <button className="button button-secondary button-compact" disabled={eligibleSlots.length === 0} type="submit">
                      {entry.status === "offered" ? "Update offer" : "Offer slot"}
                    </button>
                  </form>
                </article>
              );
            })}
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
            <form action={updateOwnScheduleSchoolDetails.bind(null, bookedSlot.id)} className="school-visit-details-form form-stack">
              <div className="school-visit-details-heading"><div><span className="eyebrow">School editable</span><h3>Location, parking &amp; Wi-Fi</h3></div>{bookedSchoolDetails?.edit_deadline && <span className="badge">Edit by {formatAccessDateTime(bookedSchoolDetails.edit_deadline)}</span>}</div>
              <div className="two-column-grid"><div className="field"><label>Venue name</label><input className="input" defaultValue={bookedSchoolDetails?.venue_name ?? ""} name="venue_name" /></div><div className="field"><label>Venue address</label><input className="input" defaultValue={bookedSchoolDetails?.venue_address ?? ""} name="venue_address" /></div></div>
              <div className="field"><label>Arrival entrance</label><input className="input" defaultValue={bookedSchoolDetails?.arrival_entrance ?? ""} name="arrival_entrance" /></div>
              <div className="field"><label>Parking instructions</label><textarea className="textarea compact-textarea" defaultValue={bookedSchoolDetails?.parking_instructions ?? ""} name="parking_instructions" /></div>
              <div className="field"><label>Accessibility notes</label><textarea className="textarea compact-textarea" defaultValue={bookedSchoolDetails?.accessibility_notes ?? ""} name="accessibility_notes" /></div>
              <div className="two-column-grid"><div className="field"><label>Wi-Fi network</label><input className="input" defaultValue={bookedSchoolDetails?.wifi_network ?? ""} name="wifi_network" /></div><div className="field"><label>Wi-Fi password</label><input className="input" defaultValue={bookedSchoolDetails?.wifi_password ?? ""} name="wifi_password" /></div></div>
              <div className="two-column-grid"><div className="field"><label>Day-of contact</label><input className="input" defaultValue={bookedSchoolDetails?.day_of_contact_name ?? ""} name="day_of_contact_name" /></div><div className="field"><label>Day-of phone</label><input className="input" defaultValue={bookedSchoolDetails?.day_of_contact_phone ?? ""} name="day_of_contact_phone" /></div></div>
              <button className="button button-dark" type="submit">Save school visit details</button>
            </form>
          </div>
        </section>
      ) : (profile.role as AppRole) === "applicant" ? (
        <ApplicantScheduleBoard
          initialAvailability={availability}
          slots={applicantScheduleSlots}
          view={selectedView}
        />
      ) : (
        <section className={`schedule-slot-grid schedule-slot-grid-${selectedView}`}>
          {displaySlots.length === 0 ? (
            <div className="panel empty-state schedule-empty-state">
              <h3>
                {(profile.role as AppRole) === "applicant"
                  ? "No schedule slots are currently open."
                  : "No schedule slots are configured."}
              </h3>
              <p>
                {(profile.role as AppRole) === "applicant"
                  ? "GHSMTA will make slots available when school selection opens."
                  : "Slots will appear here when an owner creates them."}
              </p>
            </div>
          ) : (
            displaySlots.map((slot) => {
              const cycle = cycleMap.get(slot.cycle_id);
              const slotAvailability = availabilityMap.get(slot.id);
              const booking = bookingMap.get(slot.id);
              const visitDetails = schoolDetailsMap.get(slot.id) ?? null;
              const participants = staffBySlot.get(slot.id) ?? [];
              const currentEnrollment = participants.find(
                (participant) => participant.user_id === profile.id,
              );
              const slotApplications =
                (profile.role as AppRole) === "applicant"
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
              const schoolAccessOpen =
                Boolean(slot.school_booking_opens_at) &&
                new Date(slot.school_booking_opens_at!).getTime() <= serverTime &&
                (!slot.school_booking_closes_at ||
                  new Date(slot.school_booking_closes_at).getTime() > serverTime);
              const canSchoolBook =
                slot.status === "open" &&
                schoolAccessOpen &&
                !isPast &&
                !slotAvailability?.is_booked &&
                slotApplications.length > 0;

              if ((profile.role as AppRole) === "applicant" && slot.status === "draft") {
                return null;
              }

              const waitlistCount = slotWaitlistCount(slot);

              return (
                <article
                  className={`panel schedule-slot-card schedule-slot-card-${selectedView}`}
                  key={slot.id}
                >
                  <details className="schedule-slot-details" open={selectedView === "cards"}>
                    <summary className="schedule-list-summary">
                      <span className="schedule-list-date">
                        <strong>{formatSlotDate(slot.starts_at)}</strong>
                        <small>{formatSlotTime(slot.starts_at, slot.ends_at)} ET</small>
                      </span>
                      <span className="schedule-list-school">
                        <strong>
                          {booking?.school_name ||
                            (slotAvailability?.is_mine
                              ? "Your school"
                              : slotAvailability?.is_booked
                                ? "Booked"
                                : "Open slot")}
                        </strong>
                        <small>{booking?.production_title || slot.title}</small>
                      </span>
                      <span className="schedule-list-location">
                        <strong>{slot.location || visitDetails?.venue_name || "TBA"}</strong>
                        <small>{cycle ? `${cycle.season_year} · ${cycle.name}` : "Program"}</small>
                      </span>
                      <span className="schedule-list-metric">
                        <strong>{participants.length}</strong>
                        <small>reviewers</small>
                      </span>
                      <span className="schedule-list-metric">
                        <strong>{waitlistCount}</strong>
                        <small>waitlist</small>
                      </span>
                      <span className={`badge schedule-status schedule-status-${slot.status}`}>
                        {statusLabel(slot.status)}
                      </span>
                      <span className="schedule-list-expand">Details</span>
                    </summary>
                    <div className="schedule-slot-expanded">
                      <div className="schedule-slot-accent" />
                  <div className="panel-header schedule-slot-header">
                    <div>
                      <span className="eyebrow">
                        {cycle ? `${cycle.season_year} · ${cycle.name}` : "Program"}
                      </span>
                      <h2>{slot.title}</h2>
                      <p>{formatSlotDate(slot.starts_at)}</p>
                    </div>
                    <div className="schedule-slot-status-stack">
                      <span className={`badge schedule-status schedule-status-${slot.status}`}>
                        {statusLabel(slot.status)}
                      </span>
                      {profile.role === "owner" && (
                        <span className="badge schedule-school-access-badge">
                          {schoolAccessLabel(slot, serverTime)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="panel-body schedule-slot-body">
                    <div className="schedule-slot-meta">
                      <span><strong>Time</strong>{formatSlotTime(slot.starts_at, slot.ends_at)} ET</span>
                      <span><strong>Location</strong>{slot.location || "To be announced"}</span>
                    </div>

                    {slot.school_instructions && (
                      <p className="schedule-school-instructions">{slot.school_instructions}</p>
                    )}

                    {(profile.role as AppRole) === "applicant" ? (
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

                        {booking && visitDetails && (
                          <div className="schedule-visit-detail-card">
                            <span className="eyebrow">School visit details</span>
                            <div className="schedule-visit-detail-grid">
                              <span><strong>Venue</strong>{visitDetails.venue_name || slot.location || "To be announced"}</span>
                              <span><strong>Address</strong>{visitDetails.venue_address || "Not entered"}</span>
                              <span><strong>Entrance</strong>{visitDetails.arrival_entrance || "Not entered"}</span>
                              <span><strong>Parking</strong>{visitDetails.parking_instructions || "Not entered"}</span>
                              <span><strong>Wi-Fi</strong>{visitDetails.wifi_network ? `${visitDetails.wifi_network}${visitDetails.wifi_password ? ` · ${visitDetails.wifi_password}` : ""}` : "Not entered"}</span>
                              <span><strong>Day-of contact</strong>{visitDetails.day_of_contact_name ? `${visitDetails.day_of_contact_name}${visitDetails.day_of_contact_phone ? ` · ${visitDetails.day_of_contact_phone}` : ""}` : "Not entered"}</span>
                            </div>
                          </div>
                        )}

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
                                  {(profile.role === "owner" || profile.role === "advisory_member") && (
                                    <form action={removeScheduleStaff.bind(null, participant.enrollment_id)} className="schedule-remove-participant-form">
                                      {profile.role === "advisory_member" && (
                                        <input className="input input-compact" name="reason" placeholder="Removal reason" required />
                                      )}
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

                        {profile.role === "advisory_member" && (
                          <div className="schedule-owner-controls schedule-advisory-controls">
                            <div className="schedule-owner-action">
                              <h4>Manage review team</h4>
                              <p className="muted-copy">Changes are included in the Owner daily review email.</p>
                              <form action={ownerAddStaff.bind(null, slot.id)} className="form-stack compact-form">
                                <div className="field">
                                  <label htmlFor={`advisory_staff_${slot.id}`}>Portal user</label>
                                  <select className="select" id={`advisory_staff_${slot.id}`} name="user_id" required>
                                    <option value="">Choose person</option>
                                    {ownerStaff
                                      .filter((person) => !participants.some((participant) => participant.user_id === person.id))
                                      .map((person) => (
                                        <option key={person.id} value={person.id}>
                                          {person.full_name ?? person.email} — {roleLabel(person.role)}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                                <button className="button button-secondary button-compact" type="submit">Add reviewer</button>
                              </form>
                            </div>
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
                                <div className="two-column-grid">
                                  <div className="field">
                                    <label>School selection opens</label>
                                    <input
                                      className="input"
                                      defaultValue={
                                        slot.school_booking_opens_at
                                          ? localInputValue(slot.school_booking_opens_at)
                                          : ""
                                      }
                                      name="school_booking_opens_at"
                                      type="datetime-local"
                                    />
                                  </div>
                                  <div className="field">
                                    <label>School selection closes</label>
                                    <input
                                      className="input"
                                      defaultValue={
                                        slot.school_booking_closes_at
                                          ? localInputValue(slot.school_booking_closes_at)
                                          : ""
                                      }
                                      name="school_booking_closes_at"
                                      type="datetime-local"
                                    />
                                  </div>
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

                            <details>
                              <summary>Edit school visit details</summary>
                              <form action={ownerUpdateScheduleSchoolDetails.bind(null, slot.id)} className="form-stack compact-form">
                                <div className="two-column-grid"><div className="field"><label>Venue name</label><input className="input" defaultValue={visitDetails?.venue_name ?? ""} name="venue_name" /></div><div className="field"><label>Venue address</label><input className="input" defaultValue={visitDetails?.venue_address ?? ""} name="venue_address" /></div></div>
                                <div className="field"><label>Arrival entrance</label><input className="input" defaultValue={visitDetails?.arrival_entrance ?? ""} name="arrival_entrance" /></div>
                                <div className="field"><label>Parking instructions</label><textarea className="textarea compact-textarea" defaultValue={visitDetails?.parking_instructions ?? ""} name="parking_instructions" /></div>
                                <div className="field"><label>Accessibility notes</label><textarea className="textarea compact-textarea" defaultValue={visitDetails?.accessibility_notes ?? ""} name="accessibility_notes" /></div>
                                <div className="two-column-grid"><div className="field"><label>Wi-Fi network</label><input className="input" defaultValue={visitDetails?.wifi_network ?? ""} name="wifi_network" /></div><div className="field"><label>Wi-Fi password</label><input className="input" defaultValue={visitDetails?.wifi_password ?? ""} name="wifi_password" /></div></div>
                                <div className="two-column-grid"><div className="field"><label>Day-of contact</label><input className="input" defaultValue={visitDetails?.day_of_contact_name ?? ""} name="day_of_contact_name" /></div><div className="field"><label>Day-of phone</label><input className="input" defaultValue={visitDetails?.day_of_contact_phone ?? ""} name="day_of_contact_phone" /></div></div>
                                <div className="field"><label>School edit deadline</label><input className="input" defaultValue={visitDetails?.edit_deadline ? localInputValue(visitDetails.edit_deadline) : ""} name="edit_deadline" type="datetime-local" /></div>
                                <button className="button button-dark button-compact" type="submit">Save visit details</button>
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
                    </div>
                  </details>
                </article>
              );
            })
          )}
        </section>
      )}
    </>
  );
}

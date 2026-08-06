/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  findReportDefinition,
  visibleColumnsForVariant,
  type ReportColumn,
  type ReportDefinition,
  type ReportFormat,
  type ReportVariant,
} from "@/lib/reports/report-definitions";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

type DbError = { message: string } | null;

export type ReportFilters = {
  cycleId: string;
  dateFrom: string;
  dateTo: string;
  school: string;
  status: string;
  format: ReportFormat;
  variant: ReportVariant;
  includeArchived: boolean;
  includeInternalNotes: boolean;
  includeContactInfo: boolean;
  includeAdjudicatorIdentities: boolean;
  includeProtectedScores: boolean;
  sort: string;
  direction: "asc" | "desc";
};

export type ReportRow = Record<string, string | number | boolean | null>;

export type LoadedReport = {
  definition: ReportDefinition;
  columns: ReportColumn[];
  rows: ReportRow[];
  filters: ReportFilters;
  warnings: string[];
  generatedAt: string;
};

type ApplicationRow = {
  id: string;
  cycle_id: string | null;
  applicant_user_id: string | null;
  school_name: string | null;
  production_title: string | null;
  status: string | null;
  submitted_at: string | null;
  updated_at: string | null;
  owner_notes: string | null;
  external_applicant_name: string | null;
  external_applicant_email: string | null;
  source_stage: string | null;
  is_archived: boolean | null;
  form_version_id: string | null;
  form_data?: Record<string, unknown> | null;
};

type CycleRow = {
  id: string;
  name: string | null;
  season_year: string | null;
  status?: string | null;
  program_type?: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone_e164?: string | null;
  role?: string | null;
  active?: boolean | null;
  organization?: string | null;
  notification_preferences?: Record<string, unknown> | null;
  force_password_reset?: boolean | null;
  mfa_required?: boolean | null;
};

type ApplicationMemberRow = {
  application_id: string;
  user_id: string;
  member_role: string | null;
  can_edit_application: boolean | null;
  active: boolean | null;
};

type BillingQuestionRow = {
  id: string;
  form_version_id: string;
  question_key: string | null;
  label: string | null;
  source_label: string | null;
  sort_order: number | null;
};

type BillingAnswerRow = {
  application_id: string;
  question_id: string;
  value: unknown;
};

const PAGE_SIZE = 900;

const PROGRAM_QUESTION_FRAGMENTS = [
  "acceptd_q_163198",
  "please select the program you are registering for the 2026 2027 ghsmta season",
  "program you are registering for the 2026 2027 ghsmta season",
  "select the program",
  "track are you registering",
];

const SCHOOL_TYPE_FRAGMENTS = [
  "acceptd_q_137656",
  "school type",
  "school_type",
];

const REGION_FRAGMENTS = ["region", "ghsmta region"];
const DISTRICT_FRAGMENTS = ["district", "school district", "county"];
const CONTACT_FRAGMENTS = {
  principal: ["principal", "administrator"],
  theatre_director: ["theatre director", "director name", "primary director"],
  music_director: ["music director", "musical director"],
  choreographer: ["choreographer"],
  technical_contact: ["technical director", "technical contact", "tech contact"],
  venue: ["venue", "theatre address", "performance location"],
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function text(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return text(record.value);
    if ("label" in record) return text(record.label);
    return Object.values(record).map(text).filter(Boolean).join(", ");
  }
  return String(value).trim();
}

function clean(value: unknown) {
  return text(value) || "—";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dayName(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
    new Date(value),
  );
}

function timeRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return "";
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

function portalLink(path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

function questionHaystack(question: BillingQuestionRow) {
  return normalize(
    [question.question_key, question.label, question.source_label]
      .filter(Boolean)
      .join(" "),
  );
}

function answerToTrack(value: unknown) {
  const valueText = text(value);
  const normalized = normalize(valueText);
  if (!valueText) return "";
  if (normalized.includes("mentor")) return "Mentorship Track";
  if (normalized.includes("competition")) return "Competition Track";
  return valueText.split(/\s[-–—]\s|-/)[0]?.trim() || valueText;
}

function findAnswer(
  questions: BillingQuestionRow[],
  answers: Map<string, unknown>,
  fragments: string[],
  formatter: (value: unknown) => string = text,
) {
  const normalizedFragments = fragments.map(normalize);
  for (const question of questions) {
    const haystack = questionHaystack(question);
    if (!normalizedFragments.some((fragment) => haystack.includes(fragment))) {
      continue;
    }
    const answer = formatter(answers.get(question.id));
    if (answer) return answer;
  }
  return "";
}

async function fetchPaged<Row>(
  buildQuery: () => {
    range: (from: number, to: number) => Promise<{ data: Row[] | null; error: DbError }>;
  },
) {
  const rows: Row[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function safeFetchPaged<Row>(
  warnings: string[],
  label: string,
  buildQuery: () => {
    range: (from: number, to: number) => Promise<{ data: Row[] | null; error: DbError }>;
  },
) {
  try {
    return await fetchPaged<Row>(buildQuery);
  } catch (error) {
    warnings.push(`${label}: ${error instanceof Error ? error.message : "Could not load source data."}`);
    return [];
  }
}

function parseBool(searchParams: URLSearchParams, key: string, defaultValue = false) {
  const value = searchParams.get(key);
  if (value == null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function parseReportFilters(searchParams: URLSearchParams): ReportFilters {
  const requestedFormat = searchParams.get("format");
  const requestedVariant = searchParams.get("variant");
  const requestedDirection = searchParams.get("direction");

  return {
    cycleId: searchParams.get("cycle_id")?.trim() ?? "",
    dateFrom: searchParams.get("date_from")?.trim() ?? "",
    dateTo: searchParams.get("date_to")?.trim() ?? "",
    school: searchParams.get("school")?.trim().slice(0, 120) ?? "",
    status: searchParams.get("status")?.trim() ?? "",
    format: requestedFormat === "csv" || requestedFormat === "zip" ? requestedFormat : "pdf",
    variant: requestedVariant === "external" ? "external" : "internal",
    includeArchived: parseBool(searchParams, "include_archived"),
    includeInternalNotes: parseBool(searchParams, "include_internal_notes", true),
    includeContactInfo: parseBool(searchParams, "include_contact_info", true),
    includeAdjudicatorIdentities: parseBool(searchParams, "include_adjudicator_identities", true),
    includeProtectedScores: parseBool(searchParams, "include_protected_scores", true),
    sort: searchParams.get("sort")?.trim() ?? "",
    direction: requestedDirection === "desc" ? "desc" : "asc",
  };
}

async function loadBaseMaps(supabase: SupabaseLike, filters: ReportFilters, warnings: string[]) {
  const [cycles, profiles] = await Promise.all([
    safeFetchPaged<CycleRow>(warnings, "Award cycles", () =>
      supabase
        .from("award_cycles")
        .select("id,name,season_year,status,program_type")
        .order("season_year", { ascending: false }),
    ),
    safeFetchPaged<ProfileRow>(warnings, "Profiles", () =>
      supabase
        .from("profiles")
        .select("id,email,full_name,phone_e164,role,active,organization,notification_preferences,force_password_reset,mfa_required")
        .order("full_name"),
    ),
  ]);

  const appQuery = () => {
    let query = supabase
      .from("applications")
      .select("id,cycle_id,applicant_user_id,school_name,production_title,status,submitted_at,updated_at,owner_notes,external_applicant_name,external_applicant_email,source_stage,is_archived,form_version_id,form_data")
      .order("school_name");

    if (!filters.includeArchived) query = query.eq("is_archived", false);
    if (filters.cycleId) query = query.eq("cycle_id", filters.cycleId);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.school) query = query.ilike("school_name", `%${filters.school}%`);
    return query;
  };

  const applications = await safeFetchPaged<ApplicationRow>(
    warnings,
    "Applications",
    appQuery,
  );

  const applicationIds = applications.map((application) => application.id);
  const formVersionIds = [
    ...new Set(
      applications
        .map((application) => application.form_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [members, questions, answers] = await Promise.all([
    applicationIds.length
      ? safeFetchPaged<ApplicationMemberRow>(warnings, "Application members", () =>
          supabase
            .from("application_members")
            .select("application_id,user_id,member_role,can_edit_application,active")
            .in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    formVersionIds.length
      ? safeFetchPaged<BillingQuestionRow>(warnings, "Form questions", () =>
          supabase
            .from("application_questions")
            .select("id,form_version_id,question_key,label,source_label,sort_order")
            .in("form_version_id", formVersionIds)
            .order("sort_order"),
        )
      : Promise.resolve([]),
    applicationIds.length
      ? safeFetchPaged<BillingAnswerRow>(warnings, "Application answers", () =>
          supabase
            .from("application_answers")
            .select("application_id,question_id,value")
            .in("application_id", applicationIds),
        )
      : Promise.resolve([]),
  ]);

  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const membersByApplication = new Map<string, ApplicationMemberRow[]>();
  const questionsByFormVersion = new Map<string, BillingQuestionRow[]>();
  const answersByApplication = new Map<string, Map<string, unknown>>();

  for (const member of members) {
    const collection = membersByApplication.get(member.application_id) ?? [];
    collection.push(member);
    membersByApplication.set(member.application_id, collection);
  }

  for (const question of questions) {
    const collection = questionsByFormVersion.get(question.form_version_id) ?? [];
    collection.push(question);
    questionsByFormVersion.set(question.form_version_id, collection);
  }

  for (const answer of answers) {
    const collection = answersByApplication.get(answer.application_id) ?? new Map<string, unknown>();
    collection.set(answer.question_id, answer.value);
    answersByApplication.set(answer.application_id, collection);
  }

  return {
    applications,
    cycleById,
    profileById,
    membersByApplication,
    questionsByFormVersion,
    answersByApplication,
  };
}

function cycleLabel(cycle: CycleRow | undefined) {
  if (!cycle) return "";
  return [cycle.season_year, cycle.name].filter(Boolean).join(" · ");
}

function primaryContact(
  application: ApplicationRow,
  members: ApplicationMemberRow[],
  profileById: Map<string, ProfileRow>,
) {
  const sortedMembers = [...members].sort((left, right) => {
    if (left.active !== right.active) return Number(right.active) - Number(left.active);
    if (left.member_role !== right.member_role) return left.member_role === "primary" ? -1 : 1;
    return 0;
  });
  const primaryMember = sortedMembers.find((member) => profileById.get(member.user_id)?.email);
  const profile = primaryMember ? profileById.get(primaryMember.user_id) : null;
  return {
    name:
      profile?.full_name ??
      application.external_applicant_name ??
      "",
    email:
      profile?.email ??
      application.external_applicant_email ??
      "",
    phone: profile?.phone_e164 ?? "",
  };
}

function supplementalMembers(
  members: ApplicationMemberRow[],
  profileById: Map<string, ProfileRow>,
) {
  return members
    .filter((member) => member.active)
    .filter((member) => member.member_role !== "primary")
    .map((member) => {
      const profile = profileById.get(member.user_id);
      const access = member.can_edit_application ? "editor" : "view";
      return `${profile?.full_name ?? profile?.email ?? member.user_id} (${access})`;
    })
    .join("; ");
}

function applicationMeta(
  application: ApplicationRow,
  maps: Awaited<ReturnType<typeof loadBaseMaps>>,
) {
  const questions = application.form_version_id
    ? maps.questionsByFormVersion.get(application.form_version_id) ?? []
    : [];
  const answers = maps.answersByApplication.get(application.id) ?? new Map<string, unknown>();
  const cycle = application.cycle_id ? maps.cycleById.get(application.cycle_id) : undefined;
  const members = maps.membersByApplication.get(application.id) ?? [];
  const contact = primaryContact(application, members, maps.profileById);
  const schoolType =
    findAnswer(questions, answers, SCHOOL_TYPE_FRAGMENTS) ||
    text(application.form_data?.school_type);
  const selectedTrack =
    findAnswer(questions, answers, PROGRAM_QUESTION_FRAGMENTS, answerToTrack) ||
    text(application.form_data?.track);

  return {
    cycle,
    cycleText: cycleLabel(cycle),
    contact,
    members,
    schoolType,
    selectedTrack,
    region:
      findAnswer(questions, answers, REGION_FRAGMENTS) ||
      text(application.form_data?.region),
    district:
      findAnswer(questions, answers, DISTRICT_FRAGMENTS) ||
      text(application.form_data?.district),
    contactFields: Object.fromEntries(
      Object.entries(CONTACT_FRAGMENTS).map(([key, fragments]) => [
        key,
        findAnswer(questions, answers, fragments),
      ]),
    ) as Record<keyof typeof CONTACT_FRAGMENTS, string>,
  };
}

function baseApplicationRow(
  application: ApplicationRow,
  maps: Awaited<ReturnType<typeof loadBaseMaps>>,
): ReportRow {
  const meta = applicationMeta(application, maps);
  return {
    application_id: application.id,
    cycle: meta.cycleText,
    school: clean(application.school_name),
    school_type: meta.schoolType,
    selected_track: meta.selectedTrack,
    region: meta.region,
    district: meta.district,
    production: clean(application.production_title),
    status: clean(application.status),
    eligibility_status: clean(application.source_stage),
    results_release_status: "Use Results Release Readiness for release detail",
    submitted_at: formatDateTime(application.submitted_at),
    updated_at: formatDateTime(application.updated_at),
    primary_applicant: meta.contact.name,
    primary_email: meta.contact.email,
    primary_phone: meta.contact.phone,
    additional_school_users: supplementalMembers(meta.members, maps.profileById),
    owner_notes: application.owner_notes,
    portal_link: portalLink(`/portal/applications/${application.id}`),
  };
}

async function loadApplicationsReport(
  supabase: SupabaseLike,
  definition: ReportDefinition,
  filters: ReportFilters,
  warnings: string[],
) {
  const maps = await loadBaseMaps(supabase, filters, warnings);
  const applicationRows = maps.applications.map((application) =>
    baseApplicationRow(application, maps),
  );

  if (definition.source === "contacts") {
    return maps.applications.map((application) => {
      const base = baseApplicationRow(application, maps);
      const meta = applicationMeta(application, maps);
      return {
        ...base,
        principal: meta.contactFields.principal,
        theatre_director: meta.contactFields.theatre_director,
        music_director: meta.contactFields.music_director,
        choreographer: meta.contactFields.choreographer,
        technical_contact: meta.contactFields.technical_contact,
        venue: meta.contactFields.venue,
        adjudication_date: "",
      };
    });
  }

  if (definition.source === "impact") {
    return maps.applications.map((application) => {
      const base = baseApplicationRow(application, maps);
      return {
        cycle: base.cycle,
        anonymous_school_id: `school-${application.id.slice(0, 8)}`,
        school_characteristics: [base.region, base.district].filter(Boolean).join(" · "),
        region: base.region,
        school_type: base.school_type,
        participation_history: "Current portal cycles only",
        application_status: base.status,
        adjudication_completion: "",
        advancement: "",
        capacity_indicators: application.is_archived ? "Archived" : "Active",
        methodology_indicators: "De-identified; direct contact fields excluded.",
        record_quality_flags: [base.school_type ? "" : "School type missing", base.selected_track ? "" : "Track missing"].filter(Boolean).join("; "),
      };
    });
  }

  return applicationRows;
}

async function loadMissingRequirementsReport(
  supabase: SupabaseLike,
  filters: ReportFilters,
  warnings: string[],
) {
  const maps = await loadBaseMaps(supabase, filters, warnings);
  const applicationIds = maps.applications.map((application) => application.id);
  const [bookings, files, scorecards, releases] = await Promise.all([
    applicationIds.length
      ? safeFetchPaged<{ application_id: string; approval_status: string | null }>(warnings, "Schedule bookings", () =>
          supabase
            .from("schedule_school_bookings")
            .select("application_id,approval_status")
            .in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    applicationIds.length
      ? safeFetchPaged<{ application_id: string; document_category: string | null }>(warnings, "Files", () =>
          supabase
            .from("portal_files")
            .select("application_id,document_category")
            .in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    applicationIds.length
      ? safeFetchPaged<{ application_id: string; status: string | null }>(warnings, "Scorecards", () =>
          supabase
            .from("adjudication_scorecards")
            .select("application_id,status")
            .in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    applicationIds.length
      ? safeFetchPaged<{ application_id: string; scores_released_at: string | null; feedback_released_at: string | null }>(warnings, "Releases", () =>
          supabase
            .from("adjudication_releases")
            .select("application_id,scores_released_at,feedback_released_at")
            .in("application_id", applicationIds),
        )
      : Promise.resolve([]),
  ]);

  const bookingIds = new Set(bookings.map((booking) => booking.application_id));
  const fileCounts = new Map<string, number>();
  const scorecardStatus = new Map<string, string[]>();
  const releaseMap = new Map(releases.map((release) => [release.application_id, release]));

  for (const file of files) {
    fileCounts.set(file.application_id, (fileCounts.get(file.application_id) ?? 0) + 1);
  }
  for (const scorecard of scorecards) {
    const collection = scorecardStatus.get(scorecard.application_id) ?? [];
    collection.push(scorecard.status ?? "unknown");
    scorecardStatus.set(scorecard.application_id, collection);
  }

  const rows: ReportRow[] = [];
  for (const application of maps.applications) {
    const base = baseApplicationRow(application, maps);
    const contact = applicationMeta(application, maps).contact;
    const add = (
      requirementCategory: string,
      requirementName: string,
      requirementStatus: string,
      urgency: string,
      recommendedAction: string,
    ) => {
      rows.push({
        school: base.school,
        application_id: application.id,
        responsible_user: [contact.name, contact.email].filter(Boolean).join(" · "),
        requirement_category: requirementCategory,
        requirement_name: requirementName,
        requirement_status: requirementStatus,
        due_date: "",
        days_until_due: "",
        days_overdue: "",
        urgency,
        recommended_action: recommendedAction,
        portal_link: base.portal_link,
      });
    };

    if (!application.submitted_at) {
      add("Application", "Application submission", "Not submitted", "High", "Contact school or review Acceptd sync status.");
    }
    if (!bookingIds.has(application.id)) {
      add("Scheduling", "Adjudication timeslot", "No booking", "Medium", "Ask school to choose a slot or assign one manually.");
    }
    if ((fileCounts.get(application.id) ?? 0) === 0) {
      add("Documents", "Portal file submissions", "No files", "Medium", "Review required documents for this cycle.");
    }
    const statuses = scorecardStatus.get(application.id) ?? [];
    if (statuses.length > 0 && statuses.some((status) => status !== "submitted")) {
      add("Scoring", "Scorecard completion", statuses.join(", "), "High", "Open Score Completion Report and follow up with assigned panelists.");
    }
    const release = releaseMap.get(application.id);
    if (release && (!release.scores_released_at || !release.feedback_released_at)) {
      add("Results", "Results/feedback release", "Partially released", "Medium", "Review release readiness and publish remaining approved data.");
    }
  }

  return rows;
}

async function loadScheduleReport(
  supabase: SupabaseLike,
  definition: ReportDefinition,
  filters: ReportFilters,
  warnings: string[],
) {
  const slotQuery = () => {
    let query = supabase
      .from("schedule_slots")
      .select("id,cycle_id,title,starts_at,ends_at,location,school_instructions,status")
      .order("starts_at");
    if (filters.cycleId) query = query.eq("cycle_id", filters.cycleId);
    if (filters.dateFrom) query = query.gte("starts_at", `${filters.dateFrom}T00:00:00`);
    if (filters.dateTo) query = query.lte("starts_at", `${filters.dateTo}T23:59:59`);
    return query;
  };

  const [slots, cycles, applications, profiles] = await Promise.all([
    safeFetchPaged<any>(warnings, "Schedule slots", slotQuery),
    safeFetchPaged<CycleRow>(warnings, "Award cycles", () =>
      supabase.from("award_cycles").select("id,name,season_year").order("season_year", { ascending: false }),
    ),
    safeFetchPaged<ApplicationRow>(warnings, "Applications", () =>
      supabase.from("applications").select("id,cycle_id,school_name,production_title,is_archived").order("school_name"),
    ),
    safeFetchPaged<ProfileRow>(warnings, "Profiles", () =>
      supabase.from("profiles").select("id,email,full_name,role,phone_e164").order("full_name"),
    ),
  ]);

  const slotIds = slots.map((slot) => slot.id);
  const [bookings, staff, waitlist] = await Promise.all([
    slotIds.length
      ? safeFetchPaged<any>(warnings, "Schedule bookings", () =>
          supabase
            .from("schedule_school_bookings")
            .select("slot_id,application_id,approval_status,booked_at")
            .in("slot_id", slotIds),
        )
      : Promise.resolve([]),
    slotIds.length
      ? safeFetchPaged<any>(warnings, "Schedule staff", () =>
          supabase
            .from("schedule_slot_staff")
            .select("slot_id,user_id,joined_as,participation_mode")
            .in("slot_id", slotIds),
        )
      : Promise.resolve([]),
    definition.source === "roster"
      ? safeFetchPaged<any>(warnings, "Waitlist", () =>
          supabase
            .from("schedule_slot_waitlist")
            .select("slot_id,cycle_id,application_id,status,queue_rank,created_at,applicant_notes,owner_notes")
            .order("queue_rank"),
        )
      : Promise.resolve([]),
  ]);

  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const appById = new Map(applications.map((application) => [application.id, application]));
  const bookingsBySlot = new Map<string, any[]>();
  const staffBySlot = new Map<string, any[]>();

  for (const booking of bookings) {
    const collection = bookingsBySlot.get(booking.slot_id) ?? [];
    collection.push(booking);
    bookingsBySlot.set(booking.slot_id, collection);
  }
  for (const staffMember of staff) {
    const collection = staffBySlot.get(staffMember.slot_id) ?? [];
    collection.push(staffMember);
    staffBySlot.set(staffMember.slot_id, collection);
  }

  if (definition.source === "roster") {
    const rosterRows: ReportRow[] = staff.map((staffMember) => {
      const slot = slots.find((candidate) => candidate.id === staffMember.slot_id);
      const profile = profileById.get(staffMember.user_id);
      const booking = bookingsBySlot.get(staffMember.slot_id)?.[0];
      const application = booking ? appById.get(booking.application_id) : null;
      return {
        participant: profile?.full_name ?? profile?.email ?? staffMember.user_id,
        user_id: staffMember.user_id,
        email: profile?.email ?? "",
        phone: profile?.phone_e164 ?? "",
        role: staffMember.joined_as ?? profile?.role ?? "",
        status: staffMember.participation_mode ?? "confirmed",
        school: application?.school_name ?? "",
        production: application?.production_title ?? "",
        date: formatDate(slot?.starts_at),
        waitlist_order: "",
        notes: "",
      };
    });

    rosterRows.push(
      ...waitlist.map((entry) => {
        const application = appById.get(entry.application_id);
        return {
          participant: application?.school_name ?? entry.application_id,
          user_id: "",
          email: "",
          phone: "",
          role: "school waitlist",
          status: entry.status,
          school: application?.school_name ?? "",
          production: application?.production_title ?? "",
          date: "",
          waitlist_order: entry.queue_rank ?? "",
          notes: [entry.applicant_notes, entry.owner_notes].filter(Boolean).join(" · "),
        };
      }),
    );
    return rosterRows;
  }

  return slots.flatMap((slot) => {
    const slotBookings = bookingsBySlot.get(slot.id) ?? [null];
    const slotStaff = staffBySlot.get(slot.id) ?? [];
    const adjudicators = slotStaff
      .filter((member) => member.joined_as === "adjudicator")
      .map((member) => profileById.get(member.user_id)?.full_name ?? profileById.get(member.user_id)?.email ?? member.user_id)
      .join("; ");
    const shadows = slotStaff
      .filter((member) => String(member.joined_as).includes("shadow"))
      .map((member) => profileById.get(member.user_id)?.full_name ?? profileById.get(member.user_id)?.email ?? member.user_id)
      .join("; ");
    const understudies = slotStaff
      .filter((member) => String(member.joined_as).includes("understudy"))
      .map((member) => profileById.get(member.user_id)?.full_name ?? profileById.get(member.user_id)?.email ?? member.user_id)
      .join("; ");
    return slotBookings.map((booking) => {
      const application = booking ? appById.get(booking.application_id) : null;
      return {
        cycle: cycleLabel(cycleById.get(slot.cycle_id)),
        date: formatDate(slot.starts_at),
        day_of_week: dayName(slot.starts_at),
        performance_time: timeRange(slot.starts_at, slot.ends_at),
        required_arrival_time: "",
        school: application?.school_name ?? "",
        production: application?.production_title ?? "",
        venue: slot.location ?? "",
        region: "",
        assigned_adjudicators: adjudicators,
        shadows,
        understudies,
        coverage_status: slotStaff.length >= 3 ? "Covered" : `${slotStaff.length} staff assigned`,
        confirmation_status: booking?.approval_status ?? slot.status ?? "",
        notes: slot.school_instructions ?? "",
        portal_link: portalLink("/portal/schedule"),
      };
    });
  });
}

async function loadScoringReport(
  supabase: SupabaseLike,
  definition: ReportDefinition,
  filters: ReportFilters,
  warnings: string[],
) {
  const scorecardQuery = () => {
    let query = supabase
      .from("adjudication_scorecards")
      .select("id,assignment_id,application_id,adjudicator_user_id,rubric_id,status,submitted_at,internal_notes")
      .order("created_at", { ascending: false });

    if (filters.status) query = query.eq("status", filters.status);
    return query;
  };

  const [scorecards, scores, categories, criteria, maps] = await Promise.all([
    safeFetchPaged<any>(warnings, "Scorecards", scorecardQuery),
    safeFetchPaged<any>(warnings, "Scores", () =>
      supabase
        .from("adjudication_scores")
        .select("scorecard_id,criterion_id,score,observation")
        .order("created_at", { ascending: false }),
    ),
    safeFetchPaged<any>(warnings, "Scoring categories", () =>
      supabase
        .from("scoring_categories")
        .select("id,rubric_id,category_key,title,subject_label,sort_order,required")
        .order("sort_order"),
    ),
    safeFetchPaged<any>(warnings, "Scoring criteria", () =>
      supabase
        .from("scoring_criteria")
        .select("id,category_id,criterion_key,title,weight,sort_order")
        .order("sort_order"),
    ),
    loadBaseMaps(supabase, filters, warnings),
  ]);

  const applications = new Map(maps.applications.map((application) => [application.id, application]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const scoresByScorecard = new Map<string, any[]>();
  for (const score of scores) {
    const collection = scoresByScorecard.get(score.scorecard_id) ?? [];
    collection.push(score);
    scoresByScorecard.set(score.scorecard_id, collection);
  }

  const rows: ReportRow[] = [];
  for (const scorecard of scorecards) {
    const application = applications.get(scorecard.application_id);
    if (!application) continue;
    if (filters.cycleId && application.cycle_id !== filters.cycleId) continue;
    if (filters.school && !normalize(application.school_name).includes(normalize(filters.school))) continue;
    const appBase = baseApplicationRow(application, maps);
    const adjudicator = maps.profileById.get(scorecard.adjudicator_user_id);
    const cardScores = scoresByScorecard.get(scorecard.id) ?? [];

    if (definition.source === "score-completion" && cardScores.length === 0) {
      rows.push({
        cycle: appBase.cycle,
        application_id: application.id,
        school: appBase.school,
        production: appBase.production,
        adjudicator_id: scorecard.adjudicator_user_id,
        adjudicator: adjudicator?.full_name ?? adjudicator?.email ?? scorecard.adjudicator_user_id,
        assignment_id: scorecard.assignment_id,
        category: "",
        rubric_category: "",
        criterion: "No criterion scores saved",
        raw_score: "",
        weighted_score: "",
        scorecard_status: scorecard.status,
        submitted_at: formatDateTime(scorecard.submitted_at),
        comment: "",
        owner_notes: scorecard.internal_notes,
        portal_link: portalLink(`/portal/adjudication/${application.id}`),
      });
      continue;
    }

    for (const score of cardScores) {
      const criterion = criterionById.get(score.criterion_id);
      const category = criterion ? categoryById.get(criterion.category_id) : null;
      rows.push({
        cycle: appBase.cycle,
        application_id: application.id,
        school: appBase.school,
        production: appBase.production,
        adjudicator_id: scorecard.adjudicator_user_id,
        adjudicator: adjudicator?.full_name ?? adjudicator?.email ?? scorecard.adjudicator_user_id,
        assignment_id: scorecard.assignment_id,
        category: category?.subject_label ?? category?.category_key ?? "",
        rubric_category: category?.title ?? "",
        criterion: criterion?.title ?? score.criterion_id,
        raw_score: score.score ?? "",
        weighted_score: Number(score.score ?? 0) * Number(criterion?.weight ?? 1),
        scorecard_status: scorecard.status,
        submitted_at: formatDateTime(scorecard.submitted_at),
        comment: score.observation ?? "",
        owner_notes: scorecard.internal_notes,
        portal_link: portalLink(`/portal/adjudication/${application.id}`),
      });
    }
  }

  if (definition.source === "category-rankings" || definition.source === "secondary" || definition.source === "results" || definition.source === "score-history") {
    warnings.push("Ranking/finalist rows use currently stored score rows and preserve Leading Actor and Leading Actress as distinct category labels. If a cycle has a custom secondary formula, apply that formula before publishing official rankings.");
  }

  return rows;
}

async function loadAppealsReport(
  supabase: SupabaseLike,
  filters: ReportFilters,
  warnings: string[],
) {
  const [appeals, maps] = await Promise.all([
    safeFetchPaged<any>(warnings, "Appeals", () =>
      supabase
        .from("appeals")
        .select("id,application_id,submitted_by,appeal_type,explanation,status,resolution,resolved_at,submitted_at,owner_notes,current_eligibility,requested_eligibility")
        .order("submitted_at", { ascending: false }),
    ),
    loadBaseMaps(supabase, filters, warnings),
  ]);
  const applications = new Map(maps.applications.map((application) => [application.id, application]));
  return appeals.flatMap((appeal) => {
    const application = applications.get(appeal.application_id);
    if (!application) return [];
    const base = baseApplicationRow(application, maps);
    const submitter = maps.profileById.get(appeal.submitted_by);
    return [{
      appeal_id: appeal.id,
      cycle: base.cycle,
      school: base.school,
      application_id: appeal.application_id,
      appeal_type: appeal.appeal_type,
      appellant: submitter?.full_name ?? submitter?.email ?? "",
      submitted_at: formatDateTime(appeal.submitted_at),
      status: appeal.status,
      eligibility_impact: [appeal.current_eligibility, appeal.requested_eligibility].filter(Boolean).join(" → "),
      decision: appeal.resolution ?? "",
      decision_date: formatDateTime(appeal.resolved_at),
      internal_notes: appeal.owner_notes ?? appeal.explanation ?? "",
      portal_link: portalLink("/portal/appeals"),
    }];
  });
}

async function loadUsersReport(
  supabase: SupabaseLike,
  _filters: ReportFilters,
  warnings: string[],
) {
  const [profiles, members, applications, digestSettings] = await Promise.all([
    safeFetchPaged<ProfileRow>(warnings, "Profiles", () =>
      supabase
        .from("profiles")
        .select("id,email,full_name,phone_e164,role,active,organization,notification_preferences,force_password_reset,mfa_required")
        .order("full_name"),
    ),
    safeFetchPaged<ApplicationMemberRow>(warnings, "Application members", () =>
      supabase
        .from("application_members")
        .select("application_id,user_id,member_role,can_edit_application,active"),
    ),
    safeFetchPaged<ApplicationRow>(warnings, "Applications", () =>
      supabase
        .from("applications")
        .select("id,school_name,production_title,is_archived")
        .order("school_name"),
    ),
    safeFetchPaged<any>(warnings, "Digest settings", () =>
      supabase
        .from("owner_digest_settings")
        .select("owner_user_id,enabled,delivery_hour,time_zone,recipient_email"),
    ),
  ]);

  const apps = new Map(applications.map((application) => [application.id, application]));
  const digest = new Map(digestSettings.map((setting) => [setting.owner_user_id, setting]));
  const memberships = new Map<string, string[]>();
  for (const member of members) {
    if (!member.active) continue;
    const app = apps.get(member.application_id);
    if (!app) continue;
    const collection = memberships.get(member.user_id) ?? [];
    collection.push(`${app.school_name ?? "Unnamed school"} (${member.member_role === "primary" ? "Primary" : member.can_edit_application ? "Sub-user editor" : "Sub-user view"})`);
    memberships.set(member.user_id, collection);
  }

  return profiles.map((profile) => {
    const setting = digest.get(profile.id);
    return {
      user_id: profile.id,
      name: profile.full_name ?? "",
      email: profile.email ?? "",
      phone: profile.phone_e164 ?? "",
      role: profile.role ?? "",
      school: memberships.get(profile.id)?.join("; ") ?? "",
      organization: profile.organization ?? "",
      associated_applications: memberships.get(profile.id)?.length ?? 0,
      account_status: profile.active ? "Active" : "Inactive",
      mfa_status: profile.mfa_required ? "Required" : "Not required",
      password_reset_status: profile.force_password_reset ? "Reset required" : "Current",
      communication_preferences: JSON.stringify(profile.notification_preferences ?? {}),
      digest_preferences: setting ? `${setting.enabled ? "Enabled" : "Disabled"} · ${setting.delivery_hour}:00 ${setting.time_zone}` : "",
    };
  });
}

async function loadNotificationsReport(
  supabase: SupabaseLike,
  filters: ReportFilters,
  warnings: string[],
) {
  const [notifications, profiles, chatLogs, invoiceLogs] = await Promise.all([
    safeFetchPaged<any>(warnings, "User notifications", () =>
      supabase
        .from("user_notifications")
        .select("id,user_id,notification_type,title,body,href,read_at,created_at,related_application_id")
        .order("created_at", { ascending: false }),
    ),
    safeFetchPaged<ProfileRow>(warnings, "Profiles", () =>
      supabase.from("profiles").select("id,email,full_name,role").order("full_name"),
    ),
    safeFetchPaged<any>(warnings, "Chat email delivery log", () =>
      supabase
        .from("chat_email_delivery_log")
        .select("id,status,recipient_count,detail,created_at")
        .order("created_at", { ascending: false }),
    ),
    safeFetchPaged<any>(warnings, "Invoice delivery log", () =>
      supabase
        .from("invoice_delivery_log")
        .select("id,email_status,chat_status,detail,created_at")
        .order("created_at", { ascending: false }),
    ),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const since = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
  const until = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).getTime() : null;
  const inRange = (value: string) => {
    const time = new Date(value).getTime();
    if (since && time < since) return false;
    if (until && time > until) return false;
    return true;
  };
  return [
    ...notifications.filter((row) => inRange(row.created_at)).map((notification) => {
      const profile = profileById.get(notification.user_id);
      return {
        notification_id: notification.id,
        recipient: profile?.full_name ?? "",
        recipient_email: profile?.email ?? "",
        recipient_role: profile?.role ?? "",
        school: "",
        notification_type: notification.notification_type,
        subject: notification.title,
        delivery_status: notification.read_at ? "Read in app" : "Delivered in app",
        sent_date: formatDateTime(notification.created_at),
        read_status: notification.read_at ? `Read ${formatDateTime(notification.read_at)}` : "Unread",
        portal_link: notification.href ?? "",
      };
    }),
    ...chatLogs.filter((row) => inRange(row.created_at)).map((log) => ({
      notification_id: log.id,
      recipient: "",
      recipient_email: "",
      recipient_role: "",
      school: "",
      notification_type: "chat_email",
      subject: `${log.recipient_count ?? 0} chat recipient(s)`,
      delivery_status: log.status,
      sent_date: formatDateTime(log.created_at),
      read_status: "",
      portal_link: "/portal/chat",
    })),
    ...invoiceLogs.filter((row) => inRange(row.created_at)).map((log) => ({
      notification_id: log.id,
      recipient: "",
      recipient_email: "",
      recipient_role: "",
      school: "",
      notification_type: "invoice_delivery",
      subject: log.detail ?? "Invoice delivery",
      delivery_status: `Email: ${log.email_status ?? "—"} · Chat: ${log.chat_status ?? "—"}`,
      sent_date: formatDateTime(log.created_at),
      read_status: "",
      portal_link: "/portal/admin/billing",
    })),
  ];
}

async function loadChatReport(
  supabase: SupabaseLike,
  filters: ReportFilters,
  warnings: string[],
) {
  const [channels, posts, replies, moderation] = await Promise.all([
    safeFetchPaged<any>(warnings, "Chat channels", () =>
      supabase
        .from("chat_channels")
        .select("id,channel_type,name,application_id,created_at,active")
        .order("created_at", { ascending: false }),
    ),
    safeFetchPaged<any>(warnings, "Chat posts", () =>
      supabase
        .from("chat_posts")
        .select("id,channel_id,author_id,subject,body,created_at,deleted_at,deletion_reason")
        .order("created_at", { ascending: false }),
    ),
    safeFetchPaged<any>(warnings, "Chat replies", () =>
      supabase
        .from("chat_replies")
        .select("id,channel_id,post_id,author_id,body,created_at,deleted_at,deletion_reason")
        .order("created_at", { ascending: false }),
    ),
    safeFetchPaged<any>(warnings, "Chat moderation", () =>
      supabase
        .from("chat_message_moderation_audit")
        .select("message_kind,message_id,deletion_reason,deleted_at")
        .order("deleted_at", { ascending: false }),
    ),
  ]);
  const [profiles, participantRows] = await Promise.all([
    safeFetchPaged<ProfileRow>(warnings, "Profiles", () =>
      supabase.from("profiles").select("id,email,full_name,role").order("full_name"),
    ),
    safeFetchPaged<any>(warnings, "Direct message participants", () =>
      supabase.from("chat_direct_participants").select("channel_id,user_id"),
    ),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const moderationByMessage = new Map(
    moderation.map((entry) => [`${entry.message_kind}:${entry.message_id}`, entry]),
  );
  const participants = new Map<string, string[]>();
  for (const participant of participantRows) {
    const collection = participants.get(participant.channel_id) ?? [];
    const profile = profileById.get(participant.user_id);
    collection.push(profile?.full_name ?? profile?.email ?? participant.user_id);
    participants.set(participant.channel_id, collection);
  }
  const since = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
  const until = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).getTime() : null;
  const inRange = (value: string) => {
    const time = new Date(value).getTime();
    if (since && time < since) return false;
    if (until && time > until) return false;
    return true;
  };
  const normalizeMessage = (message: any, kind: "post" | "reply") => {
    const channel = channelById.get(message.channel_id);
    const author = profileById.get(message.author_id);
    const audit = moderationByMessage.get(`${kind}:${message.id}`);
    return {
      conversation: channel?.name ?? message.channel_id,
      conversation_type: channel?.channel_type ?? "",
      participants: participants.get(message.channel_id)?.join("; ") ?? "",
      message_date: formatDateTime(message.created_at),
      sender: author?.full_name ?? author?.email ?? message.author_id,
      message: kind === "post" ? `${message.subject}\n${message.body}` : message.body,
      tags: "",
      deleted_audit: audit ? `${formatDateTime(audit.deleted_at)} · ${audit.deletion_reason ?? ""}` : message.deleted_at ? `${formatDateTime(message.deleted_at)} · ${message.deletion_reason ?? ""}` : "",
      related_application: channel?.application_id ?? "",
    };
  };
  return [
    ...posts.filter((message) => inRange(message.created_at)).map((message) => normalizeMessage(message, "post")),
    ...replies.filter((message) => inRange(message.created_at)).map((message) => normalizeMessage(message, "reply")),
  ];
}

async function loadDocumentsReport(
  supabase: SupabaseLike,
  filters: ReportFilters,
  warnings: string[],
) {
  const [files, maps] = await Promise.all([
    safeFetchPaged<any>(warnings, "Files", () =>
      supabase
        .from("portal_files")
        .select("id,application_id,original_name,display_name,document_category,reviewer_visible,uploaded_by,created_at,file_notes")
        .order("created_at", { ascending: false }),
    ),
    loadBaseMaps(supabase, filters, warnings),
  ]);
  const applications = new Map(maps.applications.map((application) => [application.id, application]));
  return files.flatMap((file) => {
    const application = applications.get(file.application_id);
    if (!application) return [];
    const uploader = maps.profileById.get(file.uploaded_by);
    const base = baseApplicationRow(application, maps);
    return [{
      document_id: file.id,
      school: base.school,
      application_id: file.application_id,
      document_name: file.display_name ?? file.original_name,
      document_type: file.document_category ?? "",
      uploaded_by: uploader?.full_name ?? uploader?.email ?? "",
      upload_date: formatDateTime(file.created_at),
      visibility: file.reviewer_visible ? "Reviewer visible" : "Owner/school only",
      owner_only_status: file.reviewer_visible ? "Shared" : "Owner/school only",
      review_notes: file.file_notes ?? "",
      portal_link: portalLink(`/portal/applications/${file.application_id}`),
    }];
  });
}

async function loadAuditReport(
  supabase: SupabaseLike,
  _filters: ReportFilters,
  warnings: string[],
) {
  const [activities, profiles, applications] = await Promise.all([
    safeFetchPaged<any>(warnings, "Owner activity log", () =>
      supabase
        .from("owner_activity_log")
        .select("id,created_at,activity_type,title,detail,actor_id,application_id,metadata")
        .order("created_at", { ascending: false }),
    ),
    safeFetchPaged<ProfileRow>(warnings, "Profiles", () =>
      supabase.from("profiles").select("id,email,full_name,role").order("full_name"),
    ),
    safeFetchPaged<ApplicationRow>(warnings, "Applications", () =>
      supabase.from("applications").select("id,school_name,production_title").order("school_name"),
    ),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  return activities.map((activity) => {
    const actor = profileById.get(activity.actor_id);
    const application = applicationById.get(activity.application_id);
    return {
      audit_id: activity.id,
      timestamp: formatDateTime(activity.created_at),
      user: actor?.full_name ?? actor?.email ?? activity.actor_id ?? "System",
      user_role: actor?.role ?? "",
      action: activity.activity_type ?? activity.title,
      record_type: activity.application_id ? "application" : "",
      record_id: activity.application_id ?? "",
      school: application?.school_name ?? "",
      previous_value: "",
      new_value: JSON.stringify(activity.metadata ?? {}),
      reason: activity.detail ?? "",
    };
  });
}

async function loadCycleSummary(
  supabase: SupabaseLike,
  filters: ReportFilters,
  warnings: string[],
) {
  const maps = await loadBaseMaps(supabase, filters, warnings);
  const applicationIds = maps.applications.map((application) => application.id);
  const [scorecards, appeals, bookings, waitlist, releases, notificationFailures] = await Promise.all([
    applicationIds.length
      ? safeFetchPaged<any>(warnings, "Scorecards", () =>
          supabase
            .from("adjudication_scorecards")
            .select("id,application_id,status")
            .in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    applicationIds.length
      ? safeFetchPaged<any>(warnings, "Appeals", () =>
          supabase.from("appeals").select("id,application_id,status").in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    applicationIds.length
      ? safeFetchPaged<any>(warnings, "Bookings", () =>
          supabase.from("schedule_school_bookings").select("id,application_id,approval_status").in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    safeFetchPaged<any>(warnings, "Waitlist", () =>
      supabase.from("schedule_slot_waitlist").select("id,status").in("status", ["waiting", "offered"]),
    ),
    applicationIds.length
      ? safeFetchPaged<any>(warnings, "Releases", () =>
          supabase.from("adjudication_releases").select("id,application_id,scores_released_at,feedback_released_at").in("application_id", applicationIds),
        )
      : Promise.resolve([]),
    safeFetchPaged<any>(warnings, "Notification failures", () =>
      supabase
        .from("chat_email_delivery_log")
        .select("id,status")
        .eq("status", "failed"),
    ),
  ]);

  const completedScorecards = scorecards.filter((card) => card.status === "submitted").length;
  const submittedApps = maps.applications.filter((application) => Boolean(application.submitted_at)).length;
  const rows = [
    ["Applications in scope", maps.applications.length, "", "Filtered by selected cycle/status/archive settings."],
    ["Submitted applications", submittedApps, "", "Uses portal submitted_at field."],
    ["Scheduled schools", new Set(bookings.map((booking) => booking.application_id)).size, "", "Any school booking counts."],
    ["Pending slot approvals", bookings.filter((booking) => booking.approval_status === "pending").length, "", "Bookings awaiting owner approval."],
    ["Active waitlist entries", waitlist.length, "", "Status waiting/offered."],
    ["Scorecards completed", completedScorecards, "", "Scorecard status submitted."],
    ["Scorecards incomplete", Math.max(scorecards.length - completedScorecards, 0), "", "All non-submitted scorecards."],
    ["Open appeals", appeals.filter((appeal) => !["resolved", "denied", "approved"].includes(appeal.status)).length, "", "Status is not resolved/denied/approved."],
    ["Release records", releases.length, "", "Applications with adjudication release rows."],
    ["Chat email failures", notificationFailures.length, "", "Delivery log status failed."],
  ] as const;

  return rows.map(([metric, value, change, methodologyNote]) => ({
    metric,
    value,
    change,
    methodology_note: methodologyNote,
  }));
}

function sortRows(rows: ReportRow[], filters: ReportFilters, columns: ReportColumn[]) {
  const sortKey = filters.sort || columns[0]?.key || "";
  if (!sortKey) return rows;
  return [...rows].sort((left, right) => {
    const leftValue = left[sortKey];
    const rightValue = right[sortKey];
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    let result: number;
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      result = leftNumber - rightNumber;
    } else {
      result = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    return filters.direction === "desc" ? -result : result;
  });
}

export async function loadReport(
  supabase: SupabaseLike,
  reportId: string,
  filters: ReportFilters,
): Promise<LoadedReport> {
  const definition = findReportDefinition(reportId);
  if (!definition) throw new Error("Unknown report.");
  if (!definition.formats.includes(filters.format)) {
    filters.format = definition.formats[0] ?? "pdf";
  }
  if (filters.variant === "external" && !definition.supportsExternalVariant) {
    filters.variant = "internal";
  }

  const warnings: string[] = [];
  let rows: ReportRow[];

  switch (definition.source) {
    case "cycle-summary":
      rows = await loadCycleSummary(supabase, filters, warnings);
      break;
    case "applications":
    case "contacts":
    case "results":
    case "participation-history":
    case "impact":
      rows = await loadApplicationsReport(supabase, definition, filters, warnings);
      break;
    case "missing-requirements":
      rows = await loadMissingRequirementsReport(supabase, filters, warnings);
      break;
    case "schedule":
    case "coverage":
    case "roster":
      rows = await loadScheduleReport(supabase, definition, filters, warnings);
      break;
    case "score-completion":
    case "raw-scores":
    case "school-score-summary":
    case "category-rankings":
    case "score-variance":
    case "adjudicator-profile":
    case "comments":
    case "secondary":
    case "score-history":
      rows = await loadScoringReport(supabase, definition, filters, warnings);
      break;
    case "appeals":
      rows = await loadAppealsReport(supabase, filters, warnings);
      break;
    case "users":
      rows = await loadUsersReport(supabase, filters, warnings);
      break;
    case "notifications":
      rows = await loadNotificationsReport(supabase, filters, warnings);
      break;
    case "chat":
      rows = await loadChatReport(supabase, filters, warnings);
      break;
    case "documents":
      rows = await loadDocumentsReport(supabase, filters, warnings);
      break;
    case "audit":
      rows = await loadAuditReport(supabase, filters, warnings);
      break;
  }

  const columns = visibleColumnsForVariant(definition, filters);
  return {
    definition,
    columns,
    rows: sortRows(rows, filters, columns),
    filters,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

import type { AppRole } from "@/lib/types";

export type ReportFormat = "pdf" | "csv" | "zip";
export type ReportVariant = "internal" | "external";
export type ReportCategory =
  | "Executive"
  | "Applications"
  | "Scheduling"
  | "Adjudication"
  | "Scoring"
  | "Secondary process"
  | "Results"
  | "Appeals"
  | "Users"
  | "Communications"
  | "Documents"
  | "Audit"
  | "Historical analysis"
  | "Impact reporting";

export type ReportSource =
  | "cycle-summary"
  | "applications"
  | "missing-requirements"
  | "contacts"
  | "schedule"
  | "coverage"
  | "roster"
  | "score-completion"
  | "raw-scores"
  | "school-score-summary"
  | "category-rankings"
  | "score-variance"
  | "adjudicator-profile"
  | "comments"
  | "secondary"
  | "results"
  | "appeals"
  | "users"
  | "notifications"
  | "chat"
  | "documents"
  | "audit"
  | "participation-history"
  | "score-history"
  | "impact";

export type ReportColumn = {
  key: string;
  label: string;
  internalOnly?: boolean;
  contactInfo?: boolean;
  adjudicatorIdentity?: boolean;
  protectedScore?: boolean;
};

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  category: ReportCategory;
  source: ReportSource;
  formats: ReportFormat[];
  allowedRoles: AppRole[];
  columns: ReportColumn[];
  defaultSort?: string;
  supportsBatch?: boolean;
  supportsScheduling?: boolean;
  supportsExternalVariant?: boolean;
  confidentialityNote?: string;
};

const ownerOnly: AppRole[] = ["owner"];

const baseApplicationColumns: ReportColumn[] = [
  { key: "application_id", label: "Application ID" },
  { key: "cycle", label: "Award Cycle" },
  { key: "school", label: "School" },
  { key: "school_type", label: "School Type" },
  { key: "selected_track", label: "Selected Track" },
  { key: "region", label: "Region" },
  { key: "district", label: "District" },
  { key: "production", label: "Production" },
  { key: "status", label: "Application Status" },
  { key: "eligibility_status", label: "Eligibility Status" },
  { key: "results_release_status", label: "Results Release Status" },
  { key: "submitted_at", label: "Submitted At" },
  { key: "updated_at", label: "Last Updated" },
  { key: "primary_applicant", label: "Primary Applicant", contactInfo: true },
  { key: "primary_email", label: "Primary Email", contactInfo: true },
  { key: "primary_phone", label: "Primary Phone", contactInfo: true },
  { key: "additional_school_users", label: "Additional School Users", contactInfo: true },
  { key: "owner_notes", label: "Owner Notes", internalOnly: true },
  { key: "portal_link", label: "Portal Link" },
];

const scheduleColumns: ReportColumn[] = [
  { key: "cycle", label: "Award Cycle" },
  { key: "date", label: "Date" },
  { key: "day_of_week", label: "Day Of Week" },
  { key: "performance_time", label: "Performance Time" },
  { key: "required_arrival_time", label: "Required Arrival Time" },
  { key: "school", label: "School" },
  { key: "production", label: "Production" },
  { key: "venue", label: "Venue" },
  { key: "region", label: "Region" },
  { key: "assigned_adjudicators", label: "Assigned Adjudicators", adjudicatorIdentity: true },
  { key: "shadows", label: "Shadows", adjudicatorIdentity: true },
  { key: "understudies", label: "Understudies", adjudicatorIdentity: true },
  { key: "coverage_status", label: "Coverage Status" },
  { key: "confirmation_status", label: "Confirmation Status" },
  { key: "notes", label: "Schedule Notes", internalOnly: true },
  { key: "portal_link", label: "Portal Link" },
];

const scoringColumns: ReportColumn[] = [
  { key: "cycle", label: "Award Cycle" },
  { key: "application_id", label: "Application ID" },
  { key: "school", label: "School" },
  { key: "production", label: "Production" },
  { key: "adjudicator_id", label: "Adjudicator User ID", adjudicatorIdentity: true },
  { key: "adjudicator", label: "Adjudicator", adjudicatorIdentity: true },
  { key: "assignment_id", label: "Assignment ID" },
  { key: "category", label: "Award Category" },
  { key: "rubric_category", label: "Rubric Category" },
  { key: "criterion", label: "Rubric Criterion" },
  { key: "raw_score", label: "Raw Score", protectedScore: true },
  { key: "weighted_score", label: "Weighted Score", protectedScore: true },
  { key: "scorecard_status", label: "Scorecard Status" },
  { key: "submitted_at", label: "Submitted At" },
  { key: "comment", label: "Comment", protectedScore: true },
  { key: "owner_notes", label: "Owner Notes", internalOnly: true },
  { key: "portal_link", label: "Portal Link" },
];

const appealColumns: ReportColumn[] = [
  { key: "appeal_id", label: "Appeal ID" },
  { key: "cycle", label: "Cycle" },
  { key: "school", label: "School" },
  { key: "application_id", label: "Application ID" },
  { key: "appeal_type", label: "Appeal Type" },
  { key: "appellant", label: "Appellant", contactInfo: true },
  { key: "submitted_at", label: "Submitted At" },
  { key: "status", label: "Status" },
  { key: "eligibility_impact", label: "Eligibility Impact" },
  { key: "decision", label: "Decision" },
  { key: "decision_date", label: "Decision Date" },
  { key: "internal_notes", label: "Internal Notes", internalOnly: true },
  { key: "portal_link", label: "Direct Appeal Link" },
];

const userColumns: ReportColumn[] = [
  { key: "user_id", label: "User ID" },
  { key: "name", label: "Name", contactInfo: true },
  { key: "email", label: "Email", contactInfo: true },
  { key: "phone", label: "Phone", contactInfo: true },
  { key: "role", label: "Role" },
  { key: "school", label: "School" },
  { key: "organization", label: "Organization" },
  { key: "associated_applications", label: "Associated Applications" },
  { key: "account_status", label: "Account Status" },
  { key: "mfa_status", label: "MFA Status" },
  { key: "password_reset_status", label: "Password Reset Status" },
  { key: "communication_preferences", label: "Communication Preferences" },
  { key: "digest_preferences", label: "Digest Preferences" },
];

function report(
  id: string,
  title: string,
  category: ReportCategory,
  source: ReportSource,
  columns: ReportColumn[],
  description: string,
  extra: Partial<ReportDefinition> = {},
): ReportDefinition {
  return {
    id,
    title,
    category,
    source,
    columns,
    description,
    allowedRoles: ownerOnly,
    formats: ["pdf", "csv"],
    supportsScheduling: true,
    supportsExternalVariant: true,
    ...extra,
  };
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  report("cycle-executive-summary", "Cycle Executive Summary", "Executive", "cycle-summary", [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value" },
    { key: "change", label: "Change Since Previous Digest" },
    { key: "methodology_note", label: "Methodology Note", internalOnly: true },
  ], "Executive-ready cycle snapshot with participation, scoring, scheduling, appeals, release, and methodology notes."),
  report("application-master", "Application Master Report", "Applications", "applications", baseApplicationColumns, "One record per school application with eligibility, scheduling, release, communication, and account context."),
  report("missing-requirements-deadlines", "Missing Requirements and Approaching Deadlines", "Applications", "missing-requirements", [
    { key: "school", label: "School" },
    { key: "application_id", label: "Application ID" },
    { key: "responsible_user", label: "Responsible User", contactInfo: true },
    { key: "requirement_category", label: "Requirement Category" },
    { key: "requirement_name", label: "Requirement Name" },
    { key: "requirement_status", label: "Requirement Status" },
    { key: "due_date", label: "Due Date" },
    { key: "days_until_due", label: "Days Until Due" },
    { key: "days_overdue", label: "Days Overdue" },
    { key: "urgency", label: "Urgency" },
    { key: "recommended_action", label: "Recommended Next Action" },
    { key: "portal_link", label: "Direct Link" },
  ], "Exception report for incomplete sections, unsigned agreements, missing files, scorecards, comments, and release approvals."),
  report("school-contact-directory", "School Contact Directory", "Applications", "contacts", [
    ...baseApplicationColumns.filter((column) => ["cycle","school","production","school_type","region","primary_applicant","primary_email","primary_phone","additional_school_users"].includes(column.key)),
    { key: "principal", label: "Principal / Administrator", contactInfo: true },
    { key: "theatre_director", label: "Theatre Director", contactInfo: true },
    { key: "music_director", label: "Musical Director", contactInfo: true },
    { key: "choreographer", label: "Choreographer", contactInfo: true },
    { key: "technical_contact", label: "Technical Contact", contactInfo: true },
    { key: "venue", label: "Venue" },
    { key: "adjudication_date", label: "Adjudication Date" },
  ], "Mail-merge friendly contact list and compact adjudication contact book."),
  report("adjudication-schedule-master", "Adjudication Schedule Master", "Scheduling", "schedule", scheduleColumns, "Full schedule export for cycle, date, school, adjudicator, and coverage planning."),
  report("adjudicator-itinerary", "Adjudicator Itinerary", "Scheduling", "schedule", scheduleColumns, "Personalized itinerary packets for assigned adjudicators.", { formats: ["pdf"], supportsBatch: true }),
  report("assignment-coverage-conflicts", "Assignment Coverage and Conflict Report", "Scheduling", "coverage", scheduleColumns, "Coverage status, assignment exceptions, conflicts, and recommended actions."),
  report("shadow-understudy-waitlist-roster", "Shadow, Understudy, and Waitlist Roster", "Scheduling", "roster", [
    { key: "participant", label: "Participant", contactInfo: true },
    { key: "user_id", label: "User ID" },
    { key: "email", label: "Email", contactInfo: true },
    { key: "phone", label: "Phone", contactInfo: true },
    { key: "role", label: "Role" },
    { key: "status", label: "Status" },
    { key: "school", label: "School" },
    { key: "production", label: "Production" },
    { key: "date", label: "Date" },
    { key: "waitlist_order", label: "Waitlist Order" },
    { key: "notes", label: "Notes", internalOnly: true },
  ], "Roster for shadows, understudies, group-shadow participation, and waitlist capacity."),
  report("score-completion", "Score Completion Report", "Scoring", "score-completion", scoringColumns, "Completion status, missing scores/comments, deadlines, reopened scorecards, and owner review readiness."),
  report("detailed-raw-score-export", "Detailed Raw Score Export", "Scoring", "raw-scores", scoringColumns, "Criterion-level score export preserving quarter-point values and stable record IDs.", { formats: ["csv"] }),
  report("school-adjudication-report", "School Adjudication Report", "Scoring", "school-score-summary", scoringColumns, "Polished school-level adjudication report with internal, advisory, and school-facing variants.", { formats: ["pdf"], supportsBatch: true }),
  report("category-rankings", "Category Rankings Report", "Scoring", "category-rankings", scoringColumns, "Award-category ranking report. Leading Actor and Leading Actress remain separate datasets."),
  report("score-variance-outliers", "Score Variance and Outlier Report", "Scoring", "score-variance", scoringColumns, "Statistical and operational scoring variance review without implying misconduct."),
  report("adjudicator-scoring-profile", "Adjudicator Scoring Profile", "Scoring", "adjudicator-profile", scoringColumns, "Restricted adjudicator scoring profile and consistency analysis.", {
    supportsExternalVariant: false,
    confidentialityNote: "Owner-only. Contains protected adjudicator identity and scoring behavior information.",
  }),
  report("comment-review", "Comment Review Report", "Scoring", "comments", scoringColumns, "Printable review layout for missing, short, duplicate, copied, flagged, and release-blocking comments."),
  report("secondary-audition-candidates", "Secondary Audition Candidate Report", "Secondary process", "secondary", scoringColumns, "Candidate report using the configured cycle scoring formula; Leading Actor and Leading Actress are separated."),
  report("finalist-packet", "Finalist Packet", "Secondary process", "secondary", scoringColumns, "Candidate packet with submitted materials, scores, availability, and QR/direct links.", { formats: ["pdf"], supportsBatch: true }),
  report("rank-movement", "Rank Movement Report", "Secondary process", "secondary", scoringColumns, "Shows how secondary-process components changed ranks by category using applicable cycle weights."),
  report("results-release-readiness", "Results Release Readiness Report", "Results", "results", baseApplicationColumns, "School-by-school and category-by-category release readiness and blocking reasons."),
  report("award-results-book", "Award Results Book", "Results", "results", [
    { key: "cycle", label: "Cycle" },
    { key: "category", label: "Category" },
    { key: "candidate", label: "Candidate" },
    { key: "school", label: "School" },
    { key: "production", label: "Production" },
    { key: "role", label: "Role" },
    { key: "result_status", label: "Result Status" },
    { key: "release_status", label: "Release Status" },
  ], "Official results publication with configurable proof, public, winners-only, and archival versions.", { formats: ["pdf"], supportsBatch: true }),
  report("results-master-export", "Results Master Export", "Results", "results", scoringColumns, "Master results CSV with stable IDs, ranks, statuses, release dates, and pronunciation fields.", { formats: ["csv"] }),
  report("appeals-register", "Appeals Register", "Appeals", "appeals", appealColumns, "Appeal register with review status, decisions, notification status, and audit trail."),
  report("appeal-case-packet", "Appeal Case Packet", "Appeals", "appeals", appealColumns, "One packet per appeal with narrative, evidence, timeline, review notes, and decision.", { formats: ["pdf"], supportsBatch: true }),
  report("user-access", "User and Access Report", "Users", "users", userColumns, "User access, school-team membership, MFA/reset state, duplicate indicators, and digest preferences."),
  report("notification-communication-log", "Notification and Communication Log", "Communications", "notifications", [
    { key: "notification_id", label: "Notification ID" },
    { key: "recipient", label: "Recipient", contactInfo: true },
    { key: "recipient_email", label: "Recipient Email", contactInfo: true },
    { key: "recipient_role", label: "Recipient Role" },
    { key: "school", label: "School" },
    { key: "notification_type", label: "Notification Type" },
    { key: "subject", label: "Subject" },
    { key: "delivery_status", label: "Delivery Status" },
    { key: "sent_date", label: "Sent Date" },
    { key: "read_status", label: "Read Status" },
    { key: "portal_link", label: "Portal Link" },
  ], "In-app, email, delivery, retry, bounce/failure, and communication audit log."),
  report("chat-support-activity", "Chat and Support Activity Report", "Communications", "chat", [
    { key: "conversation", label: "Conversation" },
    { key: "conversation_type", label: "Conversation Type" },
    { key: "participants", label: "Participants", contactInfo: true },
    { key: "message_date", label: "Message Date" },
    { key: "sender", label: "Sender", contactInfo: true },
    { key: "message", label: "Message" },
    { key: "tags", label: "Tags" },
    { key: "deleted_audit", label: "Deleted Message Audit", internalOnly: true },
    { key: "related_application", label: "Related Application" },
  ], "Restricted operational support and dispute-resolution chat activity export."),
  report("document-submission-register", "Document Submission Register", "Documents", "documents", [
    { key: "document_id", label: "Document ID" },
    { key: "school", label: "School" },
    { key: "application_id", label: "Application ID" },
    { key: "document_name", label: "Document Name" },
    { key: "document_type", label: "Document Type" },
    { key: "uploaded_by", label: "Uploaded By", contactInfo: true },
    { key: "upload_date", label: "Upload Date" },
    { key: "visibility", label: "Visibility" },
    { key: "owner_only_status", label: "Owner-only Status" },
    { key: "review_notes", label: "Review Notes", internalOnly: true },
    { key: "portal_link", label: "Document Link" },
  ], "Submission, visibility, review, missing/superseded status, and direct document links."),
  report("administrative-audit-log", "Administrative Audit Log", "Audit", "audit", [
    { key: "audit_id", label: "Audit ID" },
    { key: "timestamp", label: "Timestamp" },
    { key: "user", label: "User", contactInfo: true },
    { key: "user_role", label: "User Role" },
    { key: "action", label: "Action" },
    { key: "record_type", label: "Record Type" },
    { key: "record_id", label: "Record ID" },
    { key: "school", label: "School" },
    { key: "previous_value", label: "Previous Value", internalOnly: true },
    { key: "new_value", label: "New Value", internalOnly: true },
    { key: "reason", label: "Reason", internalOnly: true },
  ], "Administrative changes, report generation, bulk actions, deletes, releases, score edits, and notifications.", { formats: ["csv", "pdf"] }),
  report("multi-year-participation", "Multi-Year Participation Report", "Historical analysis", "participation-history", baseApplicationColumns, "Participation, retention, capacity constraints, waitlists, regions, school types, and methodology notes."),
  report("multi-year-score-analysis", "Multi-Year Score Analysis", "Historical analysis", "score-history", scoringColumns, "Comparable-year scoring analysis with methodology warnings; Leading Actor and Leading Actress remain separate."),
  report("deidentified-impact-dataset", "De-Identified Program Impact Dataset", "Impact reporting", "impact", [
    { key: "cycle", label: "Cycle" },
    { key: "anonymous_school_id", label: "Anonymous School ID" },
    { key: "school_characteristics", label: "School Characteristics" },
    { key: "region", label: "Region" },
    { key: "school_type", label: "School Type" },
    { key: "participation_history", label: "Participation History" },
    { key: "application_status", label: "Application Status" },
    { key: "adjudication_completion", label: "Adjudication Completion" },
    { key: "advancement", label: "Advancement" },
    { key: "capacity_indicators", label: "Capacity Indicators" },
    { key: "methodology_indicators", label: "Methodology Indicators" },
    { key: "record_quality_flags", label: "Record Quality Flags" },
  ], "De-identified analytical dataset for future program impact reporting.", { formats: ["csv"], supportsExternalVariant: false }),
];

export const REPORT_CATEGORIES = [
  ...new Set(REPORT_DEFINITIONS.map((reportDefinition) => reportDefinition.category)),
];

export function findReportDefinition(reportId: string) {
  return REPORT_DEFINITIONS.find((reportDefinition) => reportDefinition.id === reportId);
}

export function visibleColumnsForVariant(
  definition: ReportDefinition,
  options: {
    variant: ReportVariant;
    includeInternalNotes: boolean;
    includeContactInfo: boolean;
    includeAdjudicatorIdentities: boolean;
    includeProtectedScores: boolean;
  },
) {
  return definition.columns.filter((column) => {
    if (options.variant === "external" && column.internalOnly) return false;
    if (column.internalOnly && !options.includeInternalNotes) return false;
    if (column.contactInfo && !options.includeContactInfo) return false;
    if (column.adjudicatorIdentity && !options.includeAdjudicatorIdentities) return false;
    if (column.protectedScore && !options.includeProtectedScores) return false;
    return true;
  });
}

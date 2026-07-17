export type AppRole =
  | "applicant"
  | "adjudicator"
  | "advisory_member"
  | "owner";

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "complete"
  | "withdrawn";

export type FormVersionStatus = "draft" | "published" | "archived";

export type ApplicationQuestionType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "multi_select"
  | "radio"
  | "checkbox"
  | "yes_no"
  | "signature_acknowledgement"
  | "content";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  active: boolean;
};

export type AwardCycle = {
  id: string;
  name: string;
  season_year: string;
  opens_at: string | null;
  closes_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Application = {
  id: string;
  cycle_id: string;
  form_version_id: string | null;
  applicant_user_id: string;
  school_name: string;
  production_title: string | null;
  status: ApplicationStatus;
  submitted_at: string | null;
  form_version: number;
  form_data: Record<string, unknown>;
  owner_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationFormVersion = {
  id: string;
  cycle_id: string;
  version_number: number;
  name: string;
  status: FormVersionStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationSection = {
  id: string;
  form_version_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type QuestionSettings = {
  external_url?: string;
  external_label?: string;
  acknowledgement_label?: string;
  placeholder?: string;
};

export type ApplicationQuestion = {
  id: string;
  form_version_id: string;
  section_id: string;
  question_key: string;
  label: string;
  description: string | null;
  question_type: ApplicationQuestionType;
  required: boolean;
  options: string[];
  settings: QuestionSettings;
  visibility_rule: Record<string, unknown> | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ApplicationAnswer = {
  id: string;
  application_id: string;
  question_id: string;
  value: unknown;
  updated_at: string;
};

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

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  active: boolean;
};

export type Application = {
  id: string;
  cycle_id: string;
  applicant_user_id: string;
  school_name: string;
  production_title: string | null;
  status: ApplicationStatus;
  submitted_at: string | null;
  form_data: Record<string, unknown>;
  owner_notes: string | null;
  created_at: string;
  updated_at: string;
};

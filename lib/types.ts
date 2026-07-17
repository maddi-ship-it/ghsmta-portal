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

export type ProgramType =
  | "directors"
  | "scholarship"
  | "mentorship"
  | "student_program"
  | "adjudicator"
  | "other";

export type ProgramStatus = "draft" | "open" | "closed" | "archived";

export type StageProgressStatus =
  | "locked"
  | "available"
  | "in_progress"
  | "submitted"
  | "complete"
  | "reopened";

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
  cycle_key: string;
  name: string;
  season_year: string;
  program_type: ProgramType;
  description: string | null;
  status: ProgramStatus;
  opens_at: string | null;
  closes_at: string | null;
  is_active: boolean;
  cloned_from_cycle_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Application = {
  id: string;
  cycle_id: string;
  form_version_id: string | null;
  applicant_user_id: string | null;
  school_name: string;
  production_title: string | null;
  status: ApplicationStatus;
  submitted_at: string | null;
  form_version: number;
  form_data: Record<string, unknown>;
  owner_notes: string | null;
  current_stage_id: string | null;
  external_applicant_name: string | null;
  external_applicant_email: string | null;
  source_system: string | null;
  source_record_id: string | null;
  source_stage: string | null;
  is_archived: boolean;
  archived_payload: Record<string, unknown>;
  cloned_from_application_id: string | null;
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

export type ApplicationStage = {
  id: string;
  form_version_id: string;
  stage_key: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_initial: boolean;
  applicant_visible: boolean;
  opens_at: string | null;
  closes_at: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ApplicationStageProgress = {
  id: string;
  application_id: string;
  stage_id: string;
  status: StageProgressStatus;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  reopened_at: string | null;
  owner_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationSection = {
  id: string;
  form_version_id: string;
  stage_id: string | null;
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
  source_column_index: number | null;
  source_label: string | null;
  imported: boolean;
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

export type ScoringRubric = {
  id: string;
  cycle_id: string;
  name: string;
  version_number: number;
  status: "draft" | "published" | "archived";
  score_min: number;
  score_max: number;
  source_system: string | null;
  created_at: string;
  updated_at: string;
};

export type ScoringScaleLevel = {
  id: string;
  rubric_id: string;
  score: number;
  label: string;
  description: string | null;
  sort_order: number;
};

export type ScoringCategory = {
  id: string;
  rubric_id: string;
  category_key: string;
  title: string;
  description: string | null;
  guidance: string | null;
  subject_label: string | null;
  sort_order: number;
  required: boolean;
  allow_not_applicable: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ScoringCriterion = {
  id: string;
  category_id: string;
  criterion_key: string;
  title: string;
  description: string | null;
  weight: number;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdjudicatorAssignment = {
  id: string;
  application_id: string;
  adjudicator_user_id: string;
  assigned_by: string | null;
  assigned_at: string;
  status: "assigned" | "in_progress" | "submitted" | "reopened" | "complete";
  due_at: string | null;
  internal_notes: string | null;
};

export type AdjudicationScorecard = {
  id: string;
  assignment_id: string;
  application_id: string;
  adjudicator_user_id: string;
  rubric_id: string;
  status: "draft" | "submitted" | "reopened" | "locked";
  submitted_at: string | null;
  reopened_at: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AdjudicationScore = {
  id: string;
  scorecard_id: string;
  criterion_id: string;
  score: number | null;
  observation: string | null;
  created_at: string;
  updated_at: string;
};

export type AdjudicationCategoryComment = {
  id: string;
  scorecard_id: string;
  category_id: string;
  subject_name: string | null;
  is_applicable: boolean;
  not_applicable_reason: string | null;
  successes: string | null;
  success_examples: string | null;
  growth_areas: string | null;
  growth_examples: string | null;
  private_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AiPromptTemplate = {
  id: string;
  cycle_id: string | null;
  template_key: string;
  name: string;
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  active: boolean;
  version_number: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdjudicationPanelFeedback = {
  id: string;
  application_id: string;
  category_id: string;
  status: "draft" | "generated" | "approved";
  generated_comment: string | null;
  final_comment: string | null;
  prompt_template_id: string | null;
  prompt_snapshot: string | null;
  model: string | null;
  openai_request_id: string | null;
  generated_by: string | null;
  generated_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReleasedScoreSummary = {
  category_id: string;
  title: string;
  sort_order: number;
  average_score: number | null;
  score_count: number;
};

export type ReleasedFeedbackSummary = {
  category_id: string;
  title: string;
  sort_order: number;
  final_comment: string;
};

export type AdjudicationRelease = {
  id: string;
  application_id: string;
  scores_released_at: string | null;
  feedback_released_at: string | null;
  score_snapshot: ReleasedScoreSummary[];
  feedback_snapshot: ReleasedFeedbackSummary[];
  release_notes: string | null;
  released_by: string | null;
  created_at: string;
  updated_at: string;
};

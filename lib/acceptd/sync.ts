import { createHash } from "node:crypto";

import { createAcceptdClient } from "@/lib/acceptd/client";
import {
  answerValue,
  normalizeAcceptdApplication,
  portalQuestionType,
  type AcceptdQuestionDefinition,
  type NormalizedAcceptdApplication,
} from "@/lib/acceptd/model";
import { createAdminClient } from "@/lib/supabase/admin";

export type AcceptdSyncTrigger = "manual" | "webhook" | "cron" | "schema";

type ProgramMapping = {
  id: string;
  acceptd_program_id: number;
  acceptd_program_name: string;
  portal_cycle_id: string;
  portal_form_version_id: string;
  schema_source_program_ids: number[];
  enabled: boolean;
  sync_drafts: boolean;
};

type SyncResult = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  applicationsSeen: number;
  applicationsSynced: number;
  applicationsUnmapped: number;
  applicationsFailed: number;
  questionsDiscovered: number;
};

export class AcceptdSyncBusyError extends Error {
  constructor() {
    super("An Acceptd sync is already running for this program.");
    this.name = "AcceptdSyncBusyError";
  }
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function fullName(application: NormalizedAcceptdApplication) {
  return [application.firstName, application.lastName].filter(Boolean).join(" ") || null;
}

function payloadHash(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function sourceManagedSettings(mapping: ProgramMapping, question: AcceptdQuestionDefinition) {
  return {
    source_managed: true,
    source_system: "acceptd-api-v2",
    acceptd_program_id: mapping.acceptd_program_id,
    acceptd_question_id: question.id,
    acceptd_question_type: question.type,
    acceptd_archived: question.archived,
  };
}

async function mappingById(mappingId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("acceptd_program_mappings")
    .select("id,acceptd_program_id,acceptd_program_name,portal_cycle_id,portal_form_version_id,schema_source_program_ids,enabled,sync_drafts")
    .eq("id", mappingId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Acceptd program mapping not found.");
  return data as ProgramMapping;
}

async function mappingByProgramId(programId: number) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("acceptd_program_mappings")
    .select("id,acceptd_program_id,acceptd_program_name,portal_cycle_id,portal_form_version_id,schema_source_program_ids,enabled,sync_drafts")
    .eq("acceptd_program_id", programId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProgramMapping | null) ?? null;
}

async function startRun(mappingId: string | null, triggerSource: AcceptdSyncTrigger) {
  const admin = createAdminClient();
  if (mappingId) {
    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_acceptd_program_sync",
      { p_mapping_id: mappingId },
    );
    if (claimError) throw new Error(claimError.message);
    if (!claimed) throw new AcceptdSyncBusyError();
  }
  const { data, error } = await admin
    .from("acceptd_sync_runs")
    .insert({ program_mapping_id: mappingId, trigger_source: triggerSource, status: "running" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create Acceptd sync run.");
  return String(data.id);
}

async function finishRun(
  mappingId: string | null,
  runId: string,
  result: Omit<SyncResult, "runId">,
  detail: Record<string, unknown> = {},
) {
  const admin = createAdminClient();
  const finishedAt = new Date().toISOString();
  const error = result.status === "failed" && typeof detail.error === "string" ? detail.error : null;
  const { error: runError } = await admin
    .from("acceptd_sync_runs")
    .update({
      status: result.status,
      applications_seen: result.applicationsSeen,
      applications_synced: result.applicationsSynced,
      applications_unmapped: result.applicationsUnmapped,
      applications_failed: result.applicationsFailed,
      questions_discovered: result.questionsDiscovered,
      detail,
      error,
      finished_at: finishedAt,
    })
    .eq("id", runId);
  if (runError) throw new Error(runError.message);
  if (mappingId) {
    const { error: mappingError } = await admin
      .from("acceptd_program_mappings")
      .update({ last_sync_status: result.status, last_error: error })
      .eq("id", mappingId);
    if (mappingError) throw new Error(mappingError.message);
  }
  return { runId, ...result } satisfies SyncResult;
}

async function failRun(mappingId: string | null, runId: string, error: unknown): Promise<never> {
  const message = errorMessage(error);
  await finishRun(
    mappingId,
    runId,
    {
      status: "failed",
      applicationsSeen: 0,
      applicationsSynced: 0,
      applicationsUnmapped: 0,
      applicationsFailed: 1,
      questionsDiscovered: 0,
    },
    { error: message },
  );
  throw error instanceof Error ? error : new Error(message);
}

async function ensureHiddenStage(mapping: ProgramMapping) {
  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("application_stages")
    .select("id")
    .eq("form_version_id", mapping.portal_form_version_id)
    .eq("stage_key", "acceptd_synced_data")
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return String(existing.id);
  const { data: latestStage, error: latestError } = await admin
    .from("application_stages")
    .select("sort_order")
    .eq("form_version_id", mapping.portal_form_version_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(latestError.message);
  const { data, error } = await admin
    .from("application_stages")
    .insert({
      form_version_id: mapping.portal_form_version_id,
      stage_key: "acceptd_synced_data",
      title: "Acceptd application data",
      description: "Read-only application fields synchronized from Acceptd.",
      sort_order: Number(latestStage?.sort_order ?? 0) + 1_000,
      is_initial: false,
      applicant_visible: false,
      settings: {
        source_managed: true,
        source_system: "acceptd-api-v2",
        acceptd_program_id: mapping.acceptd_program_id,
      },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the hidden Acceptd stage.");
  return String(data.id);
}

async function ensureSections(mapping: ProgramMapping, stageId: string, categories: string[]) {
  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("application_sections")
    .select("id,title")
    .eq("form_version_id", mapping.portal_form_version_id)
    .eq("stage_id", stageId);
  if (existingError) throw new Error(existingError.message);
  const byTitle = new Map((existing ?? []).map((section) => [String(section.title), String(section.id)]));
  const missing = categories.filter((category) => !byTitle.has(category));
  if (missing.length > 0) {
    const { data, error } = await admin
      .from("application_sections")
      .insert(
        missing.map((category, index) => ({
          form_version_id: mapping.portal_form_version_id,
          stage_id: stageId,
          title: category,
          description: "Synchronized from Acceptd; this section is not applicant-editable.",
          sort_order: 10_000 + categories.indexOf(category) * 10 + index,
        })),
      )
      .select("id,title");
    if (error) throw new Error(error.message);
    for (const section of data ?? []) byTitle.set(String(section.title), String(section.id));
  }
  return byTitle;
}

async function ensureQuestions(
  mapping: ProgramMapping,
  applications: NormalizedAcceptdApplication[],
): Promise<{ questionsDiscovered: number; questionMap: Map<number, string> }> {
  const definitions = new Map<number, AcceptdQuestionDefinition>();
  for (const application of applications) {
    for (const answer of application.answers) definitions.set(answer.question.id, answer.question);
  }
  if (definitions.size === 0) return { questionsDiscovered: 0, questionMap: new Map() };

  const admin = createAdminClient();
  const stageId = await ensureHiddenStage(mapping);
  const categories = [...new Set([...definitions.values()].map((question) => question.category))].sort(
    (left, right) => left.localeCompare(right),
  );
  const sectionMap = await ensureSections(mapping, stageId, categories);
  const { data: existingMappings, error: mappingsError } = await admin
    .from("acceptd_question_mappings")
    .select("acceptd_question_id,portal_question_id")
    .eq("program_mapping_id", mapping.id);
  if (mappingsError) throw new Error(mappingsError.message);
  const existingIds = new Set(
    (existingMappings ?? []).map((row) => Number(row.acceptd_question_id)),
  );
  const sortedDefinitions = [...definitions.values()].sort(
    (left, right) => left.category.localeCompare(right.category) || left.id - right.id,
  );

  const questionRows = sortedDefinitions.map((question, index) => ({
    form_version_id: mapping.portal_form_version_id,
    section_id: sectionMap.get(question.category),
    question_key: `acceptd_q_${question.id}`,
    label: question.label,
    description: question.description,
    question_type: portalQuestionType(question.type),
    required: false,
    options: [],
    settings: sourceManagedSettings(mapping, question),
    visibility_rule: null,
    sort_order: index * 10,
    active: true,
    source_label: question.label,
    imported: true,
  }));
  if (questionRows.some((row) => !row.section_id)) {
    throw new Error("An Acceptd category could not be connected to a portal section.");
  }
  const { data: portalQuestions, error: questionsError } = await admin
    .from("application_questions")
    .upsert(questionRows, { onConflict: "form_version_id,question_key" })
    .select("id,question_key");
  if (questionsError) throw new Error(questionsError.message);
  const portalQuestionByKey = new Map(
    (portalQuestions ?? []).map((question) => [String(question.question_key), String(question.id)]),
  );
  const mappingRows = sortedDefinitions.map((question) => ({
    program_mapping_id: mapping.id,
    acceptd_question_id: question.id,
    portal_question_id: portalQuestionByKey.get(`acceptd_q_${question.id}`),
    acceptd_type: question.type,
    label: question.label,
    description: question.description,
    category: question.category,
    archived: question.archived,
    last_seen_at: new Date().toISOString(),
  }));
  if (mappingRows.some((row) => !row.portal_question_id)) {
    throw new Error("An Acceptd question could not be connected to its portal question.");
  }
  const { error: upsertError } = await admin
    .from("acceptd_question_mappings")
    .upsert(mappingRows, { onConflict: "program_mapping_id,acceptd_question_id" });
  if (upsertError) throw new Error(upsertError.message);
  return {
    questionsDiscovered: sortedDefinitions.filter((question) => !existingIds.has(question.id)).length,
    questionMap: new Map(
      mappingRows.map((row) => [row.acceptd_question_id, String(row.portal_question_id)]),
    ),
  };
}

async function snapshotApplication(
  mapping: ProgramMapping,
  application: NormalizedAcceptdApplication,
  status: "unmapped" | "mapped" | "missing_portal_application" | "synced" | "failed",
  issue: string | null,
  portalApplicationId: string | null,
) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("acceptd_application_snapshots").upsert(
    {
      program_mapping_id: mapping.id,
      acceptd_application_id: application.id,
      acceptd_user_id: application.userId,
      acceptd_applicant_name: fullName(application),
      acceptd_applicant_email: application.email,
      acceptd_stage_id: application.stageId,
      portal_application_id: portalApplicationId,
      mapping_status: status,
      issue,
      payload: application.raw,
      payload_sha256: payloadHash(application.raw),
      acceptd_started_at: application.startedAt,
      acceptd_submitted_at: application.submittedAt,
      last_seen_at: now,
      last_synced_at: status === "synced" ? now : null,
    },
    { onConflict: "program_mapping_id,acceptd_application_id" },
  );
  if (error) throw new Error(error.message);
}

async function findOrCreatePortalApplication(
  mapping: ProgramMapping,
  application: NormalizedAcceptdApplication,
) {
  const admin = createAdminClient();
  if (!application.userId) return { applicationId: null, status: "unmapped" as const, issue: "Acceptd did not provide a user ID." };
  const { data: userMapping, error: userError } = await admin
    .from("acceptd_user_mappings")
    .select("portal_profile_id")
    .eq("acceptd_user_id", application.userId)
    .maybeSingle();
  if (userError) throw new Error(userError.message);
  if (!userMapping) {
    return { applicationId: null, status: "unmapped" as const, issue: "Map this Acceptd user to a portal applicant." };
  }

  const { data: sourceApplication, error: sourceError } = await admin
    .from("applications")
    .select("id,cycle_id,form_version_id,applicant_user_id,form_data,is_archived,source_system,source_record_id")
    .eq("source_system", "acceptd-api-v2")
    .eq("source_record_id", String(application.id))
    .maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (
    sourceApplication &&
    (sourceApplication.cycle_id !== mapping.portal_cycle_id ||
      sourceApplication.form_version_id !== mapping.portal_form_version_id ||
      sourceApplication.is_archived)
  ) {
    return {
      applicationId: null,
      status: "failed" as const,
      issue: "This Acceptd record is already linked to a different portal program, form, or archived application.",
    };
  }

  if (
    sourceApplication &&
    sourceApplication.applicant_user_id !== userMapping.portal_profile_id
  ) {
    const { data: conflictingApplication, error: conflictError } = await admin
      .from("applications")
      .select("id")
      .eq("cycle_id", mapping.portal_cycle_id)
      .eq("applicant_user_id", userMapping.portal_profile_id)
      .eq("is_archived", false)
      .neq("id", sourceApplication.id)
      .maybeSingle();
    if (conflictError) throw new Error(conflictError.message);
    if (conflictingApplication) {
      return {
        applicationId: null,
        status: "failed" as const,
        issue: "The corrected portal user already has another application in this program; merge it before remapping.",
      };
    }
    const { error: reassignmentError } = await admin
      .from("applications")
      .update({ applicant_user_id: userMapping.portal_profile_id })
      .eq("id", sourceApplication.id);
    if (reassignmentError) throw new Error(reassignmentError.message);
    sourceApplication.applicant_user_id = userMapping.portal_profile_id;
  }

  let portalApplication = sourceApplication;
  if (!portalApplication) {
    const { data, error } = await admin
      .from("applications")
      .select("id,cycle_id,form_version_id,applicant_user_id,form_data,is_archived,source_system,source_record_id")
      .eq("cycle_id", mapping.portal_cycle_id)
      .eq("applicant_user_id", userMapping.portal_profile_id)
      .eq("is_archived", false)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data && data.form_version_id !== mapping.portal_form_version_id) {
      return {
        applicationId: null,
        status: "failed" as const,
        issue: "The portal application uses a different form version than the Acceptd program mapping.",
      };
    }
    if (
      data?.source_system &&
      (data.source_system !== "acceptd-api-v2" ||
        (data.source_record_id && data.source_record_id !== String(application.id)))
    ) {
      return {
        applicationId: null,
        status: "failed" as const,
        issue: "The portal application is already linked to a different external source record.",
      };
    }
    portalApplication = data;
  }

  if (!portalApplication) {
    const { data: initialStage, error: stageError } = await admin
      .from("application_stages")
      .select("id")
      .eq("form_version_id", mapping.portal_form_version_id)
      .eq("applicant_visible", true)
      .order("is_initial", { ascending: false })
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    if (stageError) throw new Error(stageError.message);
    const { data, error } = await admin
      .from("applications")
      .insert({
        cycle_id: mapping.portal_cycle_id,
        form_version_id: mapping.portal_form_version_id,
        applicant_user_id: userMapping.portal_profile_id,
        school_name: application.schoolName ?? `School pending — Acceptd ${application.id}`,
        production_title: application.productionTitle,
        status: "draft",
        current_stage_id: initialStage?.id ?? null,
        external_applicant_name: fullName(application),
        external_applicant_email: application.email,
        source_system: "acceptd-api-v2",
        source_record_id: String(application.id),
        source_stage: application.stageId ? String(application.stageId) : null,
        form_data: { acceptd: { application_id: application.id, program_id: mapping.acceptd_program_id } },
      })
      .select("id,cycle_id,form_version_id,applicant_user_id,form_data,is_archived,source_system,source_record_id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not create the portal application.");
    portalApplication = data;
    if (initialStage?.id) {
      const now = new Date().toISOString();
      const { error: progressError } = await admin
        .from("application_stage_progress")
        .upsert(
          {
            application_id: data.id,
            stage_id: initialStage.id,
            status: "in_progress",
            started_at: now,
          },
          { onConflict: "application_id,stage_id" },
        );
      if (progressError) throw new Error(progressError.message);
    }
  }

  return {
    applicationId: String(portalApplication.id),
    status: "mapped" as const,
    issue: null,
    formData: (portalApplication.form_data && typeof portalApplication.form_data === "object"
      ? portalApplication.form_data
      : {}) as Record<string, unknown>,
  };
}

async function syncOneApplication(
  mapping: ProgramMapping,
  application: NormalizedAcceptdApplication,
  questionMap: Map<number, string>,
) {
  const link = await findOrCreatePortalApplication(mapping, application);
  if (!link.applicationId) {
    await snapshotApplication(mapping, application, link.status, link.issue, null);
    return link.status;
  }

  const admin = createAdminClient();
  const existingAcceptdMetadata =
    link.formData?.acceptd && typeof link.formData.acceptd === "object"
      ? (link.formData.acceptd as Record<string, unknown>)
      : {};
  const update: Record<string, unknown> = {
    form_version_id: mapping.portal_form_version_id,
    source_system: "acceptd-api-v2",
    source_record_id: String(application.id),
    form_data: {
      ...link.formData,
      acceptd: {
        ...existingAcceptdMetadata,
        application_id: application.id,
        program_id: mapping.acceptd_program_id,
        user_id: application.userId,
        stage_id: application.stageId,
        started_at: application.startedAt,
        submitted_at: application.submittedAt,
        last_synced_at: new Date().toISOString(),
      },
    },
  };
  const applicantName = fullName(application);
  if (applicantName) update.external_applicant_name = applicantName;
  if (application.email) update.external_applicant_email = application.email;
  if (application.stageId) update.source_stage = String(application.stageId);
  if (application.schoolName) update.school_name = application.schoolName;
  if (application.productionTitle) update.production_title = application.productionTitle;
  const { error: applicationError } = await admin
    .from("applications")
    .update(update)
    .eq("id", link.applicationId);
  if (applicationError) throw new Error(applicationError.message);

  const answersByQuestion = new Map(
    application.answers.map((answer) => [answer.question.id, answer]),
  );
  const answerRows = [...answersByQuestion.values()]
    .map((answer) => {
      const questionId = questionMap.get(answer.question.id);
      return questionId
        ? {
            application_id: link.applicationId,
            question_id: questionId,
            value: answerValue(answer),
            updated_by: null,
          }
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (answerRows.length > 0) {
    const { error: answerError } = await admin
      .from("application_answers")
      .upsert(answerRows, { onConflict: "application_id,question_id" });
    if (answerError) throw new Error(answerError.message);
  }
  await snapshotApplication(mapping, application, "synced", null, link.applicationId);
  return "synced" as const;
}

async function runProgramApplications(
  mapping: ProgramMapping,
  applications: NormalizedAcceptdApplication[],
  triggerSource: AcceptdSyncTrigger,
  existingRunId?: string,
) {
  const runId = existingRunId ?? (await startRun(mapping.id, triggerSource));
  try {
    const eligible = mapping.sync_drafts
      ? applications
      : applications.filter((application) => Boolean(application.submittedAt));
    const { questionsDiscovered, questionMap } = await ensureQuestions(mapping, eligible);
    let synced = 0;
    let unmapped = 0;
    let failed = 0;
    for (const application of eligible) {
      try {
        const status = await syncOneApplication(mapping, application, questionMap);
        if (status === "synced") synced += 1;
        else if (status === "unmapped") unmapped += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        await snapshotApplication(mapping, application, "failed", errorMessage(error), null).catch(() => undefined);
      }
    }
    const status = failed > 0 || unmapped > 0 ? "partial" : "succeeded";
    const admin = createAdminClient();
    await admin
      .from("acceptd_program_mappings")
      .update({ last_application_sync_at: new Date().toISOString() })
      .eq("id", mapping.id);
    return await finishRun(mapping.id, runId, {
      status,
      applicationsSeen: eligible.length,
      applicationsSynced: synced,
      applicationsUnmapped: unmapped,
      applicationsFailed: failed,
      questionsDiscovered,
    });
  } catch (error) {
    return failRun(mapping.id, runId, error);
  }
}

export async function syncAcceptdProgram(
  mappingId: string,
  triggerSource: AcceptdSyncTrigger = "manual",
) {
  const mapping = await mappingById(mappingId);
  const runId = await startRun(mapping.id, triggerSource);
  let applications: NormalizedAcceptdApplication[];
  try {
    const client = createAcceptdClient();
    const rawApplications = await client.getProgramApplications(mapping.acceptd_program_id);
    applications = rawApplications.map(normalizeAcceptdApplication);
  } catch (error) {
    return failRun(mapping.id, runId, error);
  }
  return runProgramApplications(mapping, applications, triggerSource, runId);
}

export async function refreshAcceptdSchema(mappingId: string) {
  const mapping = await mappingById(mappingId);
  const runId = await startRun(mapping.id, "schema");
  try {
    const client = createAcceptdClient();
    const sourceProgramIds = [
      ...new Set([mapping.acceptd_program_id, ...(mapping.schema_source_program_ids ?? [])]),
    ];
    const applications: NormalizedAcceptdApplication[] = [];
    for (const programId of sourceProgramIds) {
      const rawApplications = await client.getProgramApplications(programId);
      applications.push(...rawApplications.map(normalizeAcceptdApplication));
    }
    const { questionsDiscovered } = await ensureQuestions(mapping, applications);
    const admin = createAdminClient();
    await admin
      .from("acceptd_program_mappings")
      .update({ last_schema_sync_at: new Date().toISOString() })
      .eq("id", mapping.id);
    return await finishRun(
      mapping.id,
      runId,
      {
        status: "succeeded",
        applicationsSeen: applications.length,
        applicationsSynced: 0,
        applicationsUnmapped: 0,
        applicationsFailed: 0,
        questionsDiscovered,
      },
      { schema_source_program_ids: sourceProgramIds },
    );
  } catch (error) {
    return failRun(mapping.id, runId, error);
  }
}

export async function syncAcceptdApplicationById(
  applicationId: number,
  hintedProgramId: number | null = null,
) {
  const client = createAcceptdClient();
  const raw = await client.getApplication(applicationId);
  const application = normalizeAcceptdApplication(raw);
  const programId = application.programId ?? hintedProgramId;
  if (!programId) throw new Error("The Acceptd webhook application has no program ID.");
  const mapping = await mappingByProgramId(programId);
  if (!mapping) return null;
  try {
    return await runProgramApplications(mapping, [application], "webhook");
  } catch (error) {
    if (error instanceof AcceptdSyncBusyError) return null;
    throw error;
  }
}

export async function syncAllEnabledAcceptdPrograms(triggerSource: AcceptdSyncTrigger = "cron") {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("acceptd_program_mappings")
    .select("id")
    .eq("enabled", true);
  if (error) throw new Error(error.message);
  const results: SyncResult[] = [];
  for (const row of data ?? []) {
    try {
      results.push(await syncAcceptdProgram(String(row.id), triggerSource));
    } catch (syncError) {
      if (!(syncError instanceof AcceptdSyncBusyError)) throw syncError;
    }
  }
  return results;
}

export function acceptdNumericId(value: FormDataEntryValue | null, label: string) {
  const id = numeric(value);
  if (!id) throw new Error(`${label} must be a positive numeric Acceptd ID.`);
  return id;
}

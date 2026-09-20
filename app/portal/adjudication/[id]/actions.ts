"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import {
  applyPromptTemplate,
  buildCommentContext,
  extractOpenAIText,
  isQuarterPointScore,
} from "@/lib/adjudication";
import { resolveScoringCategorySubjects } from "@/lib/application-scoring-subjects";
import { queuePanelReviewForOwnersIfReady } from "@/lib/adjudication-owner-review";
import { requireProfile } from "@/lib/auth";
import {
  resolveGeneratedNarrativeFinal,
  shouldRefreshGeneratedNarrative,
} from "@/lib/panel-narrative";
import { richTextHasContent, sanitizeRichTextHtml } from "@/lib/rich-text";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationCategoryComment,
  AdjudicationScore,
  AdjudicationScorecard,
  AiPromptTemplate,
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
  ScoringCategory,
  ScoringCriterion,
} from "@/lib/types";

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

type PersistScorecardResult = {
  missing: string[];
  submitted: boolean;
  savedAt: string;
  savedBy: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to save the scorecard.";
}

async function persistAdjudicatorScorecard(
  applicationId: string,
  submit: boolean,
  formData: FormData,
): Promise<PersistScorecardResult> {
  const adjudicator = await requireProfile(["adjudicator", "advisory_member"]);
  const supabase = await createClient();

  const { data: assignment, error: assignmentReadError } = await supabase
    .from("adjudicator_assignments")
    .select("id,can_score,can_comment,removed_at")
    .eq("application_id", applicationId)
    .eq("adjudicator_user_id", adjudicator.id)
    .is("removed_at", null)
    .maybeSingle();

  if (assignmentReadError) {
    throw new Error(assignmentReadError.message);
  }
  if (!assignment?.can_score) {
    throw new Error("You are not assigned as a scoring participant for this application.");
  }

  const canComment = Boolean(assignment.can_comment);

  const { data: scorecardId, error: scorecardError } = await supabase.rpc(
    "ensure_adjudication_scorecard",
    { p_application_id: applicationId },
  );
  if (scorecardError || !scorecardId) {
    throw new Error(scorecardError?.message ?? "Unable to create the scorecard.");
  }

  const { data: scorecardData, error: cardReadError } = await supabase
    .from("adjudication_scorecards")
    .select("*")
    .eq("id", scorecardId)
    .single();
  if (cardReadError || !scorecardData) throw new Error("Scorecard not found.");
  const scorecard = scorecardData as AdjudicationScorecard;
  if (scorecard.status === "submitted" || scorecard.status === "locked") {
    throw new Error("This scorecard has already been submitted.");
  }

  const { data: rubricData, error: rubricError } = await supabase
    .from("scoring_rubrics")
    .select("score_min, score_max")
    .eq("id", scorecard.rubric_id)
    .single();

  if (rubricError || !rubricData) {
    throw new Error(rubricError?.message ?? "Scoring rubric not found.");
  }

  const scoreMinimum = Number(rubricData.score_min);
  const scoreMaximum = Number(rubricData.score_max);

  const { data: categoryData, error: categoryError } = await supabase
    .from("scoring_categories")
    .select("*")
    .eq("rubric_id", scorecard.rubric_id)
    .eq("active", true)
    .order("sort_order");
  if (categoryError) throw new Error(categoryError.message);
  const categories = (categoryData ?? []) as ScoringCategory[];

  const { data: proposalData, error: proposalError } = await supabase
    .from("adjudication_category_proposals")
    .select("category_id,is_eligible,range_min,range_max,status")
    .eq("application_id", applicationId);

  if (proposalError) throw new Error(proposalError.message);

  const officialProposalMap = new Map(
    (proposalData ?? []).map((proposal) => [proposal.category_id, proposal]),
  );

  const categoryIds = categories.map((category) => category.id);
  const { data: criterionData, error: criterionError } = categoryIds.length
    ? await supabase
      .from("scoring_criteria")
      .select("*")
      .in("category_id", categoryIds)
      .eq("active", true)
      .order("sort_order")
    : { data: [], error: null };
  if (criterionError) throw new Error(criterionError.message);
  const criteria = (criterionData ?? []) as ScoringCriterion[];

  const { data: applicationSourceData, error: applicationSourceError } =
    await supabase
      .from("applications")
      .select("form_version_id,form_data,archived_payload")
      .eq("id", applicationId)
      .single();

  if (applicationSourceError || !applicationSourceData) {
    throw new Error(
      applicationSourceError?.message ?? "Application source data not found.",
    );
  }

  const [applicationQuestionsResult, applicationAnswersResult] =
    applicationSourceData.form_version_id
      ? await Promise.all([
          supabase
            .from("application_questions")
            .select(
              "id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,source_column_index,source_label,imported,created_at,updated_at",
            )
            .eq("form_version_id", applicationSourceData.form_version_id),
          supabase
            .from("application_answers")
            .select("id,application_id,question_id,value,updated_at")
            .eq("application_id", applicationId),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (applicationQuestionsResult.error) {
    throw new Error(applicationQuestionsResult.error.message);
  }

  if (applicationAnswersResult.error) {
    throw new Error(applicationAnswersResult.error.message);
  }

  const categorySubjectDefaults = resolveScoringCategorySubjects({
    application: {
      form_data: applicationSourceData.form_data ?? {},
      archived_payload: applicationSourceData.archived_payload ?? {},
    },
    questions: (applicationQuestionsResult.data ?? []) as ApplicationQuestion[],
    answers: (applicationAnswersResult.data ?? []) as ApplicationAnswer[],
  });

  const scoreRows: Array<Record<string, unknown>> = [];
  const commentRows: Array<Record<string, unknown>> = [];
  const missing: string[] = [];

  for (const category of categories) {
    const officialProposal = officialProposalMap.get(category.id);
    const usesEligibilityControl =
      formData.get(`eligibility_control_${category.id}`) === "1";

    const isEligible = officialProposal
      ? Boolean(officialProposal.is_eligible)
      : usesEligibilityControl
        ? formData.get(`eligible_${category.id}`) === "on"
        : !(
            category.allow_not_applicable &&
            formData.get(`not_applicable_${category.id}`) === "on"
          );

    const rawRangeStart = officialProposal?.range_min != null
      ? String(officialProposal.range_min)
      : formText(formData, `score_range_start_${category.id}`);

    const rangeMinimum = officialProposal?.range_min != null
      ? Number(officialProposal.range_min)
      : rawRangeStart
        ? Number(rawRangeStart)
        : null;

    const rangeMaximum = officialProposal?.range_max != null
      ? Number(officialProposal.range_max)
      : rangeMinimum == null
        ? null
        : Number((rangeMinimum + 2).toFixed(2));

    const validRange =
      rangeMinimum != null &&
      rangeMaximum != null &&
      isQuarterPointScore(
        rangeMinimum,
        scoreMinimum,
        scoreMaximum - 2,
      ) &&
      rangeMaximum <= scoreMaximum;

    if (rawRangeStart && !validRange) {
      throw new Error(
        `The ${category.title} range must span exactly two points within the scoring scale.`,
      );
    }

    if (
      submit &&
      (!officialProposal || !["approved", "overridden"].includes(String(officialProposal.status)))
    ) {
      missing.push(`${category.title}: eligibility and range approval`);
    }

    if (submit && isEligible && !validRange) {
      missing.push(`${category.title}: select a 2-point scoring range`);
    }

    if (
      submit &&
      isEligible &&
      category.subject_label &&
      !formText(formData, `subject_name_${category.id}`)
    ) {
      missing.push(`${category.title}: ${category.subject_label}`);
    }

    const commentRow: Record<string, unknown> = {
      scorecard_id: scorecard.id,
      category_id: category.id,
      subject_name: isEligible
        ? formText(formData, `subject_name_${category.id}`) ||
          categorySubjectDefaults[category.category_key] ||
          null
        : null,
      is_applicable: isEligible,
      is_eligible: isEligible,
      not_applicable_reason: null,
      score_range_min: isEligible && validRange ? rangeMinimum : null,
      score_range_max: isEligible && validRange ? rangeMaximum : null,
    };
    if (canComment) {
      commentRow.private_notes =
        formText(formData, `private_notes_${category.id}`) || null;
    }
    commentRows.push(commentRow);

    const categoryCriteria = criteria.filter(
      (item) => item.category_id === category.id,
    );
    const categoryNumericScores: number[] = [];

    for (const criterion of categoryCriteria) {
      const rawScore = formText(formData, `score_${criterion.id}`);
      const observation = sanitizeRichTextHtml(
        formText(formData, `observation_${criterion.id}`),
      );
      const numericScore = rawScore ? Number(rawScore) : null;
      const validScore =
        numericScore != null &&
        isQuarterPointScore(numericScore, scoreMinimum, scoreMaximum);

      if (rawScore && !validScore) {
        throw new Error(
          `Scores must be entered between ${scoreMinimum} and ${scoreMaximum} in 0.25-point increments.`,
        );
      }

      if (isEligible && validScore && numericScore != null) {
        categoryNumericScores.push(numericScore);
      }

      if (submit && isEligible && !validScore) {
        missing.push(`${category.title}: ${criterion.title} score`);
      }

      if (
        submit &&
        canComment &&
        isEligible &&
        !richTextHasContent(observation)
      ) {
        missing.push(`${category.title}: ${criterion.title} observation`);
      }

      const scoreRow: Record<string, unknown> = {
        scorecard_id: scorecard.id,
        criterion_id: criterion.id,
        score: isEligible && validScore ? numericScore : null,
      };
      if (canComment) {
        scoreRow.observation = isEligible ? observation || null : null;
      }
      scoreRows.push(scoreRow);
    }

    if (
      submit &&
      isEligible &&
      validRange &&
      rangeMinimum != null &&
      rangeMaximum != null &&
      categoryCriteria.length > 0 &&
      categoryNumericScores.length === categoryCriteria.length
    ) {
      const categoryAverage =
        categoryNumericScores.reduce((sum, score) => sum + score, 0) /
        categoryNumericScores.length;

      if (
        categoryAverage < rangeMinimum - 0.0001 ||
        categoryAverage > rangeMaximum + 0.0001
      ) {
        missing.push(
          `${category.title}: category average must be within ${rangeMinimum.toFixed(2)}–${rangeMaximum.toFixed(2)}`,
        );
      }
    }
  }

  if (scoreRows.length > 0) {
    const { error } = await supabase.from("adjudication_scores").upsert(scoreRows, {
      onConflict: "scorecard_id,criterion_id",
    });
    if (error) throw new Error(error.message);
  }

  if (commentRows.length > 0) {
    const { error } = await supabase.from("adjudication_category_comments").upsert(commentRows, {
      onConflict: "scorecard_id,category_id",
    });
    if (error) throw new Error(error.message);
  }

  const now = new Date().toISOString();
  const hasMissingItems = missing.length > 0;
  const shouldSubmit = submit && !hasMissingItems;
  const nextStatus = shouldSubmit
    ? "submitted"
    : scorecard.status === "reopened"
      ? "reopened"
      : "draft";

  const scorecardUpdate: Record<string, unknown> = {
    status: nextStatus,
    submitted_at: shouldSubmit ? now : null,
  };
  if (canComment) {
    scorecardUpdate.internal_notes =
      formText(formData, "scorecard_internal_notes") || null;
  }

  const { error: cardUpdateError } = await supabase
    .from("adjudication_scorecards")
    .update(scorecardUpdate)
    .eq("id", scorecard.id)
    .eq("adjudicator_user_id", adjudicator.id);
  if (cardUpdateError) throw new Error(cardUpdateError.message);

  const admin = createAdminClient();
  const { data: updatedAssignment, error: assignmentError } = await admin
    .from("adjudicator_assignments")
    .update({ status: shouldSubmit ? "submitted" : "in_progress" })
    .eq("id", assignment.id)
    .eq("adjudicator_user_id", adjudicator.id)
    .is("removed_at", null)
    .select("id")
    .maybeSingle();
  if (assignmentError || !updatedAssignment) {
    throw new Error(
      assignmentError?.message ?? "Unable to update your assignment workflow.",
    );
  }

  return {
    missing,
    submitted: shouldSubmit,
    savedAt: now,
    savedBy: adjudicator.id,
  };
}

export async function autosaveAdjudicatorScorecard(
  applicationId: string,
  formData: FormData,
) {
  try {
    const result = await persistAdjudicatorScorecard(applicationId, false, formData);
    after(async () => {
      try {
        await refreshLivePanelNarratives(applicationId, result.savedBy);
      } catch (error) {
        console.error("Unable to refresh the live panel narratives.", error);
      }
    });
    return { ok: true as const, savedAt: result.savedAt };
  } catch (error) {
    console.error("[adjudication:autosave] Unable to save scorecard draft.", {
      applicationId,
      error: errorMessage(error),
    });
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function saveAdjudicatorScorecard(
  applicationId: string,
  submit: boolean,
  formData: FormData,
) {
  const result = await persistAdjudicatorScorecard(applicationId, submit, formData);

  after(async () => {
    try {
      await refreshLivePanelNarratives(applicationId, result.savedBy);
    } catch (error) {
      console.error("Unable to refresh the live panel narratives.", error);
    }
  });

  if (result.missing.length > 0) {
    revalidatePath(`/portal/adjudication/${applicationId}`);
    redirect(`/portal/adjudication/${applicationId}?error=required&missing=${result.missing.length}`);
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
  revalidatePath("/portal/adjudication");
  redirect(`/portal/adjudication/${applicationId}?${result.submitted ? "submitted" : "saved"}=1`);
}

export async function reopenAdjudicatorScorecard(
  applicationId: string,
  scorecardId: string,
) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data: card, error: cardError } = await supabase
    .from("adjudication_scorecards")
    .update({ status: "reopened", reopened_at: now, submitted_at: null })
    .eq("id", scorecardId)
    .select("assignment_id")
    .single();
  if (cardError || !card) throw new Error(cardError?.message ?? "Scorecard not found.");

  const { error: assignmentError } = await supabase
    .from("adjudicator_assignments")
    .update({ status: "reopened" })
    .eq("id", card.assignment_id);
  if (assignmentError) throw new Error(assignmentError.message);

  revalidatePath(`/portal/adjudication/${applicationId}`);
  revalidatePath("/portal/adjudication");
}

async function requirePanelNarrativeEditor(applicationId: string) {
  const profile = await requireProfile([
    "adjudicator",
    "advisory_member",
    "owner",
  ]);

  if (profile.role === "owner") return profile;

  const supabase = await createClient();
  const { data: assignment, error } = await supabase
    .from("adjudicator_assignments")
    .select("can_comment")
    .eq("application_id", applicationId)
    .eq("adjudicator_user_id", profile.id)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!assignment?.can_comment) {
    throw new Error("Commenting is disabled for this assignment.");
  }

  return profile;
}

async function generatePanelCommentDraft(
  applicationId: string,
  categoryId: string,
  generatedBy: string,
  expectedClaimedAt: string,
  replaceOwnerDraft = false,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured in Vercel.");

  const admin = createAdminClient();
  const { data: applicationData, error: applicationError } = await admin
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .single();
  if (applicationError || !applicationData) throw new Error("Application not found.");
  const application = applicationData as Application;

  const [{ data: categoryData }, { data: criteriaData }, { data: cardsData }] = await Promise.all([
    admin.from("scoring_categories").select("*").eq("id", categoryId).single(),
    admin.from("scoring_criteria").select("*").eq("category_id", categoryId).eq("active", true).order("sort_order"),
    admin.from("adjudication_scorecards").select("*").eq("application_id", applicationId).in("status", ["draft", "reopened", "submitted", "locked"]),
  ]);

  if (!categoryData) throw new Error("Scoring category not found.");
  const category = categoryData as ScoringCategory;
  const { data: categoryRubric, error: categoryRubricError } = await admin
    .from("scoring_rubrics")
    .select("cycle_id")
    .eq("id", category.rubric_id)
    .single();
  if (categoryRubricError || categoryRubric?.cycle_id !== application.cycle_id) {
    throw new Error("This scoring category does not belong to the application.");
  }
  const criteria = (criteriaData ?? []) as ScoringCriterion[];
  const scorecards = (cardsData ?? []) as AdjudicationScorecard[];
  if (scorecards.length === 0) throw new Error("No adjudicator scorecards are available.");

  const scorecardIds = scorecards.map((card) => card.id);
  const criterionIds = criteria.map((criterion) => criterion.id);

  const [commentsResult, scoresResult] = await Promise.all([
    admin
      .from("adjudication_category_comments")
      .select("*")
      .eq("category_id", categoryId)
      .in("scorecard_id", scorecardIds),
    criterionIds.length
      ? admin
          .from("adjudication_scores")
          .select("*")
          .in("scorecard_id", scorecardIds)
          .in("criterion_id", criterionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (commentsResult.error) {
    throw new Error(commentsResult.error.message);
  }
  if (scoresResult.error) {
    throw new Error(scoresResult.error.message);
  }

  const comments = (commentsResult.data ?? []) as AdjudicationCategoryComment[];
  const scores = (scoresResult.data ?? []) as AdjudicationScore[];
  const { criterionText, rawComments } = buildCommentContext(
    category,
    criteria,
    comments,
    scores,
  );
  if (!rawComments.trim()) {
    throw new Error(
      "No category comments or criterion observations are available to synthesize.",
    );
  }

  const { data: claimedFeedback, error: claimedFeedbackError } = await admin
    .from("adjudication_panel_feedback")
    .select("generated_comment,final_comment")
    .eq("application_id", applicationId)
    .eq("category_id", categoryId)
    .eq("status", "draft")
    .eq("generated_at", expectedClaimedAt)
    .maybeSingle();
  if (claimedFeedbackError) throw new Error(claimedFeedbackError.message);
  if (!claimedFeedback) {
    return {
      generated: false as const,
      generatedComment: "",
      preservedOwnerDraft: false,
    };
  }

  const { data: cyclePromptData } = await admin
    .from("ai_prompt_templates")
    .select("*")
    .eq("template_key", "panel_category_comment")
    .eq("active", true)
    .eq("cycle_id", application.cycle_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let prompt = cyclePromptData as AiPromptTemplate | null;
  if (!prompt) {
    const { data: globalPromptData, error: globalPromptError } = await admin
      .from("ai_prompt_templates")
      .select("*")
      .eq("template_key", "panel_category_comment")
      .eq("active", true)
      .is("cycle_id", null)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();
    if (globalPromptError || !globalPromptData) throw new Error("No active AI narrative prompt is configured.");
    prompt = globalPromptData as AiPromptTemplate;
  }

  const userPrompt = applyPromptTemplate(prompt.user_prompt_template, {
    school_name: application.school_name,
    production_title: application.production_title ?? "Untitled production",
    category_title: category.title,
    criteria: criterionText,
    raw_comments: rawComments,
  });

  const model = process.env.OPENAI_MODEL || prompt.model || "gpt-5-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "system", content: prompt.system_prompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const apiMessage = payload?.error?.message ?? `OpenAI returned ${response.status}.`;
    throw new Error(apiMessage);
  }

  const generatedComment = extractOpenAIText(payload);
  if (!generatedComment) throw new Error("OpenAI returned an empty narrative.");

  const resolvedNarrative = resolveGeneratedNarrativeFinal({
    currentGeneratedComment: claimedFeedback.generated_comment,
    currentFinalComment: claimedFeedback.final_comment,
    nextGeneratedComment: generatedComment,
    replaceOwnerDraft,
  });

  const requestId = response.headers.get("x-request-id");
  const { data: savedFeedback, error: saveError } = await admin
    .from("adjudication_panel_feedback")
    .update({
      application_id: applicationId,
      category_id: categoryId,
      status: "generated",
      generated_comment: generatedComment,
      final_comment: resolvedNarrative.finalComment,
      prompt_template_id: prompt.id,
      prompt_snapshot: `${prompt.system_prompt}\n\n${userPrompt}`,
      model,
      openai_request_id: requestId,
      generated_by: generatedBy,
      generated_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
    })
    .eq("application_id", applicationId)
    .eq("category_id", categoryId)
    .eq("status", "draft")
    .eq("generated_at", expectedClaimedAt)
    .select("id")
    .maybeSingle();
  if (saveError) throw new Error(saveError.message);
  if (!savedFeedback) {
    return {
      generated: false as const,
      generatedComment: "",
      preservedOwnerDraft: false,
    };
  }

  const { error: reviewResetError } = await admin
    .from("adjudication_reviews")
    .update({ status: "advisory_review" })
    .eq("application_id", applicationId)
    .eq("status", "ready_for_owner");
  if (reviewResetError) throw new Error(reviewResetError.message);

  return {
    generated: true as const,
    generatedComment,
    preservedOwnerDraft: resolvedNarrative.preservedOwnerDraft,
  };
}

async function refreshLivePanelNarratives(
  applicationId: string,
  generatedBy: string,
) {
  const admin = createAdminClient();
  const { data: scorecards, error: scorecardError } = await admin
    .from("adjudication_scorecards")
    .select("id,rubric_id")
    .eq("application_id", applicationId);
  if (scorecardError) throw new Error(scorecardError.message);
  if (!scorecards?.length) return;

  const rubricId = scorecards[0]?.rubric_id;
  if (!rubricId) return;

  const scorecardIds = scorecards.map((scorecard) => scorecard.id);
  const [categoriesResult, commentsResult, feedbackResult] =
    await Promise.all([
      admin
        .from("scoring_categories")
        .select("id")
        .eq("rubric_id", rubricId)
        .eq("active", true)
        .order("sort_order"),
      admin
        .from("adjudication_category_comments")
        .select(
          "category_id,successes,success_examples,growth_areas,growth_examples,updated_at",
        )
        .in("scorecard_id", scorecardIds),
      admin
        .from("adjudication_panel_feedback")
        .select(
          "category_id,status,generated_comment,final_comment,generated_at,updated_at",
        )
        .eq("application_id", applicationId),
    ]);
  const firstError = [
    categoriesResult.error,
    commentsResult.error,
    feedbackResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const categories = categoriesResult.data ?? [];
  const categoryIds = categories.map((category) => category.id);
  const { data: criteria, error: criteriaError } = categoryIds.length
    ? await admin
        .from("scoring_criteria")
        .select("id,category_id")
        .in("category_id", categoryIds)
        .eq("active", true)
    : { data: [], error: null };
  if (criteriaError) throw new Error(criteriaError.message);
  const criterionIds = criteria.map((criterion) => criterion.id);
  const { data: scores, error: scoreError } = criterionIds.length
    ? await admin
        .from("adjudication_scores")
        .select("criterion_id,observation,updated_at")
        .in("scorecard_id", scorecardIds)
        .in("criterion_id", criterionIds)
    : { data: [], error: null };
  if (scoreError) throw new Error(scoreError.message);

  const feedbackByCategory = new Map(
    (feedbackResult.data ?? []).map((item) => [item.category_id, item]),
  );
  const now = Date.now();
  const generationCooldownMs = 90_000;
  const categoriesToRefresh = categories.filter((category) => {
    const categoryCriterionIds = new Set(
      criteria
        .filter((criterion) => criterion.category_id === category.id)
        .map((criterion) => criterion.id),
    );
    const sourceTimestamps = [
      ...(commentsResult.data ?? [])
        .filter(
          (comment) =>
            comment.category_id === category.id &&
            [
              comment.successes,
              comment.success_examples,
              comment.growth_areas,
              comment.growth_examples,
            ].some(richTextHasContent),
        )
        .map((comment) => Date.parse(comment.updated_at)),
      ...(scores ?? [])
        .filter(
          (score) =>
            categoryCriterionIds.has(score.criterion_id) &&
            richTextHasContent(score.observation),
        )
        .map((score) => Date.parse(score.updated_at)),
    ].filter(Number.isFinite);
    if (sourceTimestamps.length === 0) return false;

    const latestSourceUpdate = Math.max(...sourceTimestamps);
    const feedback = feedbackByCategory.get(category.id);
    if (feedback?.status === "approved") return false;
    return shouldRefreshGeneratedNarrative({
      status: feedback?.status,
      generatedAt: feedback?.generated_at,
      latestSourceUpdate,
      now,
      cooldownMs: generationCooldownMs,
    });
  });

  if (categoriesToRefresh.length === 0) return;

  const claimedAt = new Date().toISOString();
  const claimResults = await Promise.all(
    categoriesToRefresh.map(async (category) => {
      const existingFeedback = feedbackByCategory.get(category.id);
      if (existingFeedback) {
        const { data, error } = await admin
          .from("adjudication_panel_feedback")
          .update({
            status: "draft",
            generated_by: generatedBy,
            generated_at: claimedAt,
          })
          .eq("application_id", applicationId)
          .eq("category_id", category.id)
          .eq("updated_at", existingFeedback.updated_at)
          .in("status", ["draft", "generated"])
          .select("category_id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data?.category_id ?? null;
      }

      const { data, error } = await admin
        .from("adjudication_panel_feedback")
        .insert({
          application_id: applicationId,
          category_id: category.id,
          status: "draft",
          generated_by: generatedBy,
          generated_at: claimedAt,
        })
        .select("category_id")
        .maybeSingle();
      if (error?.code === "23505") return null;
      if (error) throw new Error(error.message);
      return data?.category_id ?? null;
    }),
  );
  const claimedCategoryIds = new Set(
    claimResults.filter((categoryId): categoryId is string => Boolean(categoryId)),
  );
  const claimedCategories = categoriesToRefresh.filter((category) =>
    claimedCategoryIds.has(category.id),
  );
  if (claimedCategories.length === 0) return;

  const generationBatchSize = 3;
  for (let index = 0; index < claimedCategories.length; index += generationBatchSize) {
    const batch = claimedCategories.slice(index, index + generationBatchSize);
    const results = await Promise.allSettled(
      batch.map((category) =>
        generatePanelCommentDraft(
          applicationId,
          category.id,
          generatedBy,
          claimedAt,
        ),
      ),
    );
    results.forEach((result, resultIndex) => {
      if (result.status === "rejected") {
        console.error(
          `Unable to generate the live narrative for category ${batch[resultIndex]?.id}.`,
          result.reason,
        );
      }
    });
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function generatePanelNarrativeNow(
  applicationId: string,
  categoryId: string,
) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const [applicationResult, categoryResult] = await Promise.all([
    admin.from("applications").select("cycle_id").eq("id", applicationId).single(),
    admin.from("scoring_categories").select("rubric_id").eq("id", categoryId).single(),
  ]);

  if (applicationResult.error || categoryResult.error) {
    throw new Error("The application or scoring category could not be found.");
  }

  const { data: rubric, error: rubricError } = await admin
    .from("scoring_rubrics")
    .select("cycle_id")
    .eq("id", categoryResult.data.rubric_id)
    .single();
  if (rubricError || rubric?.cycle_id !== applicationResult.data.cycle_id) {
    throw new Error("This scoring category does not belong to the application.");
  }

  const claimedAt = new Date().toISOString();
  const { data: existingFeedback, error: existingFeedbackError } = await admin
    .from("adjudication_panel_feedback")
    .select("id,status")
    .eq("application_id", applicationId)
    .eq("category_id", categoryId)
    .maybeSingle();
  if (existingFeedbackError) throw new Error(existingFeedbackError.message);

  let claimed = false;
  if (existingFeedback) {
    const { data, error } = await admin
      .from("adjudication_panel_feedback")
      .update({
        status: "draft",
        generated_by: owner.id,
        generated_at: claimedAt,
      })
      .eq("id", existingFeedback.id)
      .in("status", ["draft", "generated"])
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    claimed = Boolean(data);
  } else {
    const { data, error } = await admin
      .from("adjudication_panel_feedback")
      .insert({
        application_id: applicationId,
        category_id: categoryId,
        status: "draft",
        generated_by: owner.id,
        generated_at: claimedAt,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    claimed = Boolean(data);
  }

  if (!claimed) {
    throw new Error(
      "This comment has already been sent to the panel. Return it to Owner draft before regenerating it.",
    );
  }

  try {
    const result = await generatePanelCommentDraft(
      applicationId,
      categoryId,
      owner.id,
      claimedAt,
      true,
    );
    if (!result.generated) {
      throw new Error("The Owner draft changed while it was being generated. Try again.");
    }
    revalidatePath(`/portal/adjudication/${applicationId}`);
    return result;
  } catch (error) {
    console.error("[adjudication:narrative] Manual Owner draft generation failed.", {
      applicationId,
      categoryId,
      error: errorMessage(error),
    });
    throw error;
  }
}

export async function savePanelFeedback(
  applicationId: string,
  categoryId: string,
  formData: FormData,
) {
  const editor = await requirePanelNarrativeEditor(applicationId);
  const finalComment = formText(formData, "final_comment");
  const ownerRequestedPanelReview = formData.get("approved") === "on";
  if (!finalComment) throw new Error("The final panel comment cannot be blank.");

  const admin = createAdminClient();
  const [categoryResult, applicationResult, existingFeedbackResult] =
    await Promise.all([
      admin
        .from("scoring_categories")
        .select("rubric_id")
        .eq("id", categoryId)
        .single(),
      admin
        .from("applications")
        .select("cycle_id,school_name,production_title")
        .eq("id", applicationId)
        .single(),
      admin
        .from("adjudication_panel_feedback")
        .select("status,approved_by,approved_at")
        .eq("application_id", applicationId)
        .eq("category_id", categoryId)
        .maybeSingle(),
    ]);

  const { data: category, error: categoryError } = categoryResult;
  const { data: application, error: applicationError } = applicationResult;
  const { data: existingFeedback, error: existingFeedbackError } =
    existingFeedbackResult;
  const { data: rubric, error: rubricError } = category?.rubric_id
    ? await admin
        .from("scoring_rubrics")
        .select("cycle_id")
        .eq("id", category.rubric_id)
        .single()
    : { data: null, error: null };

  if (
    categoryError ||
    applicationError ||
    existingFeedbackError ||
    rubricError ||
    !application ||
    !rubric ||
    rubric.cycle_id !== application.cycle_id
  ) {
    throw new Error("This scoring category does not belong to the application.");
  }

  const { data: existingApprover } = existingFeedback?.approved_by
    ? await admin
        .from("profiles")
        .select("role")
        .eq("id", existingFeedback.approved_by)
        .maybeSingle()
    : { data: null };
  const panelAlreadyApproved = ["adjudicator", "advisory_member"].includes(
    existingApprover?.role ?? "",
  );

  if (editor.role !== "owner") {
    if (
      existingFeedback?.status !== "approved" ||
      existingApprover?.role !== "owner"
    ) {
      throw new Error(
        "The Owner has not sent this final comment to the panel, or it has already been panel-approved.",
      );
    }
  }

  const approved = editor.role === "owner" ? ownerRequestedPanelReview : true;
  const approvedBy = approved
    ? editor.role === "owner" && panelAlreadyApproved
      ? existingFeedback?.approved_by ?? editor.id
      : editor.id
    : null;
  const approvedAt = approved
    ? editor.role === "owner" && panelAlreadyApproved
      ? existingFeedback?.approved_at ?? new Date().toISOString()
      : new Date().toISOString()
    : null;

  const { error } = await admin.from("adjudication_panel_feedback").upsert(
    {
      application_id: applicationId,
      category_id: categoryId,
      final_comment: finalComment,
      status: approved ? "approved" : "generated",
      approved_by: approvedBy,
      approved_at: approvedAt,
    },
    { onConflict: "application_id,category_id" },
  );
  if (error) throw new Error(error.message);

  const sentToPanel =
    editor.role === "owner" &&
    approved &&
    existingFeedback?.status !== "approved";

  if (sentToPanel) {
    const { data: panelAssignments, error: panelAssignmentError } = await admin
      .from("adjudicator_assignments")
      .select("adjudicator_user_id")
      .eq("application_id", applicationId)
      .eq("can_comment", true)
      .is("removed_at", null);
    if (panelAssignmentError) throw new Error(panelAssignmentError.message);

    const panelUserIds = [
      ...new Set(
        (panelAssignments ?? []).map(
          (assignment) => assignment.adjudicator_user_id,
        ),
      ),
    ];
    if (panelUserIds.length > 0) {
      const { error: notificationError } = await admin
        .from("user_notifications")
        .insert(
          panelUserIds.map((userId) => ({
            user_id: userId,
            notification_type: "panel_narrative_ready",
            title: "Final comment ready for panel review",
            body: `${application.school_name} — ${application.production_title ?? "Untitled production"}`,
            href: `/portal/adjudication/${applicationId}`,
            related_application_id: applicationId,
          })),
        );
      if (notificationError) throw new Error(notificationError.message);
    }
  }

  if (approved && editor.role !== "owner") {
    await queuePanelReviewForOwnersIfReady(applicationId, editor.id);
  } else if (!approved) {
    const { data: review } = await admin
      .from("adjudication_reviews")
      .select("status")
      .eq("application_id", applicationId)
      .maybeSingle();

    if (review?.status === "ready_for_owner") {
      const { error: reviewError } = await admin
        .from("adjudication_reviews")
        .update({ status: "advisory_review" })
        .eq("application_id", applicationId);
      if (reviewError) throw new Error(reviewError.message);
    }
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function releaseAdjudicationResults(
  applicationId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const releaseScores = formData.get("release_scores") === "on";
  const releaseFeedback = formData.get("release_feedback") === "on";
  const releaseNotes = formText(formData, "release_notes");
  if (!releaseScores && !releaseFeedback) throw new Error("Choose scores, feedback, or both.");

  if (releaseFeedback) {
    const readiness = await queuePanelReviewForOwnersIfReady(
      applicationId,
      owner.id,
    );
    if (readiness === "not_ready") {
      throw new Error(
        "Every final comment must be approved by the panel before it can be released to the school.",
      );
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("release_adjudication", {
    p_application_id: applicationId,
    p_release_scores: releaseScores,
    p_release_feedback: releaseFeedback,
    p_release_notes: releaseNotes || null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/portal/adjudication/${applicationId}`);
  revalidatePath("/portal/results");
  redirect(`/portal/adjudication/${applicationId}?released=1`);
}

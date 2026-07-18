"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  applyPromptTemplate,
  buildCommentContext,
  extractOpenAIText,
  isQuarterPointScore,
} from "@/lib/adjudication";
import { requireProfile } from "@/lib/auth";
import { richTextHasContent, sanitizeRichTextHtml } from "@/lib/rich-text";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationCategoryComment,
  AdjudicationScore,
  AdjudicationScorecard,
  AiPromptTemplate,
  Application,
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
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to save the scorecard.";
}

async function persistAdjudicatorScorecard(
  applicationId: string,
  submit: boolean,
  formData: FormData,
): Promise<PersistScorecardResult> {
  const adjudicator = await requireProfile(["adjudicator"]);
  const supabase = await createClient();

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

  const scoreRows: Array<Record<string, unknown>> = [];
  const commentRows: Array<Record<string, unknown>> = [];
  const missing: string[] = [];

  for (const category of categories) {
    const usesEligibilityControl =
      formData.get(`eligibility_control_${category.id}`) === "1";

    const isEligible = usesEligibilityControl
      ? formData.get(`eligible_${category.id}`) === "on"
      : !(
          category.allow_not_applicable &&
          formData.get(`not_applicable_${category.id}`) === "on"
        );

    const ineligibilityReason =
      formText(formData, `ineligibility_reason_${category.id}`) ||
      formText(formData, `not_applicable_reason_${category.id}`);

    const rawRangeStart = formText(
      formData,
      `score_range_start_${category.id}`,
    );

    const rangeMinimum = rawRangeStart
      ? Number(rawRangeStart)
      : null;

    const rangeMaximum = rangeMinimum == null
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

    if (submit && !isEligible && !ineligibilityReason) {
      missing.push(`${category.title}: explain why it is not eligible`);
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

    commentRows.push({
      scorecard_id: scorecard.id,
      category_id: category.id,
      subject_name: isEligible
        ? formText(formData, `subject_name_${category.id}`) || null
        : null,
      is_applicable: isEligible,
      is_eligible: isEligible,
      not_applicable_reason: isEligible
        ? null
        : ineligibilityReason || null,
      score_range_min: isEligible && validRange ? rangeMinimum : null,
      score_range_max: isEligible && validRange ? rangeMaximum : null,
      private_notes: formText(formData, `private_notes_${category.id}`) || null,
    });

    for (const criterion of criteria.filter((item) => item.category_id === category.id)) {
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

      if (submit && isEligible && !validScore) {
        missing.push(`${category.title}: ${criterion.title} score`);
      }

      if (
        submit &&
        isEligible &&
        !richTextHasContent(observation)
      ) {
        missing.push(`${category.title}: ${criterion.title} observation`);
      }

      scoreRows.push({
        scorecard_id: scorecard.id,
        criterion_id: criterion.id,
        score: isEligible && validScore ? numericScore : null,
        observation: isEligible ? observation || null : null,
      });
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

  const { error: cardUpdateError } = await supabase
    .from("adjudication_scorecards")
    .update({
      status: nextStatus,
      submitted_at: shouldSubmit ? now : null,
      internal_notes: formText(formData, "scorecard_internal_notes") || null,
    })
    .eq("id", scorecard.id)
    .eq("adjudicator_user_id", adjudicator.id);
  if (cardUpdateError) throw new Error(cardUpdateError.message);

  const { error: assignmentError } = await supabase.rpc(
    "update_own_assignment_status",
    {
      p_assignment_id: scorecard.assignment_id,
      p_status: shouldSubmit ? "submitted" : "in_progress",
    },
  );
  if (assignmentError) throw new Error(assignmentError.message);

  return {
    missing,
    submitted: shouldSubmit,
    savedAt: now,
  };
}

export async function autosaveAdjudicatorScorecard(
  applicationId: string,
  formData: FormData,
) {
  try {
    const result = await persistAdjudicatorScorecard(applicationId, false, formData);
    return { ok: true as const, savedAt: result.savedAt };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function saveAdjudicatorScorecard(
  applicationId: string,
  submit: boolean,
  formData: FormData,
) {
  const result = await persistAdjudicatorScorecard(applicationId, submit, formData);

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

export async function generatePanelComment(
  applicationId: string,
  categoryId: string,
) {
  const owner = await requireProfile(["owner"]);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured in Vercel.");

  const supabase = await createClient();
  const { data: applicationData, error: applicationError } = await supabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .single();
  if (applicationError || !applicationData) throw new Error("Application not found.");
  const application = applicationData as Application;

  const [{ data: categoryData }, { data: criteriaData }, { data: cardsData }] = await Promise.all([
    supabase.from("scoring_categories").select("*").eq("id", categoryId).single(),
    supabase.from("scoring_criteria").select("*").eq("category_id", categoryId).eq("active", true).order("sort_order"),
    supabase.from("adjudication_scorecards").select("*").eq("application_id", applicationId).in("status", ["draft", "reopened", "submitted", "locked"]),
  ]);

  if (!categoryData) throw new Error("Scoring category not found.");
  const category = categoryData as ScoringCategory;
  const criteria = (criteriaData ?? []) as ScoringCriterion[];
  const scorecards = (cardsData ?? []) as AdjudicationScorecard[];
  if (scorecards.length === 0) throw new Error("No adjudicator scorecards are available.");

  const scorecardIds = scorecards.map((card) => card.id);
  const criterionIds = criteria.map((criterion) => criterion.id);

  const [commentsResult, scoresResult] = await Promise.all([
    supabase
      .from("adjudication_category_comments")
      .select("*")
      .eq("category_id", categoryId)
      .in("scorecard_id", scorecardIds),
    criterionIds.length
      ? supabase
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

  const { data: cyclePromptData } = await supabase
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
    const { data: globalPromptData, error: globalPromptError } = await supabase
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
      max_output_tokens: 1200,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const apiMessage = payload?.error?.message ?? `OpenAI returned ${response.status}.`;
    throw new Error(apiMessage);
  }

  const generatedComment = extractOpenAIText(payload);
  if (!generatedComment) throw new Error("OpenAI returned an empty narrative.");

  const requestId = response.headers.get("x-request-id");
  const { error: saveError } = await supabase.from("adjudication_panel_feedback").upsert(
    {
      application_id: applicationId,
      category_id: categoryId,
      status: "generated",
      generated_comment: generatedComment,
      final_comment: generatedComment,
      prompt_template_id: prompt.id,
      prompt_snapshot: `${prompt.system_prompt}\n\n${userPrompt}`,
      model,
      openai_request_id: requestId,
      generated_by: owner.id,
      generated_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
    },
    { onConflict: "application_id,category_id" },
  );
  if (saveError) throw new Error(saveError.message);

  revalidatePath(`/portal/adjudication/${applicationId}`);
  redirect(`/portal/adjudication/${applicationId}?generated=${categoryId}`);
}

export async function savePanelFeedback(
  applicationId: string,
  categoryId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const finalComment = formText(formData, "final_comment");
  const approved = formData.get("approved") === "on";
  if (!finalComment) throw new Error("The final panel comment cannot be blank.");

  const supabase = await createClient();
  const { error } = await supabase.from("adjudication_panel_feedback").upsert(
    {
      application_id: applicationId,
      category_id: categoryId,
      final_comment: finalComment,
      status: approved ? "approved" : "generated",
      approved_by: approved ? owner.id : null,
      approved_at: approved ? new Date().toISOString() : null,
    },
    { onConflict: "application_id,category_id" },
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function releaseAdjudicationResults(
  applicationId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);
  const releaseScores = formData.get("release_scores") === "on";
  const releaseFeedback = formData.get("release_feedback") === "on";
  const releaseNotes = formText(formData, "release_notes");
  if (!releaseScores && !releaseFeedback) throw new Error("Choose scores, feedback, or both.");

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

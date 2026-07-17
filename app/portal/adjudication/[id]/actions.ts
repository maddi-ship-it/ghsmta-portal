"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  applyPromptTemplate,
  buildCommentContext,
  extractOpenAIText,
} from "@/lib/adjudication";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationCategoryComment,
  AdjudicationScorecard,
  AiPromptTemplate,
  Application,
  ScoringCategory,
  ScoringCriterion,
} from "@/lib/types";

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function saveAdjudicatorScorecard(
  applicationId: string,
  submit: boolean,
  formData: FormData,
) {
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
    const requestedNotApplicable = formData.get(`not_applicable_${category.id}`) === "on";
    const isApplicable = !(category.allow_not_applicable && requestedNotApplicable);
    const notApplicableReason = formText(formData, `not_applicable_reason_${category.id}`);
    const successes = formText(formData, `successes_${category.id}`);
    const successExamples = formText(formData, `success_examples_${category.id}`);
    const growthAreas = formText(formData, `growth_areas_${category.id}`);
    const growthExamples = formText(formData, `growth_examples_${category.id}`);

    if (submit && !isApplicable && !notApplicableReason) {
      missing.push(`${category.title}: explain why it is not applicable`);
    }

    if (submit && isApplicable) {
      if (!successes) missing.push(`${category.title}: successes`);
      if (!successExamples) missing.push(`${category.title}: success examples`);
      if (!growthAreas) missing.push(`${category.title}: opportunities for growth`);
      if (!growthExamples) missing.push(`${category.title}: growth examples`);
    }

    commentRows.push({
      scorecard_id: scorecard.id,
      category_id: category.id,
      subject_name: formText(formData, `subject_name_${category.id}`) || null,
      is_applicable: isApplicable,
      not_applicable_reason: isApplicable ? null : notApplicableReason || null,
      successes: successes || null,
      success_examples: successExamples || null,
      growth_areas: growthAreas || null,
      growth_examples: growthExamples || null,
      private_notes: formText(formData, `private_notes_${category.id}`) || null,
    });

    for (const criterion of criteria.filter((item) => item.category_id === category.id)) {
      const rawScore = formText(formData, `score_${criterion.id}`);
      const numericScore = rawScore ? Number(rawScore) : null;
      const validScore = numericScore != null && Number.isFinite(numericScore) && numericScore >= 1 && numericScore <= 10;
      if (submit && isApplicable && !validScore) {
        missing.push(`${category.title}: ${criterion.title}`);
      }
      scoreRows.push({
        scorecard_id: scorecard.id,
        criterion_id: criterion.id,
        score: isApplicable && validScore ? numericScore : null,
        observation: formText(formData, `observation_${criterion.id}`) || null,
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

  if (hasMissingItems) {
    revalidatePath(`/portal/adjudication/${applicationId}`);
    redirect(`/portal/adjudication/${applicationId}?error=required&missing=${missing.length}`);
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
  revalidatePath("/portal/adjudication");
  redirect(`/portal/adjudication/${applicationId}?${submit ? "submitted" : "saved"}=1`);
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
    supabase.from("adjudication_scorecards").select("*").eq("application_id", applicationId).in("status", ["submitted", "locked"]),
  ]);

  if (!categoryData) throw new Error("Scoring category not found.");
  const category = categoryData as ScoringCategory;
  const criteria = (criteriaData ?? []) as ScoringCriterion[];
  const scorecards = (cardsData ?? []) as AdjudicationScorecard[];
  if (scorecards.length === 0) throw new Error("No submitted adjudicator scorecards are available.");

  const { data: commentsData, error: commentsError } = await supabase
    .from("adjudication_category_comments")
    .select("*")
    .eq("category_id", categoryId)
    .in("scorecard_id", scorecards.map((card) => card.id));
  if (commentsError) throw new Error(commentsError.message);
  const comments = (commentsData ?? []) as AdjudicationCategoryComment[];
  const { criterionText, rawComments } = buildCommentContext(category, criteria, comments);
  if (!rawComments.trim()) throw new Error("No submitted category comments are available to synthesize.");

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

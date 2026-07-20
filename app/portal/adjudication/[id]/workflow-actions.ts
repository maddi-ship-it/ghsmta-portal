"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveAllCategoryProposals(
  applicationId: string,
  formData: FormData,
) {
  await requireProfile(["advisory_member", "owner"]);
  const categoryIds = formData
    .getAll("category_id")
    .map(String)
    .filter(Boolean);

  if (categoryIds.length === 0) {
    throw new Error("No categories were submitted.");
  }

  const decisions = categoryIds.map((categoryId) => {
    const eligible = formData.get(`eligible_${categoryId}`) === "on";
    const rangeText = text(formData, `range_${categoryId}`);
    const rangeMin = eligible && rangeText ? Number(rangeText) : null;
    const rangeMax = rangeMin == null ? null : Number((rangeMin + 2).toFixed(2));

    if (
      eligible &&
      (!Number.isFinite(rangeMin) || rangeMin! < 1 || rangeMax! > 10)
    ) {
      throw new Error("Every eligible category needs a valid two-point range.");
    }

    return {
      category_id: categoryId,
      is_eligible: eligible,
      range_min: rangeMin,
      range_max: rangeMax,
      advisory_note: text(formData, `note_${categoryId}`) || null,
      owner_override: formData.get(`override_${categoryId}`) === "on",
      owner_override_note:
        text(formData, `override_note_${categoryId}`) || null,
    };
  });

  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "save_all_adjudication_category_proposals",
    {
      p_application_id: applicationId,
      p_decisions: decisions,
    },
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function respondCategoryProposal(
  applicationId: string,
  proposalId: string,
  responseValue: string,
  commentFieldName: string,
  formData: FormData,
) {
  const profile = await requireProfile(["adjudicator", "advisory_member"]);
  const response =
    responseValue === "disputed" ? "disputed" : "approved";
  const comment =
    response === "disputed" ? text(formData, commentFieldName) : "";

  if (response === "disputed" && comment.length < 3) {
    throw new Error("Add a comment explaining the dispute.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("adjudication_category_approvals")
    .upsert(
      {
        proposal_id: proposalId,
        adjudicator_user_id: profile.id,
        eligibility_approved: response === "approved",
        range_approved: response === "approved",
        response,
        comment: comment || null,
        responded_at: new Date().toISOString(),
      },
      { onConflict: "proposal_id,adjudicator_user_id" },
    );

  if (error) throw new Error(error.message);

  if (response === "disputed") {
    const { data: reviewers } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["advisory_member", "owner"])
      .eq("active", true);

    if ((reviewers ?? []).length > 0) {
      await supabase.from("user_notifications").insert(
        (reviewers ?? []).map((user) => ({
          user_id: user.id,
          notification_type: "category_proposal_disputed",
          title: "Category decision disputed",
          body: comment,
          href: `/portal/adjudication/${applicationId}`,
          related_application_id: applicationId,
        })),
      );
    }
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function submitPanelForOwnerReview(applicationId: string) {
  await requireProfile(["advisory_member", "owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_adjudication_for_owner", {
    p_application_id: applicationId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function ownerUpdateAdjudicationReview(
  applicationId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const status = text(formData, "status");
  if (!["owner_review", "returned", "released"].includes(status)) {
    throw new Error("Choose a valid review status.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("adjudication_reviews").upsert(
    {
      application_id: applicationId,
      status,
      owner_reviewed_by: owner.id,
      owner_reviewed_at: new Date().toISOString(),
      owner_note: text(formData, "owner_note") || null,
      returned_at: status === "returned" ? new Date().toISOString() : null,
    },
    { onConflict: "application_id" },
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/adjudication/${applicationId}`);
}

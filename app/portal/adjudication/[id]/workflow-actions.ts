"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveCategoryProposal(
  applicationId: string,
  categoryId: string,
  formData: FormData,
) {
  const profile = await requireProfile(["advisory_member", "owner"]);
  const supabase = await createClient();
  const eligible = formData.get("is_eligible") === "on";
  const rangeMin = eligible ? Number(text(formData, "range_min")) : null;
  const rangeMax = rangeMin == null ? null : Number((rangeMin + 2).toFixed(2));
  if (
    eligible &&
    (
      rangeMin == null ||
      rangeMax == null ||
      !Number.isFinite(rangeMin) ||
      rangeMin < 1 ||
      rangeMax > 10
    )
  ) {
    throw new Error("Choose a valid two-point range.");
  }

  const { data: existing } = await supabase
    .from("adjudication_category_proposals")
    .select("id")
    .eq("application_id", applicationId)
    .eq("category_id", categoryId)
    .maybeSingle();

  const { data: proposal, error } = await supabase
    .from("adjudication_category_proposals")
    .upsert(
      {
        application_id: applicationId,
        category_id: categoryId,
        proposed_by: profile.id,
        is_eligible: eligible,
        range_min: rangeMin,
        range_max: rangeMax,
        status: profile.role === "owner" && formData.get("owner_override") === "on" ? "overridden" : "proposed",
        advisory_note: text(formData, "advisory_note") || null,
        owner_override_note: profile.role === "owner" ? text(formData, "owner_override_note") || null : null,
      },
      { onConflict: "application_id,category_id" },
    )
    .select("id")
    .single();
  if (error || !proposal) throw new Error(error?.message ?? "Could not save proposal.");

  if (existing?.id) {
    const { error: deleteError } = await supabase
      .from("adjudication_category_approvals")
      .delete()
      .eq("proposal_id", existing.id);
    if (deleteError) throw new Error(deleteError.message);
  }

  const { data: assignments } = await supabase
    .from("adjudicator_assignments")
    .select("adjudicator_user_id")
    .eq("application_id", applicationId)
    .eq("can_score", true)
    .is("removed_at", null);

  if ((assignments ?? []).length > 0) {
    await supabase.from("user_notifications").insert(
      (assignments ?? []).map((assignment) => ({
        user_id: assignment.adjudicator_user_id,
        notification_type: "category_approval_required",
        title: "Category approval required",
        body: "The Advisory Committee proposed an eligibility decision and two-point range.",
        href: `/portal/adjudication/${applicationId}`,
        related_application_id: applicationId,
      })),
    );
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function respondCategoryProposal(
  applicationId: string,
  proposalId: string,
  formData: FormData,
) {
  const profile = await requireProfile(["adjudicator", "advisory_member"]);
  const response = text(formData, "response") === "disputed" ? "disputed" : "approved";
  const supabase = await createClient();
  const { error } = await supabase
    .from("adjudication_category_approvals")
    .upsert(
      {
        proposal_id: proposalId,
        adjudicator_user_id: profile.id,
        eligibility_approved: response === "approved" || formData.get("eligibility_approved") === "on",
        range_approved: response === "approved" || formData.get("range_approved") === "on",
        response,
        comment: text(formData, "comment") || null,
        responded_at: new Date().toISOString(),
      },
      { onConflict: "proposal_id,adjudicator_user_id" },
    );
  if (error) throw new Error(error.message);

  if (response === "disputed") {
    const { data: proposal } = await supabase
      .from("adjudication_category_proposals")
      .select("application_id")
      .eq("id", proposalId)
      .single();
    await supabase.from("user_notifications").insert(
      (await supabase.from("profiles").select("id").in("role", ["advisory_member", "owner"]).eq("active", true)).data?.map((user) => ({
        user_id: user.id,
        notification_type: "category_proposal_disputed",
        title: "Category decision disputed",
        body: text(formData, "comment") || "An adjudicator disputed an eligibility or range proposal.",
        href: `/portal/adjudication/${proposal?.application_id ?? applicationId}`,
        related_application_id: proposal?.application_id ?? applicationId,
      })) ?? [],
    );
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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const TESTIMONIAL_PATH = "/portal/community/testimonials";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELATIONSHIPS = new Set([
  "student",
  "educator",
  "adjudicator",
  "advisory_member",
  "production_team",
  "parent_guardian",
  "community_partner",
  "other",
]);

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function testimonialRedirect(kind: "error" | "saved", message: string): never {
  redirect(`${TESTIMONIAL_PATH}?${kind}=${encodeURIComponent(message)}`);
}

export async function submitCommunityTestimonial(formData: FormData) {
  const profile = await requireProfile();
  const testimonial = field(formData, "testimonial");
  const attributionName = field(formData, "attribution_name");
  const organization = field(formData, "organization");
  const relationship = field(formData, "relationship");
  const permissionToPublish = formData.get("permission_to_publish") === "on";

  if (testimonial.length < 50 || testimonial.length > 4000) {
    testimonialRedirect(
      "error",
      "Please write a testimonial between 50 and 4,000 characters.",
    );
  }
  if (!attributionName || attributionName.length > 150) {
    testimonialRedirect("error", "Enter the name you want shown with your testimonial.");
  }
  if (organization.length > 180) {
    testimonialRedirect("error", "Keep the school or organization under 180 characters.");
  }
  if (!RELATIONSHIPS.has(relationship)) {
    testimonialRedirect("error", "Choose your connection to GHSMTA.");
  }
  if (!permissionToPublish) {
    testimonialRedirect(
      "error",
      "Please give GHSMTA permission to use the testimonial before submitting it.",
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("community_testimonials").insert({
    submitted_by: profile.id,
    testimonial,
    attribution_name: attributionName,
    organization: organization || null,
    relationship,
    permission_to_publish: true,
    consented_at: new Date().toISOString(),
    status: "pending",
  });

  if (error) testimonialRedirect("error", error.message);

  revalidatePath(TESTIMONIAL_PATH);
  testimonialRedirect(
    "saved",
    "Thank you! Your testimonial was submitted for GHSMTA review.",
  );
}

export async function reviewCommunityTestimonial(
  testimonialId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const decision = field(formData, "decision");
  const ownerNotes = field(formData, "owner_notes");

  if (!UUID_PATTERN.test(testimonialId)) {
    testimonialRedirect("error", "That testimonial could not be found.");
  }
  if (decision !== "approved" && decision !== "declined") {
    testimonialRedirect("error", "Choose Approve or Decline.");
  }
  if (ownerNotes.length > 4000) {
    testimonialRedirect("error", "Keep the owner note under 4,000 characters.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("community_testimonials")
    .update({
      status: decision,
      owner_notes: ownerNotes || null,
      reviewed_by: owner.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", testimonialId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    testimonialRedirect(
      "error",
      error?.message ?? "That testimonial could not be found.",
    );
  }

  revalidatePath(TESTIMONIAL_PATH);
  testimonialRedirect(
    "saved",
    decision === "approved"
      ? "The testimonial was approved."
      : "The testimonial was declined.",
  );
}

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { portalAuthCallbackUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

const CONTRACTS_PATH = "/portal/admin/operations/contracts";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullable(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function required(formData: FormData, key: string, label: string) {
  const result = text(formData, key);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function amount(formData: FormData, key: string) {
  const raw = text(formData, key);
  if (!raw) return 0;
  const result = Number(raw);
  if (!Number.isFinite(result) || result < 0) {
    throw new Error(`${key} must be a valid positive amount.`);
  }
  return result;
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function dateAtNoonUtc(formData: FormData, key: string) {
  const date = nullable(formData, key);
  return date ? `${date}T12:00:00.000Z` : null;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function revalidateContracts() {
  revalidatePath(CONTRACTS_PATH);
  revalidatePath("/portal/admin/operations");
  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
  revalidatePath("/portal/admin/users");
}

async function ensureProductionChannel(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string,
  productionUserId: string,
) {
  const { data: channels, error: channelLookupError } = await admin
    .from("chat_channels")
    .select("id")
    .eq("channel_type", "group_direct_message")
    .eq("active", true)
    .ilike("name", "PRODUCTION")
    .order("created_at")
    .limit(1);

  if (channelLookupError) throw new Error(channelLookupError.message);

  let channelId = channels?.[0]?.id ?? null;
  if (!channelId) {
    const { data: channel, error: channelError } = await admin
      .from("chat_channels")
      .insert({
        channel_type: "group_direct_message",
        name: "PRODUCTION",
        description:
          "Private GHSMTA production team channel for contracted production personnel and Owners.",
        sidebar_section: "direct_messages",
        active: true,
        created_by: ownerId,
      })
      .select("id")
      .single();

    if (channelError || !channel) {
      throw new Error(channelError?.message ?? "The PRODUCTION chat could not be created.");
    }
    channelId = channel.id;
  }

  const { data: existingMembership, error: membershipLookupError } = await admin
    .from("chat_direct_participants")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("user_id", productionUserId)
    .maybeSingle();
  if (membershipLookupError) throw new Error(membershipLookupError.message);

  const { error: memberError } = await admin
    .from("chat_direct_participants")
    .upsert(
      [ownerId, productionUserId].map((userId) => ({
        channel_id: channelId,
        user_id: userId,
        added_by: ownerId,
      })),
      { onConflict: "channel_id,user_id" },
    );

  if (memberError) throw new Error(memberError.message);
  return { channelId, memberAdded: !existingMembership };
}

async function ensureContractorPortalAccess({
  ownerId,
  fullName,
  email,
}: {
  ownerId: string;
  fullName: string;
  email: string;
}) {
  const admin = createAdminClient();
  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,email,full_name,role,active")
    .ilike("email", email)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);

  let userId = existingProfile?.id ?? null;
  let inviteLink: string | null = null;

  if (!userId) {
    const headerStore = await headers();
    const { data: linkData, error: inviteError } =
      await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          data: {
            full_name: fullName,
            requested_role: "production",
          },
          redirectTo: portalAuthCallbackUrl("/portal/chat", headerStore.get("origin")),
        },
      });

    if (inviteError || !linkData.user) {
      throw new Error(inviteError?.message ?? "The Production portal account could not be created.");
    }

    userId = linkData.user.id;
    inviteLink = linkData.properties.action_link;
    const { error: newProfileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        role: "production",
        active: true,
      },
      { onConflict: "id" },
    );
    if (newProfileError) throw new Error(newProfileError.message);
  } else if (existingProfile && !existingProfile.active) {
    const { error: reactivateError } = await admin
      .from("profiles")
      .update({ active: true })
      .eq("id", userId);
    if (reactivateError) throw new Error(reactivateError.message);
  }

  const { channelId, memberAdded } = await ensureProductionChannel(admin, ownerId, userId);

  if (memberAdded) {
    const { error: notificationError } = await admin.from("user_notifications").insert({
      user_id: userId,
      notification_type: "production_contract_access",
      title: "You have been added to GHSMTA Production",
      body: "Your GHSMTA production contract is being managed in the portal. Use the private PRODUCTION chat for team communication.",
      href: `/portal/chat?channel=${channelId}`,
    });
    if (notificationError) throw new Error(notificationError.message);
  }

  if (inviteLink) {
    const safeName = escapeHtml(fullName);
    const emailResult = await sendSmtpEmail({
      to: [email],
      subject: "Your GHSMTA Production portal access",
      text: `Hello ${fullName}, a GHSMTA Owner added you to the Production team. Use this secure link to activate your portal account and open the private PRODUCTION chat: ${inviteLink}`,
      html: `<h2>GHSMTA Production portal access</h2><p>Hello ${safeName},</p><p>A GHSMTA Owner added you to the Production team. Your account includes access to the private <strong>PRODUCTION</strong> chat.</p><p><a href="${escapeHtml(inviteLink)}">Activate your portal account</a></p><p>This secure link is intended only for ${escapeHtml(email)}.</p>`,
    });

    if (!emailResult.ok) {
      await admin.from("user_notifications").insert({
        user_id: ownerId,
        notification_type: "production_invite_email_failed",
        title: `Production invitation email needs attention`,
        body: `${fullName}'s Production account was created, but the invitation email could not be delivered. ${emailResult.detail}`,
        href: "/portal/admin/users",
      });
    }
  }

  return userId;
}

function contractPayload(formData: FormData, contractorProfileId: string) {
  return {
    production_id: nullable(formData, "production_id"),
    contractor_profile_id: contractorProfileId,
    contract_number: nullable(formData, "contract_number"),
    contract_type: text(formData, "contract_type") || "work_for_hire",
    status: text(formData, "status") || "draft",
    contractor_name: required(formData, "contractor_name", "Contractor name"),
    contractor_email: normalizeEmail(
      required(formData, "contractor_email", "Contractor email"),
    ),
    contractor_phone: nullable(formData, "contractor_phone"),
    contractor_address: nullable(formData, "contractor_address"),
    role_title: required(formData, "role_title", "Contract role"),
    foundation_signer_name: nullable(formData, "foundation_signer_name"),
    agreement_date: nullable(formData, "agreement_date"),
    starts_on: nullable(formData, "starts_on"),
    ends_on: nullable(formData, "ends_on"),
    event_date: nullable(formData, "event_date"),
    total_consideration: amount(formData, "total_consideration"),
    responsibilities: nullable(formData, "responsibilities"),
    transportation: nullable(formData, "transportation"),
    lodging: nullable(formData, "lodging"),
    meals: nullable(formData, "meals"),
    out_of_pocket_expenses: nullable(formData, "out_of_pocket_expenses"),
    communication_credit: nullable(formData, "communication_credit"),
    contract_document_url: nullable(formData, "contract_document_url"),
    signed_document_url: nullable(formData, "signed_document_url"),
    w9_document_url: nullable(formData, "w9_document_url"),
    w9_received: checked(formData, "w9_received"),
    contractor_signed_at: dateAtNoonUtc(formData, "contractor_signed_on"),
    foundation_signed_at: dateAtNoonUtc(formData, "foundation_signed_on"),
    internal_notes: nullable(formData, "internal_notes"),
  };
}

export async function createOperationsContract(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const fullName = required(formData, "contractor_name", "Contractor name");
  const email = normalizeEmail(required(formData, "contractor_email", "Contractor email"));
  if (!email.includes("@")) throw new Error("Enter a valid contractor email address.");

  const contractorProfileId = await ensureContractorPortalAccess({
    ownerId: owner.id,
    fullName,
    email,
  });
  const admin = createAdminClient();
  const { error } = await admin.from("ghsmta_operations_contracts").insert({
    ...contractPayload(formData, contractorProfileId),
    created_by: owner.id,
    updated_by: owner.id,
  });
  if (error) throw new Error(error.message);
  revalidateContracts();
}

export async function updateOperationsContract(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const contractId = required(formData, "contract_id", "Contract");
  const fullName = required(formData, "contractor_name", "Contractor name");
  const email = normalizeEmail(required(formData, "contractor_email", "Contractor email"));
  if (!email.includes("@")) throw new Error("Enter a valid contractor email address.");

  const contractorProfileId = await ensureContractorPortalAccess({
    ownerId: owner.id,
    fullName,
    email,
  });
  const admin = createAdminClient();
  const { error } = await admin
    .from("ghsmta_operations_contracts")
    .update({
      ...contractPayload(formData, contractorProfileId),
      updated_by: owner.id,
    })
    .eq("id", contractId);
  if (error) throw new Error(error.message);
  revalidateContracts();
}

export async function deleteOperationsContract(formData: FormData) {
  await requireProfile(["owner"]);
  const contractId = required(formData, "contract_id", "Contract");
  const admin = createAdminClient();
  const { error } = await admin
    .from("ghsmta_operations_contracts")
    .delete()
    .eq("id", contractId);
  if (error) throw new Error(error.message);
  revalidateContracts();
}

export async function createContractPayment(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const { error } = await admin.from("ghsmta_operations_contract_payments").insert({
    contract_id: required(formData, "contract_id", "Contract"),
    installment_order: Number(text(formData, "installment_order") || 0),
    label: required(formData, "label", "Payment label"),
    deliverable: nullable(formData, "deliverable"),
    amount: amount(formData, "amount"),
    due_date: nullable(formData, "due_date"),
    status: text(formData, "status") || "scheduled",
    notes: nullable(formData, "notes"),
    created_by: owner.id,
    updated_by: owner.id,
  });
  if (error) throw new Error(error.message);
  revalidateContracts();
}

export async function updateContractPayment(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const paymentId = required(formData, "payment_id", "Payment");
  const admin = createAdminClient();
  const { error } = await admin
    .from("ghsmta_operations_contract_payments")
    .update({
      installment_order: Number(text(formData, "installment_order") || 0),
      label: required(formData, "label", "Payment label"),
      deliverable: nullable(formData, "deliverable"),
      amount: amount(formData, "amount"),
      due_date: nullable(formData, "due_date"),
      status: text(formData, "status") || "scheduled",
      invoice_received_at: dateAtNoonUtc(formData, "invoice_received_on"),
      paid_at: dateAtNoonUtc(formData, "paid_on"),
      notes: nullable(formData, "notes"),
      updated_by: owner.id,
    })
    .eq("id", paymentId);
  if (error) throw new Error(error.message);
  revalidateContracts();
}

export async function deleteContractPayment(formData: FormData) {
  await requireProfile(["owner"]);
  const paymentId = required(formData, "payment_id", "Payment");
  const admin = createAdminClient();
  const { error } = await admin
    .from("ghsmta_operations_contract_payments")
    .delete()
    .eq("id", paymentId);
  if (error) throw new Error(error.message);
  revalidateContracts();
}

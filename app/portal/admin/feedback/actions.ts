"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { isFeedbackStatus } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function ticketRedirect(
  ticketId: string,
  kind: "success" | "error",
  message: string,
): never {
  const query = new URLSearchParams({ [kind]: message });
  redirect(`/portal/admin/feedback/${ticketId}?${query.toString()}`);
}

function revalidateTicket(ticketId: string) {
  revalidatePath("/portal/admin/feedback");
  revalidatePath(`/portal/admin/feedback/${ticketId}`);
  revalidatePath("/portal/feedback");
}

export async function updateFeedbackTicket(
  ticketId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const status = text(formData, "status");
  const ownerNotes = text(formData, "owner_notes");
  if (!isFeedbackStatus(status) || status === "closed") {
    ticketRedirect(ticketId, "error", "Choose a valid active ticket status.");
  }
  if (ownerNotes.length > 10_000) {
    ticketRedirect(ticketId, "error", "The requester response must be 10,000 characters or fewer.");
  }

  const supabase = await createClient();
  const { data: ticket, error: readError } = await supabase
    .from("portal_feedback_requests")
    .select("id,status")
    .eq("id", ticketId)
    .single();
  if (readError || !ticket) {
    ticketRedirect(ticketId, "error", readError?.message ?? "Ticket not found.");
  }
  if (ticket.status === "closed") {
    ticketRedirect(ticketId, "error", "Reopen the ticket before editing it.");
  }

  const statusChanged = ticket.status !== status;
  const { data: updatedTicket, error } = await supabase
    .from("portal_feedback_requests")
    .update({
      status,
      owner_notes: ownerNotes || null,
      ...(statusChanged
        ? {
            status_changed_at: new Date().toISOString(),
            status_changed_by: owner.id,
          }
        : {}),
    })
    .eq("id", ticketId)
    .neq("status", "closed")
    .select("id")
    .maybeSingle();
  if (error) ticketRedirect(ticketId, "error", error.message);
  if (!updatedTicket) {
    ticketRedirect(
      ticketId,
      "error",
      "This ticket was closed while you were editing it. Reopen it before making changes.",
    );
  }

  revalidateTicket(ticketId);
  ticketRedirect(ticketId, "success", "Ticket updated.");
}

export async function closeFeedbackTicket(
  ticketId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const closureNote = text(formData, "closure_note");
  if (closureNote.length < 3 || closureNote.length > 10_000) {
    ticketRedirect(ticketId, "error", "Add a closure response between 3 and 10,000 characters.");
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data: closedTicket, error } = await supabase
    .from("portal_feedback_requests")
    .update({
      status: "closed",
      owner_notes: closureNote,
      status_changed_at: now,
      status_changed_by: owner.id,
      closed_at: now,
      closed_by: owner.id,
    })
    .eq("id", ticketId)
    .neq("status", "closed")
    .select("id")
    .maybeSingle();
  if (error) ticketRedirect(ticketId, "error", error.message);
  if (!closedTicket) {
    ticketRedirect(ticketId, "error", "This ticket is already closed or no longer exists.");
  }

  revalidateTicket(ticketId);
  ticketRedirect(ticketId, "success", "Ticket closed.");
}

export async function reopenFeedbackTicket(ticketId: string) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data: reopenedTicket, error } = await supabase
    .from("portal_feedback_requests")
    .update({
      status: "reviewing",
      status_changed_at: new Date().toISOString(),
      status_changed_by: owner.id,
      closed_at: null,
      closed_by: null,
    })
    .eq("id", ticketId)
    .eq("status", "closed")
    .select("id")
    .maybeSingle();
  if (error) ticketRedirect(ticketId, "error", error.message);
  if (!reopenedTicket) {
    ticketRedirect(ticketId, "error", "This ticket is already open or no longer exists.");
  }

  revalidateTicket(ticketId);
  ticketRedirect(ticketId, "success", "Ticket reopened for review.");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const GUEST_TICKET_PATH = "/portal/guest-ticket-request";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ticketRedirect(kind: "error" | "saved", message: string) {
  redirect(
    `${GUEST_TICKET_PATH}?${kind}=${encodeURIComponent(message)}`,
  );
}

export async function saveGuestTicketRequest(formData: FormData) {
  const profile = await requireProfile(["adjudicator", "advisory_member"]);
  const slotId = String(formData.get("slot_id") ?? "").trim();
  const response = String(formData.get("needs_guest_ticket") ?? "").trim();

  if (!UUID_PATTERN.test(slotId)) {
    ticketRedirect("error", "Choose an adjudication visit.");
  }
  if (response !== "yes" && response !== "no") {
    ticketRedirect("error", "Choose whether you need a guest ticket.");
  }

  const admin = createAdminClient();
  const [staffResult, slotResult, bookingResult] = await Promise.all([
    admin
      .from("schedule_slot_staff")
      .select("id")
      .eq("slot_id", slotId)
      .eq("user_id", profile.id)
      .eq("participation_mode", "panel")
      .maybeSingle(),
    admin
      .from("schedule_slots")
      .select("id,starts_at,status")
      .eq("id", slotId)
      .gt("starts_at", new Date().toISOString())
      .in("status", ["open", "closed"])
      .maybeSingle(),
    admin
      .from("schedule_school_bookings")
      .select("id")
      .eq("slot_id", slotId)
      .eq("approval_status", "confirmed")
      .maybeSingle(),
  ]);

  const accessError =
    staffResult.error ?? slotResult.error ?? bookingResult.error;
  if (accessError) ticketRedirect("error", accessError.message);
  if (!staffResult.data || !slotResult.data || !bookingResult.data) {
    ticketRedirect(
      "error",
      "This visit is not an active panel assignment on your schedule.",
    );
  }

  const { error } = await admin
    .from("adjudication_guest_ticket_requests")
    .upsert(
      {
        slot_id: slotId,
        user_id: profile.id,
        needs_guest_ticket: response === "yes",
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "slot_id,user_id" },
    );

  if (error) ticketRedirect("error", error.message);

  revalidatePath(GUEST_TICKET_PATH);
  ticketRedirect("saved", "Your guest-ticket request was saved.");
}

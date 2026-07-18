"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SCHEDULE_PATH = "/portal/schedule";
const EASTERN_TIME_ZONE = "America/New_York";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function scheduleRedirect(kind: "success" | "error", message: string): never {
  const params = new URLSearchParams({ [kind]: message });
  redirect(`${SCHEDULE_PATH}?${params.toString()}`);
}

function localDateTimeToIso(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );

  if (!match) {
    throw new Error("Enter a valid date and time.");
  }

  const [, year, month, day, hour, minute] = match;
  const targetUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(targetUtc))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const representedUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  const offset = representedUtc - targetUtc;
  return new Date(targetUtc - offset).toISOString();
}

function revalidateSchedule() {
  revalidatePath(SCHEDULE_PATH);
  revalidatePath("/portal/adjudication");
  revalidatePath("/portal/admin/scoring");
}

export async function createScheduleSlot(formData: FormData) {
  await requireProfile(["owner"]);

  const cycleId = text(formData, "cycle_id");
  const title = text(formData, "title");
  const startsAt = text(formData, "starts_at");
  const endsAt = text(formData, "ends_at");
  const location = text(formData, "location");
  const schoolInstructions = text(formData, "school_instructions");
  const status = text(formData, "status") || "open";

  if (!cycleId || !title || !startsAt || !endsAt) {
    scheduleRedirect("error", "Program, title, start, and end are required.");
  }

  const startsAtIso = localDateTimeToIso(startsAt);
  const endsAtIso = localDateTimeToIso(endsAt);

  if (new Date(endsAtIso) <= new Date(startsAtIso)) {
    scheduleRedirect("error", "The slot end must be after its start.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("schedule_slots").insert({
    cycle_id: cycleId,
    title,
    starts_at: startsAtIso,
    ends_at: endsAtIso,
    location: location || null,
    school_instructions: schoolInstructions || null,
    status,
  });

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect("success", "Schedule slot created.");
}

export async function updateScheduleSlot(slotId: string, formData: FormData) {
  await requireProfile(["owner"]);

  const title = text(formData, "title");
  const startsAt = text(formData, "starts_at");
  const endsAt = text(formData, "ends_at");
  const location = text(formData, "location");
  const schoolInstructions = text(formData, "school_instructions");
  const status = text(formData, "status") || "open";

  if (!title || !startsAt || !endsAt) {
    scheduleRedirect("error", "Title, start, and end are required.");
  }

  const startsAtIso = localDateTimeToIso(startsAt);
  const endsAtIso = localDateTimeToIso(endsAt);

  if (new Date(endsAtIso) <= new Date(startsAtIso)) {
    scheduleRedirect("error", "The slot end must be after its start.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_slots")
    .update({
      title,
      starts_at: startsAtIso,
      ends_at: endsAtIso,
      location: location || null,
      school_instructions: schoolInstructions || null,
      status,
    })
    .eq("id", slotId);

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect("success", "Schedule slot updated.");
}

export async function bookOwnScheduleSlot(formData: FormData) {
  await requireProfile(["applicant"]);

  const slotId = text(formData, "slot_id");
  const applicationId = text(formData, "application_id");

  if (!slotId || !applicationId) {
    scheduleRedirect("error", "Choose an application and schedule slot.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("book_schedule_slot", {
    p_slot_id: slotId,
    p_application_id: applicationId,
  });

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect(
    "success",
    "Your school is registered. Only an owner can change this reservation.",
  );
}

export async function joinScheduleSlot(formData: FormData) {
  await requireProfile(["adjudicator", "advisory_member"]);

  const slotId = text(formData, "slot_id");

  if (!slotId) {
    scheduleRedirect("error", "Schedule slot not found.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_schedule_slot", {
    p_slot_id: slotId,
  });

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect(
    "success",
    "You joined the slot. Only an owner can remove you.",
  );
}

export async function ownerAssignSchool(slotId: string, formData: FormData) {
  await requireProfile(["owner"]);

  const applicationId = text(formData, "application_id");
  if (!applicationId) {
    scheduleRedirect("error", "Choose a school application.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("owner_book_schedule_slot", {
    p_slot_id: slotId,
    p_application_id: applicationId,
  });

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect("success", "School assigned to the slot.");
}

export async function ownerAddStaff(slotId: string, formData: FormData) {
  await requireProfile(["owner"]);

  const userId = text(formData, "user_id");
  if (!userId) {
    scheduleRedirect("error", "Choose an adjudicator or advisory member.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("owner_add_schedule_staff", {
    p_slot_id: slotId,
    p_user_id: userId,
  });

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect("success", "Staff member added to the slot.");
}

export async function removeScheduleSchoolBooking(bookingId: string) {
  await requireProfile(["owner"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_school_bookings")
    .delete()
    .eq("id", bookingId);

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect("success", "School removed from the slot.");
}

export async function removeScheduleStaff(enrollmentId: string) {
  await requireProfile(["owner"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_slot_staff")
    .delete()
    .eq("id", enrollmentId);

  if (error) {
    scheduleRedirect("error", error.message);
  }

  revalidateSchedule();
  scheduleRedirect("success", "Staff member removed from the slot.");
}

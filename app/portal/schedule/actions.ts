"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sendSmtpEmail } from "@/lib/email/smtp";

const SCHEDULE_PATH = "/portal/schedule";
const EASTERN_TIME_ZONE = "America/New_York";
const MAX_BULK_SLOTS = 250;
const MAX_RECURRENCE_DAYS = 730;

type ScheduleTemplateKey = "timeslot_selected" | "timeslot_confirmed" | "waitlist_offer";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderScheduleTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
}

async function deliverScheduleTemplate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string,
  templateKey: ScheduleTemplateKey,
  applicationId: string,
  slotId: string,
) {
  const [{ data: template }, { data: application }, { data: slot }] = await Promise.all([
    supabase.from("portal_message_templates").select("*").eq("template_key", templateKey).eq("active", true).maybeSingle(),
    supabase.from("applications").select("id,school_name,production_title,applicant_user_id").eq("id", applicationId).single(),
    supabase.from("schedule_slots").select("id,title,starts_at,ends_at,location,school_instructions").eq("id", slotId).single(),
  ]);

  if (!template || !application || !slot) return;

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(slot.starts_at));
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const values = {
    school_name: application.school_name,
    production_title: application.production_title ?? "",
    slot_date: date,
    slot_time: `${timeFormatter.format(new Date(slot.starts_at))}–${timeFormatter.format(new Date(slot.ends_at))} ET`,
    location: slot.location ?? "Location to be confirmed",
    location_line: slot.location ? `Location: ${slot.location}.` : "",
    school_instructions: slot.school_instructions ?? "",
    offer_expires: "the deadline shown in Scheduling",
  };
  const subject = renderScheduleTemplate(template.subject_template, values);
  const body = renderScheduleTemplate(template.body_template, values);

  if (template.send_in_app && application.applicant_user_id) {
    await supabase.from("user_notifications").insert({
      user_id: application.applicant_user_id,
      notification_type: templateKey,
      title: subject,
      body,
      href: "/portal/schedule",
      related_application_id: applicationId,
    });
  }

  if (template.send_school_messaging) {
    const { data: channel } = await supabase
      .from("chat_channels")
      .select("id")
      .eq("application_id", applicationId)
      .eq("channel_type", "school_dm")
      .eq("active", true)
      .maybeSingle();
    if (channel) {
      await supabase.from("chat_posts").insert({
        channel_id: channel.id,
        author_id: actorId,
        subject: "Message",
        body,
      });
    }
  }

  if (template.send_email && application.applicant_user_id) {
    const { data: recipient } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", application.applicant_user_id)
      .maybeSingle();
    if (recipient?.email) {
      await sendSmtpEmail({
        to: [recipient.email],
        subject,
        text: body,
        html: `<p>${escapeHtml(body).replaceAll("\n", "<br>")}</p>`,
      });
    }
  }
}


function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function texts(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function positiveInteger(
  formData: FormData,
  key: string,
  fallback: number,
  maximum: number,
) {
  const rawValue = text(formData, key);
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${key.replaceAll("_", " ")} must be between 1 and ${maximum}.`);
  }

  return value;
}

function nonNegativeInteger(
  formData: FormData,
  key: string,
  fallback: number,
  maximum: number,
) {
  const rawValue = text(formData, key);
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${key.replaceAll("_", " ")} must be between 0 and ${maximum}.`);
  }

  return value;
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

function optionalLocalDateTimeToIso(value: string) {
  return value ? localDateTimeToIso(value) : null;
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("Enter a valid recurrence date.");

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function minutesToTime(totalMinutes: number) {
  if (totalMinutes < 0 || totalMinutes >= 24 * 60) {
    throw new Error("Recurring slots must begin and end on the same calendar day.");
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Enter a valid start time.");

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error("Enter a valid start time.");

  return hours * 60 + minutes;
}

function schoolAccessValues(formData: FormData) {
  const accessMode = text(formData, "school_access_mode") || "hidden";
  const closesAt = optionalLocalDateTimeToIso(text(formData, "school_booking_closes_at"));

  if (accessMode === "hidden") {
    return {
      school_booking_opens_at: null,
      school_booking_closes_at: null,
    };
  }

  if (accessMode === "open_now") {
    const opensAt = new Date().toISOString();
    if (closesAt && new Date(closesAt) <= new Date(opensAt)) {
      throw new Error("The school registration close time must be in the future.");
    }

    return {
      school_booking_opens_at: opensAt,
      school_booking_closes_at: closesAt,
    };
  }

  if (accessMode === "scheduled") {
    const opensAt = optionalLocalDateTimeToIso(
      text(formData, "school_booking_opens_at"),
    );

    if (!opensAt) {
      throw new Error("Choose when school registration should open.");
    }

    if (closesAt && new Date(closesAt) <= new Date(opensAt)) {
      throw new Error("The school registration close time must be after its opening time.");
    }

    return {
      school_booking_opens_at: opensAt,
      school_booking_closes_at: closesAt,
    };
  }

  throw new Error("Choose a valid school access option.");
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

  try {
    const startsAtIso = localDateTimeToIso(startsAt);
    const endsAtIso = localDateTimeToIso(endsAt);
    const schoolAccess = schoolAccessValues(formData);

    if (new Date(endsAtIso) <= new Date(startsAtIso)) {
      throw new Error("The slot end must be after its start.");
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
      ...schoolAccess,
    });

    if (error) throw new Error(error.message);
  } catch (error) {
    scheduleRedirect("error", error instanceof Error ? error.message : "Could not create slot.");
  }

  revalidateSchedule();
  scheduleRedirect("success", "Schedule slot created.");
}

export async function createRecurringScheduleSlots(formData: FormData) {
  await requireProfile(["owner"]);

  let successMessage = "Recurring schedule slots created.";

  try {
    const cycleId = text(formData, "cycle_id");
    const title = text(formData, "title");
    const startDateValue = text(formData, "series_start_date");
    const startTime = text(formData, "series_start_time");
    const repeatFrequency = text(formData, "repeat_frequency") || "once";
    const repeatUntilValue = text(formData, "repeat_until");
    const location = text(formData, "location");
    const schoolInstructions = text(formData, "school_instructions");
    const status = text(formData, "status") || "open";

    if (!cycleId || !title || !startDateValue || !startTime) {
      throw new Error("Program, title, first date, and start time are required.");
    }

    if (!["once", "daily", "weekly"].includes(repeatFrequency)) {
      throw new Error("Choose a valid repeat pattern.");
    }

    const durationMinutes = positiveInteger(
      formData,
      "slot_duration_minutes",
      60,
      720,
    );
    const slotsPerDay = positiveInteger(formData, "slots_per_day", 1, 24);
    const gapMinutes = nonNegativeInteger(formData, "gap_minutes", 0, 240);
    const repeatInterval = positiveInteger(formData, "repeat_interval", 1, 12);
    const startDate = parseDateOnly(startDateValue);
    const repeatUntil =
      repeatFrequency === "once"
        ? startDate
        : parseDateOnly(repeatUntilValue || startDateValue);
    const daySpan = Math.round(
      (repeatUntil.getTime() - startDate.getTime()) / 86_400_000,
    );

    if (daySpan < 0) throw new Error("Repeat until must be on or after the first date.");
    if (daySpan > MAX_RECURRENCE_DAYS) {
      throw new Error("Recurring series may span no more than two years.");
    }

    const selectedWeekdays = new Set(
      texts(formData, "weekly_days").map((value) => Number(value)),
    );
    if (repeatFrequency === "weekly" && selectedWeekdays.size === 0) {
      selectedWeekdays.add(startDate.getUTCDay());
    }

    const firstStartMinutes = timeToMinutes(startTime);
    const finalEndMinutes =
      firstStartMinutes +
      slotsPerDay * durationMinutes +
      Math.max(0, slotsPerDay - 1) * gapMinutes;
    if (finalEndMinutes > 24 * 60) {
      throw new Error("The final slot would extend past midnight. Reduce the slot count, duration, or gap.");
    }

    const selectedDates: Date[] = [];
    for (let offset = 0; offset <= daySpan; offset += 1) {
      const candidate = addUtcDays(startDate, offset);

      if (repeatFrequency === "once") {
        if (offset === 0) selectedDates.push(candidate);
        break;
      }

      if (repeatFrequency === "daily" && offset % repeatInterval === 0) {
        selectedDates.push(candidate);
      }

      if (repeatFrequency === "weekly") {
        const weekIndex = Math.floor(offset / 7);
        if (
          weekIndex % repeatInterval === 0 &&
          selectedWeekdays.has(candidate.getUTCDay())
        ) {
          selectedDates.push(candidate);
        }
      }
    }

    const slotCount = selectedDates.length * slotsPerDay;
    if (slotCount === 0) throw new Error("The repeat pattern did not produce any slots.");
    if (slotCount > MAX_BULK_SLOTS) {
      throw new Error(`A bulk series can create at most ${MAX_BULK_SLOTS} slots.`);
    }

    const schoolAccess = schoolAccessValues(formData);
    const seriesId = randomUUID();
    const rows = selectedDates.flatMap((date, dateIndex) =>
      Array.from({ length: slotsPerDay }, (_, slotIndex) => {
        const startMinutes =
          firstStartMinutes + slotIndex * (durationMinutes + gapMinutes);
        const endMinutes = startMinutes + durationMinutes;
        const dateValue = dateKey(date);

        return {
          cycle_id: cycleId,
          title,
          starts_at: localDateTimeToIso(
            `${dateValue}T${minutesToTime(startMinutes)}`,
          ),
          ends_at: localDateTimeToIso(
            `${dateValue}T${minutesToTime(endMinutes)}`,
          ),
          location: location || null,
          school_instructions: schoolInstructions || null,
          status,
          series_id: seriesId,
          series_sequence: dateIndex * slotsPerDay + slotIndex + 1,
          ...schoolAccess,
        };
      }),
    );

    const supabase = await createClient();
    const earliestStart = rows[0].starts_at;
    const latestStart = rows.at(-1)?.starts_at ?? earliestStart;
    const { data: existingData, error: existingError } = await supabase
      .from("schedule_slots")
      .select("starts_at,ends_at")
      .eq("cycle_id", cycleId)
      .gte("starts_at", earliestStart)
      .lte("starts_at", latestStart);

    if (existingError) throw new Error(existingError.message);

    const existingKeys = new Set(
      (existingData ?? []).map((slot) => `${slot.starts_at}|${slot.ends_at}`),
    );
    const insertRows = rows.filter(
      (row) => !existingKeys.has(`${row.starts_at}|${row.ends_at}`),
    );

    if (insertRows.length === 0) {
      throw new Error("All generated times already exist for this program.");
    }

    const { error: insertError } = await supabase
      .from("schedule_slots")
      .insert(insertRows);
    if (insertError) throw new Error(insertError.message);

    const skipped = rows.length - insertRows.length;
    successMessage = `${insertRows.length} schedule slot${
      insertRows.length === 1 ? "" : "s"
    } created${
      skipped
        ? `; ${skipped} duplicate time${skipped === 1 ? " was" : "s were"} skipped`
        : ""
    }.`;
  } catch (error) {
    scheduleRedirect(
      "error",
      error instanceof Error ? error.message : "Could not create recurring slots.",
    );
  }

  revalidateSchedule();
  scheduleRedirect("success", successMessage);
}

export async function bulkUpdateSchoolScheduleAccess(formData: FormData) {
  await requireProfile(["owner"]);

  try {
    const slotIds = [...new Set(texts(formData, "slot_ids"))].slice(0, 500);
    const accessAction = text(formData, "bulk_access_action");

    if (slotIds.length === 0) throw new Error("Select at least one schedule slot.");

    let updates: Record<string, string | null>;

    if (accessAction === "open_now") {
      const opensAt = new Date().toISOString();
      const closesAt = optionalLocalDateTimeToIso(
        text(formData, "bulk_school_booking_closes_at"),
      );
      if (closesAt && new Date(closesAt) <= new Date(opensAt)) {
        throw new Error("The close time must be in the future.");
      }

      updates = {
        status: "open",
        school_booking_opens_at: opensAt,
        school_booking_closes_at: closesAt,
      };
    } else if (accessAction === "schedule") {
      const opensAt = optionalLocalDateTimeToIso(
        text(formData, "bulk_school_booking_opens_at"),
      );
      const closesAt = optionalLocalDateTimeToIso(
        text(formData, "bulk_school_booking_closes_at"),
      );

      if (!opensAt) throw new Error("Choose the scheduled school opening time.");
      if (closesAt && new Date(closesAt) <= new Date(opensAt)) {
        throw new Error("The close time must be after the scheduled opening time.");
      }

      updates = {
        status: "open",
        school_booking_opens_at: opensAt,
        school_booking_closes_at: closesAt,
      };
    } else if (accessAction === "close_now") {
      updates = {
        school_booking_closes_at: new Date().toISOString(),
      };
    } else if (accessAction === "hide") {
      updates = {
        school_booking_opens_at: null,
        school_booking_closes_at: null,
      };
    } else {
      throw new Error("Choose a valid bulk school access action.");
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("schedule_slots")
      .update(updates)
      .in("id", slotIds)
      .neq("status", "cancelled");

    if (error) throw new Error(error.message);

  } catch (error) {
    scheduleRedirect(
      "error",
      error instanceof Error ? error.message : "Could not update school access.",
    );
  }

  revalidateSchedule();
  scheduleRedirect(
    "success",
    `School access updated for ${texts(formData, "slot_ids").length} selected slot${
      texts(formData, "slot_ids").length === 1 ? "" : "s"
    }.`,
  );
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

  try {
    const startsAtIso = localDateTimeToIso(startsAt);
    const endsAtIso = localDateTimeToIso(endsAt);
    const schoolBookingOpensAt = optionalLocalDateTimeToIso(
      text(formData, "school_booking_opens_at"),
    );
    const schoolBookingClosesAt = optionalLocalDateTimeToIso(
      text(formData, "school_booking_closes_at"),
    );

    if (new Date(endsAtIso) <= new Date(startsAtIso)) {
      throw new Error("The slot end must be after its start.");
    }

    if (
      schoolBookingOpensAt &&
      schoolBookingClosesAt &&
      new Date(schoolBookingClosesAt) <= new Date(schoolBookingOpensAt)
    ) {
      throw new Error("The school close time must be after its opening time.");
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
        school_booking_opens_at: schoolBookingOpensAt,
        school_booking_closes_at: schoolBookingClosesAt,
      })
      .eq("id", slotId);

    if (error) throw new Error(error.message);
  } catch (error) {
    scheduleRedirect("error", error instanceof Error ? error.message : "Could not update slot.");
  }

  revalidateSchedule();
  scheduleRedirect("success", "Schedule slot updated.");
}

export async function bookOwnScheduleSlot(formData: FormData) {

  const slotId = text(formData, "slot_id");
  const applicationId = text(formData, "application_id");

  if (!slotId || !applicationId) {
    scheduleRedirect("error", "Choose an application and schedule slot.");
  }

  const profile = await requireProfile(["applicant"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("book_schedule_slot", {
    p_slot_id: slotId,
    p_application_id: applicationId,
  });

  if (error) scheduleRedirect("error", error.message);

  const { error: pendingError } = await supabase
    .from("schedule_school_bookings")
    .update({
      approval_status: "pending",
      selected_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
    })
    .eq("slot_id", slotId)
    .eq("application_id", applicationId);

  if (pendingError) scheduleRedirect("error", pendingError.message);

  await deliverScheduleTemplate(
    supabase,
    profile.id,
    "timeslot_selected",
    applicationId,
    slotId,
  );

  revalidateSchedule();
  scheduleRedirect(
    "success",
    "Your school selected this timeslot. It is pending final Owner approval.",
  );
}

export async function joinScheduleSlot(formData: FormData) {
  await requireProfile(["adjudicator", "advisory_member"]);

  const slotId = text(formData, "slot_id");
  if (!slotId) scheduleRedirect("error", "Schedule slot not found.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_schedule_slot", {
    p_slot_id: slotId,
  });

  if (error) scheduleRedirect("error", error.message);

  revalidateSchedule();
  scheduleRedirect(
    "success",
    "You joined the slot. Only an owner can remove you.",
  );
}

export async function ownerAssignSchool(slotId: string, formData: FormData) {

  const applicationId = text(formData, "application_id");
  if (!applicationId) scheduleRedirect("error", "Choose a school application.");

  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("owner_book_schedule_slot", {
    p_slot_id: slotId,
    p_application_id: applicationId,
  });

  if (error) scheduleRedirect("error", error.message);

  await supabase
    .from("schedule_school_bookings")
    .update({
      approval_status: "confirmed",
      approved_at: new Date().toISOString(),
      approved_by: owner.id,
    })
    .eq("slot_id", slotId)
    .eq("application_id", applicationId);

  await deliverScheduleTemplate(
    supabase,
    owner.id,
    "timeslot_confirmed",
    applicationId,
    slotId,
  );

  revalidateSchedule();
  scheduleRedirect("success", "School assigned and confirmation sent.");
}

export async function ownerAddStaff(slotId: string, formData: FormData) {
  await requireProfile(["advisory_member", "owner"]);

  const userId = text(formData, "user_id");
  if (!userId) scheduleRedirect("error", "Choose an adjudicator or advisory member.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("manage_schedule_staff", {
    p_slot_id: slotId,
    p_user_id: userId,
    p_action: "add",
    p_reason: text(formData, "reason") || null,
  });

  if (error) scheduleRedirect("error", error.message);

  revalidateSchedule();
  scheduleRedirect("success", "Staff member added to the slot. Owners will see the change in their daily review.");
}

export async function removeScheduleSchoolBooking(bookingId: string) {
  await requireProfile(["owner"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_school_bookings")
    .delete()
    .eq("id", bookingId);

  if (error) scheduleRedirect("error", error.message);

  revalidateSchedule();
  scheduleRedirect("success", "School removed from the slot.");
}

export async function removeScheduleStaff(
  enrollmentId: string,
  formData: FormData,
) {
  await requireProfile(["advisory_member", "owner"]);

  const supabase = await createClient();
  const { data: enrollment, error: readError } = await supabase
    .from("schedule_slot_staff")
    .select("slot_id,user_id")
    .eq("id", enrollmentId)
    .single();

  if (readError || !enrollment) {
    scheduleRedirect("error", readError?.message ?? "Schedule participant not found.");
  }

  const { error } = await supabase.rpc("manage_schedule_staff", {
    p_slot_id: enrollment.slot_id,
    p_user_id: enrollment.user_id,
    p_action: "remove",
    p_reason: text(formData, "reason") || null,
  });

  if (error) scheduleRedirect("error", error.message);

  revalidateSchedule();
  scheduleRedirect("success", "Staff member removed. Owners will see the change in their daily review.");
}

export async function updateOwnScheduleSchoolDetails(slotId: string, formData: FormData) {
  await requireProfile(["applicant"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_own_schedule_school_details", {
    p_slot_id: slotId,
    p_venue_name: text(formData, "venue_name"),
    p_venue_address: text(formData, "venue_address"),
    p_arrival_entrance: text(formData, "arrival_entrance"),
    p_parking_instructions: text(formData, "parking_instructions"),
    p_accessibility_notes: text(formData, "accessibility_notes"),
    p_wifi_network: text(formData, "wifi_network"),
    p_wifi_password: text(formData, "wifi_password"),
    p_day_of_contact_name: text(formData, "day_of_contact_name"),
    p_day_of_contact_phone: text(formData, "day_of_contact_phone"),
  });

  if (error) scheduleRedirect("error", error.message);
  revalidateSchedule();
  scheduleRedirect("success", "School location, parking, and Wi-Fi details saved.");
}

export async function ownerUpdateScheduleSchoolDetails(slotId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const editDeadline = optionalLocalDateTimeToIso(text(formData, "edit_deadline"));
  const { error } = await supabase.from("schedule_slot_school_details").upsert({
    slot_id: slotId,
    venue_name: text(formData, "venue_name") || null,
    venue_address: text(formData, "venue_address") || null,
    arrival_entrance: text(formData, "arrival_entrance") || null,
    parking_instructions: text(formData, "parking_instructions") || null,
    accessibility_notes: text(formData, "accessibility_notes") || null,
    wifi_network: text(formData, "wifi_network") || null,
    wifi_password: text(formData, "wifi_password") || null,
    day_of_contact_name: text(formData, "day_of_contact_name") || null,
    day_of_contact_phone: text(formData, "day_of_contact_phone") || null,
    edit_deadline: editDeadline,
  }, { onConflict: "slot_id" });

  if (error) scheduleRedirect("error", error.message);
  revalidateSchedule();
  scheduleRedirect("success", "School visit details updated.");
}

export async function joinScheduleSlotWaitlist(slotId: string, formData: FormData) {
  await requireProfile(["applicant"]);
  const applicationId = text(formData, "application_id");
  if (!applicationId) scheduleRedirect("error", "Choose the school application joining this timeslot waitlist.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_schedule_slot_waitlist", {
    p_application_id: applicationId,
    p_slot_id: slotId,
    p_notes: text(formData, "notes") || null,
    p_alternate_date_1: text(formData, "alternate_date_1") || null,
    p_alternate_date_2: text(formData, "alternate_date_2") || null,
    p_alternate_date_3: text(formData, "alternate_date_3") || null,
    p_reason: text(formData, "reason") || null,
  });
  if (error) scheduleRedirect("error", error.message);
  revalidateSchedule();
  scheduleRedirect("success", "Your school joined this timeslot waitlist.");
}

export async function leaveScheduleSlotWaitlist(waitlistId: string) {
  await requireProfile(["applicant"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_schedule_slot_waitlist", { p_waitlist_id: waitlistId });
  if (error) scheduleRedirect("error", error.message);
  revalidateSchedule();
  scheduleRedirect("success", "Your school left this timeslot waitlist.");
}

export async function ownerOfferNextSlotWaitlist(slotId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("owner_offer_next_schedule_slot_waitlist", { p_slot_id: slotId, p_expires_minutes: 15 });
  if (error) scheduleRedirect("error", error.message);
  revalidateSchedule();
  scheduleRedirect("success", "The next school has a 15-minute exclusive timeslot offer.");
}

export async function acceptScheduleSlotWaitlistOffer(waitlistId: string) {
  await requireProfile(["applicant"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_schedule_slot_waitlist_offer", { p_waitlist_id: waitlistId });
  if (error) scheduleRedirect("error", error.message);
  if (!data) {
    revalidateSchedule();
    scheduleRedirect("error", "This timeslot offer expired. The next school on the waitlist has been notified.");
  }
  revalidateSchedule();
  scheduleRedirect("success", "Timeslot offer accepted and reservation confirmed.");
}

export async function declineScheduleSlotWaitlistOffer(waitlistId: string) {
  await requireProfile(["applicant"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_schedule_slot_waitlist_offer", { p_waitlist_id: waitlistId });
  if (error) scheduleRedirect("error", error.message);
  revalidateSchedule();
  scheduleRedirect("success", "Timeslot offer declined. The next school has been notified.");
}


export async function ownerConfirmScheduleBooking(
  bookingId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "owner_confirm_schedule_booking",
    {
      p_booking_id: bookingId,
      p_notes: text(formData, "approval_notes") || null,
    },
  );

  if (error) scheduleRedirect("error", error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (row) {
    await deliverScheduleTemplate(
      supabase,
      owner.id,
      "timeslot_confirmed",
      row.application_id,
      row.slot_id,
    );
  }

  revalidateSchedule();
  scheduleRedirect(
    "success",
    "Timeslot approved and final confirmation sent.",
  );
}

export async function ownerDeclineScheduleBooking(
  bookingId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);
  const reason = text(formData, "approval_notes");
  if (!reason) {
    scheduleRedirect(
      "error",
      "Add a reason before declining the school selection.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("owner_decline_schedule_booking", {
    p_booking_id: bookingId,
    p_notes: reason,
  });

  if (error) scheduleRedirect("error", error.message);
  revalidateSchedule();
  scheduleRedirect(
    "success",
    "School selection declined and the timeslot reopened.",
  );
}

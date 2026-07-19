#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt === -1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

function throwIfError(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service role key are required.");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const application = await supabase
    .from("applications")
    .select("id,applicant_user_id,school_id")
    .eq("source_system", "dummy-seed")
    .eq("source_record_id", "TEST-PAA-2025-2026-001")
    .maybeSingle();
  throwIfError(application, "Find dummy application");

  if (application.data) {
    const booking = await supabase
      .from("schedule_school_bookings")
      .select("slot_id")
      .eq("application_id", application.data.id)
      .maybeSingle();

    if (!booking.error && booking.data?.slot_id) {
      await supabase.from("schedule_school_bookings").delete().eq("application_id", application.data.id);
      await supabase.from("schedule_slots").delete().eq("id", booking.data.slot_id);
    }

    throwIfError(
      await supabase.from("applications").delete().eq("id", application.data.id),
      "Delete dummy application",
    );

    if (application.data.school_id) {
      await supabase.from("schools").delete().eq("id", application.data.school_id);
    }

    if (application.data.applicant_user_id) {
      const deleted = await supabase.auth.admin.deleteUser(application.data.applicant_user_id);
      if (deleted.error) throw new Error(`Delete dummy applicant: ${deleted.error.message}`);
    }
  }

  console.log("Dummy school data removed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

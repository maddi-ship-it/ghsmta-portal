#!/usr/bin/env node

// Usage after deploying the matching migration:
// npm run loadtest:schedule -- --users 200 --allow-host <project>.supabase.co

import { performance } from "node:perf_hooks";
import fs from "node:fs";
import process from "node:process";
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;

  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return Number(sorted[index].toFixed(1));
}

function latencySummary(values) {
  return {
    count: values.length,
    min_ms: percentile(values, 0),
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    p99_ms: percentile(values, 0.99),
    max_ms: percentile(values, 1),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(items[index], index);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function requireSuccess(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

loadEnvFile(new URL("../.env.local", import.meta.url));
loadEnvFile(new URL("../.env", import.meta.url));

const userCount = positiveInteger(option("--users", "60"), "--users");
const loginBatchSize = positiveInteger(option("--login-batch-size", "30"), "--login-batch-size");
const loginBatchDelayMs = positiveInteger(option("--login-batch-delay-ms", "65000"), "--login-batch-delay-ms");
const reuseCycleKey = option("--reuse-cycle-key");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const targetHost = new URL(supabaseUrl).hostname;
const allowedHost = option("--allow-host");
if (!allowedHost || allowedHost !== targetHost) {
  throw new Error(
    `Refusing to run against ${targetHost}. Re-run with --allow-host ${targetHost}.`,
  );
}

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fixture = {
  applicationIds: [],
  cycleId: null,
  cycleKey: null,
  schoolIds: [],
  slotId: null,
  userIds: [],
};
const channels = [];
let cleanupStarted = false;

async function deleteRows(table, column, values) {
  for (let index = 0; index < values.length; index += 100) {
    const chunk = values.slice(index, index + 100);
    if (chunk.length === 0) continue;
    const result = await admin.from(table).delete().in(column, chunk);
    if (result.error) throw new Error(`Cleanup ${table}: ${result.error.message}`);
  }
}

async function cleanup() {
  if (cleanupStarted) return { skipped: true };
  cleanupStarted = true;
  const errors = [];

  await Promise.allSettled(
    channels.map(async ({ client, channel }) => {
      await client.removeChannel(channel);
      client.realtime.disconnect();
    }),
  );

  const attempt = async (callback) => {
    try {
      await callback();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };

  await attempt(async () => {
    if (fixture.slotId) {
      const result = await admin
        .from("schedule_school_bookings")
        .delete()
        .eq("slot_id", fixture.slotId);
      if (result.error) throw new Error(`Cleanup booking: ${result.error.message}`);
    }
  });
  await attempt(async () => {
    if (fixture.slotId) {
      const result = await admin.from("schedule_slots").delete().eq("id", fixture.slotId);
      if (result.error) throw new Error(`Cleanup slot: ${result.error.message}`);
    }
  });
  await attempt(async () => {
    if (fixture.applicationIds.length > 0) {
      await deleteRows("applications", "id", fixture.applicationIds);
    }
  });
  await attempt(async () => {
    await deleteRows("application_audit_log", "subject_application_id", fixture.applicationIds);
  });
  await attempt(async () => {
    await deleteRows("schools", "id", fixture.schoolIds);
  });
  await attempt(async () => {
    if (fixture.cycleId) {
      const result = await admin.from("award_cycles").delete().eq("id", fixture.cycleId);
      if (result.error) throw new Error(`Cleanup cycle: ${result.error.message}`);
    }
  });
  await attempt(async () => {
    const deleteResults = await mapWithConcurrency(
      fixture.userIds,
      5,
      async (userId) => admin.auth.admin.deleteUser(userId),
    );
    for (const result of deleteResults) {
      if (result.error) errors.push(`Cleanup auth user: ${result.error.message}`);
    }
  });

  let remainingProfiles = null;
  if (fixture.userIds.length > 0) {
    const result = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("id", fixture.userIds);
    if (result.error) errors.push(`Verify profile cleanup: ${result.error.message}`);
    else remainingProfiles = result.count;
  }

  let remainingSlots = null;
  if (fixture.cycleId) {
    const result = await admin
      .from("schedule_slots")
      .select("id", { count: "exact", head: true })
      .eq("cycle_id", fixture.cycleId);
    if (result.error) errors.push(`Verify slot cleanup: ${result.error.message}`);
    else remainingSlots = result.count;
  }

  let remainingApplications = null;
  if (fixture.applicationIds.length > 0) {
    const result = await admin
      .from("applications")
      .select("id", { count: "exact", head: true })
      .in("id", fixture.applicationIds);
    if (result.error) errors.push(`Verify application cleanup: ${result.error.message}`);
    else remainingApplications = result.count;
  }

  let remainingCycles = null;
  if (fixture.cycleId) {
    const result = await admin
      .from("award_cycles")
      .select("id", { count: "exact", head: true })
      .eq("id", fixture.cycleId);
    if (result.error) errors.push(`Verify cycle cleanup: ${result.error.message}`);
    else remainingCycles = result.count;
  }

  return {
    passed:
      errors.length === 0 &&
      remainingProfiles === 0 &&
      remainingSlots === 0 &&
      remainingApplications === 0 &&
      remainingCycles === 0,
    remaining_profiles: remainingProfiles,
    remaining_slots: remainingSlots,
    remaining_applications: remainingApplications,
    remaining_cycles: remainingCycles,
    errors,
  };
}

const report = {
  run_id: runId,
  target_host: targetHost,
  virtual_users: userCount,
  started_at: new Date().toISOString(),
};

try {
  console.log(`Creating an isolated ${userCount}-user schedule fixture (${runId})...`);
  const fixtureStartedAt = performance.now();
  const now = Date.now();
  let reusableApplications = [];
  let cycle;
  if (reuseCycleKey) {
    cycle = requireSuccess(
      await admin
        .from("award_cycles")
        .update({
          is_active: false,
          status: "draft",
          opens_at: new Date(now - 60 * 60 * 1000).toISOString(),
          closes_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
          description: "Temporary isolated schedule concurrency test in progress.",
        })
        .eq("cycle_key", reuseCycleKey)
        .select("id,cycle_key")
        .single(),
      "Open reusable test cycle",
    );
    reusableApplications = requireSuccess(
      await admin
        .from("applications")
        .select("id,source_record_id")
        .eq("cycle_id", cycle.id)
        .order("source_record_id", { ascending: true }),
      "Read reusable test applications",
    );
    if (reusableApplications.length !== userCount) {
      throw new Error(
        `Reusable cycle has ${reusableApplications.length} applications; expected ${userCount}.`,
      );
    }
  } else {
    const cycleKey = `schedule-load-${runId}`;
    cycle = requireSuccess(
      await admin
        .from("award_cycles")
        .insert({
          name: `Schedule load test ${runId}`,
          season_year: `load-${runId}`,
          cycle_key: cycleKey,
          program_type: "other",
          description: "Temporary isolated schedule concurrency test in progress.",
          status: "draft",
          is_active: false,
          opens_at: new Date(now - 60 * 60 * 1000).toISOString(),
          closes_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
          source_system: "codex_schedule_load_test",
        })
        .select("id,cycle_key")
        .single(),
      "Create test cycle",
    );
  }
  fixture.cycleId = cycle.id;
  fixture.cycleKey = cycle.cycle_key;

  const testUsers = Array.from({ length: userCount }, (_, index) => ({
    email: `schedule-load-${runId}-${index + 1}@example.com`,
    password: `ScheduleLoad!${runId}!${index + 1}Aa9`,
  }));

  const createdUsers = await mapWithConcurrency(testUsers, 5, async (testUser, index) => {
    const result = await admin.auth.admin.createUser({
      email: testUser.email,
      password: testUser.password,
      email_confirm: true,
      user_metadata: { full_name: `Schedule Load User ${index + 1}` },
    });
    if (result.error || !result.data.user) {
      throw new Error(`Create test user ${index + 1}: ${result.error?.message ?? "No user returned"}`);
    }
    fixture.userIds.push(result.data.user.id);
    return { ...testUser, id: result.data.user.id };
  });

  const schoolRows = createdUsers.map((testUser, index) => ({
    name: `Schedule Load School ${runId} ${index + 1}`,
    city: "Load Test",
    county: "Temporary",
    school_code: `LOAD-${runId}-${index + 1}`,
  }));
  const schools = requireSuccess(
    await admin.from("schools").insert(schoolRows).select("id,name,school_code"),
    "Create test schools",
  );
  fixture.schoolIds = schools.map((school) => school.id);
  const schoolByCode = new Map(schools.map((school) => [school.school_code, school]));

  const applicationRows = createdUsers.map((testUser, index) => {
    const school = schoolByCode.get(`LOAD-${runId}-${index + 1}`);
    return {
      cycle_id: fixture.cycleId,
      applicant_user_id: testUser.id,
      school_id: school.id,
      school_name: school.name,
      production_title: `Load Test Production ${index + 1}`,
      status: "draft",
      form_data: { load_test_run: runId },
      source_system: "codex_schedule_load_test",
      source_record_id: `${runId}-${index + 1}`,
    };
  });
  const applications = reusableApplications.length > 0
    ? await mapWithConcurrency(reusableApplications, 10, async (application, index) => {
        const row = applicationRows[index];
        return requireSuccess(
          await admin
            .from("applications")
            .update({
              applicant_user_id: row.applicant_user_id,
              school_id: row.school_id,
              school_name: row.school_name,
              production_title: row.production_title,
              status: "draft",
              form_data: row.form_data,
              is_archived: false,
              archive_reason: null,
              archived_at: null,
              archived_by: null,
              archived_payload: {},
            })
            .eq("id", application.id)
            .select("id,applicant_user_id")
            .single(),
          `Reuse test application ${index + 1}`,
        );
      })
    : requireSuccess(
        await admin
          .from("applications")
          .insert(applicationRows)
          .select("id,applicant_user_id"),
        "Create test applications",
      );
  fixture.applicationIds = applications.map((application) => application.id);
  const applicationByUser = new Map(
    applications.map((application) => [application.applicant_user_id, application.id]),
  );

  const slot = requireSuccess(
    await admin
      .from("schedule_slots")
      .insert({
        cycle_id: fixture.cycleId,
        title: `Schedule load test ${runId}`,
        starts_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        ends_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
        location: "Temporary load-test slot",
        school_instructions: "Temporary test data; do not use.",
        status: "open",
        school_booking_opens_at: new Date(now - 60 * 1000).toISOString(),
        school_booking_closes_at: new Date(now + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single(),
    "Create test slot",
  );
  fixture.slotId = slot.id;
  report.fixture_setup_ms = Number((performance.now() - fixtureStartedAt).toFixed(1));

  const realtimeEvents = Array.from({ length: userCount }, () => null);
  const realtimePayloads = Array.from({ length: userCount }, () => null);
  const eventResolvers = [];
  const eventPromises = Array.from(
    { length: userCount },
    (_, index) => new Promise((resolve) => {
      eventResolvers[index] = resolve;
    }),
  );

  console.log(
    `Signing in applicants and opening private Broadcast connections in batches of ${loginBatchSize}...`,
  );
  const loginStartedAt = performance.now();
  const loginResults = [];
  const subscriptionResults = [];
  for (let index = 0; index < createdUsers.length; index += loginBatchSize) {
    const batch = createdUsers.slice(index, index + loginBatchSize);
    const results = await Promise.all(
      batch.map(async (testUser) => {
        const client = createClient(supabaseUrl, publishableKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const startedAt = performance.now();
        const result = await client.auth.signInWithPassword({
          email: testUser.email,
          password: testUser.password,
        });
        const latency = performance.now() - startedAt;
        return { client, testUser, latency, error: result.error };
      }),
    );
    const resultOffset = loginResults.length;
    loginResults.push(...results);
    const batchSubscriptions = await Promise.all(
      results.map(async ({ client, error }, batchIndex) => {
        if (error) return { status: "LOGIN_FAILED", latency: null };

        const clientIndex = resultOffset + batchIndex;
        const channel = client
          .channel("schedule:availability", { config: { private: true } })
          .on(
            "broadcast",
            { event: "availability_changed" },
            (message) => {
              const payload = message.payload;
              if (payload?.slot_id !== fixture.slotId || realtimeEvents[clientIndex] !== null) return;
              const receivedAt = performance.now();
              realtimeEvents[clientIndex] = receivedAt;
              realtimePayloads[clientIndex] = payload;
              eventResolvers[clientIndex]();
            },
          );
        channels.push({ client, channel });

        const startedAt = performance.now();
        await client.realtime.setAuth();
        const status = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve("SUBSCRIBE_TIMEOUT"), 15_000);
          channel.subscribe((nextStatus) => {
            if (nextStatus === "SUBSCRIBED" || ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(nextStatus)) {
              clearTimeout(timeout);
              resolve(nextStatus);
            }
          });
        });
        return { status, latency: performance.now() - startedAt };
      }),
    );
    subscriptionResults.push(...batchSubscriptions);
    if (index + loginBatchSize < createdUsers.length) {
      console.log(`Waiting ${Math.round(loginBatchDelayMs / 1000)}s for the Auth token bucket to refill...`);
      await delay(loginBatchDelayMs);
    }
  }
  const loginFailures = loginResults.filter((result) => result.error);
  report.login = {
    attempted: userCount,
    succeeded: userCount - loginFailures.length,
    failed: loginFailures.length,
    wall_ms: Number((performance.now() - loginStartedAt).toFixed(1)),
    pacing: { batch_size: loginBatchSize, delay_ms: loginBatchDelayMs },
    latency: latencySummary(loginResults.map((result) => result.latency)),
    errors: [...new Set(loginFailures.map((result) => result.error.message))],
  };
  if (loginFailures.length > 0) {
    throw new Error(`${loginFailures.length} virtual applicants could not sign in.`);
  }
  report.realtime_subscriptions = {
    subscribed: subscriptionResults.filter((result) => result.status === "SUBSCRIBED").length,
    statuses: subscriptionResults.reduce((counts, result) => {
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      return counts;
    }, {}),
    latency: latencySummary(subscriptionResults.map((result) => result.latency).filter((value) => value !== null)),
  };

  console.log(`Running ${userCount} initial availability reads before the booking race...`);
  const initialAvailability = await Promise.all(
    loginResults.map(async ({ client }) => {
      const startedAt = performance.now();
      const result = await client.rpc("get_schedule_slot_availability");
      return {
        latency: performance.now() - startedAt,
        error: result.error,
        sawSlot: result.data?.some((row) => row.slot_id === fixture.slotId) ?? false,
      };
    }),
  );
  report.initial_availability = {
    succeeded: initialAvailability.filter((result) => !result.error && result.sawSlot).length,
    failed: initialAvailability.filter((result) => result.error || !result.sawSlot).length,
    latency: latencySummary(initialAvailability.map((result) => result.latency)),
    errors: [...new Set(initialAvailability.filter((result) => result.error).map((result) => result.error.message))],
  };

  console.log(`Releasing ${userCount} simultaneous booking requests for the same slot...`);
  const raceStartedAt = performance.now();
  const bookingResults = await Promise.all(
    loginResults.map(async ({ client, testUser }) => {
      const startedAt = performance.now();
      const result = await client.rpc("book_schedule_slot", {
        p_slot_id: fixture.slotId,
        p_application_id: applicationByUser.get(testUser.id),
      });
      return {
        applicationId: applicationByUser.get(testUser.id),
        latency: performance.now() - startedAt,
        data: result.data,
        error: result.error,
      };
    }),
  );
  const raceFinishedAt = performance.now();
  const successfulBookings = bookingResults.filter((result) => !result.error);
  const failedBookings = bookingResults.filter((result) => result.error);
  const expectedCollision = "Another school selected this slot moments before you. Choose another available time.";
  const expectedCollisions = failedBookings.filter(
    (result) => result.error.message === expectedCollision,
  );
  const errorCounts = failedBookings.reduce((counts, result) => {
    counts[result.error.message] = (counts[result.error.message] ?? 0) + 1;
    return counts;
  }, {});

  const bookingRows = requireSuccess(
    await admin
      .from("schedule_school_bookings")
      .select("id,slot_id,application_id,booked_by")
      .eq("slot_id", fixture.slotId),
    "Verify booking rows",
  );
  report.booking_race = {
    attempted: userCount,
    succeeded: successfulBookings.length,
    expected_conflicts: expectedCollisions.length,
    unexpected_failures: failedBookings.length - expectedCollisions.length,
    wall_ms: Number((raceFinishedAt - raceStartedAt).toFixed(1)),
    latency: latencySummary(bookingResults.map((result) => result.latency)),
    errors: errorCounts,
    database_rows_for_slot: bookingRows.length,
    winner_matches_database:
      successfulBookings.length === 1 &&
      bookingRows.length === 1 &&
      successfulBookings[0].applicationId === bookingRows[0].application_id,
  };

  await Promise.race([
    Promise.all(eventPromises),
    delay(15_000),
  ]);
  const eventLatencies = realtimeEvents
    .filter((value) => value !== null)
    .map((receivedAt) => receivedAt - raceStartedAt);
  report.realtime_delivery = {
    received: eventLatencies.length,
    missed_after_15s: userCount - eventLatencies.length,
    correct_payloads: realtimePayloads.filter(
      (payload) => payload?.slot_id === fixture.slotId && payload?.is_booked === true,
    ).length,
    event_latency_from_race_start: latencySummary(eventLatencies),
    automatic_availability_queries: 0,
    automatic_page_refreshes: 0,
  };

  report.test_passed =
    report.login.succeeded === userCount &&
    report.realtime_subscriptions.subscribed === userCount &&
    report.initial_availability.succeeded === userCount &&
    report.booking_race.succeeded === 1 &&
    report.booking_race.expected_conflicts === userCount - 1 &&
    report.booking_race.unexpected_failures === 0 &&
    report.booking_race.database_rows_for_slot === 1 &&
    report.booking_race.winner_matches_database &&
    report.realtime_delivery.received === userCount &&
    report.realtime_delivery.correct_payloads === userCount;
} catch (error) {
  report.test_passed = false;
  report.fatal_error = error instanceof Error ? error.message : String(error);
} finally {
  console.log("Removing the temporary cycle, applications, slot, schools, and accounts...");
  report.cleanup = await cleanup();
  report.finished_at = new Date().toISOString();
  report.overall_passed = report.test_passed === true && report.cleanup.passed === true;
  console.log("SCHEDULE_LOAD_TEST_RESULT");
  console.log(JSON.stringify(report, null, 2));
}

if (!report.overall_passed) process.exitCode = 1;

#!/usr/bin/env node

/**
 * Pulls Acceptd application data into a local JSON snapshot for inspection.
 * This first-stage integration never writes to Supabase.
 *
 * Required server-only environment variable:
 *   ACCEPTD_API_TOKEN
 *
 * Usage:
 *   npm run acceptd:pull -- --output ./acceptd-applications.json
 *   npm run acceptd:pull -- --list-only --limit 10 --output ./acceptd-sample.json
 *   npm run acceptd:pull -- --query 'filter[program]=PROGRAM_ID' --output ./acceptd-applications.json
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createAcceptdClient } from "./lib/acceptd-client.mjs";

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;
  const contents = fs.readFileSync(filename, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function parseArgs(argv) {
  const options = { queries: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--list-only" || token === "--force" || token === "--help") {
      options[token.slice(2).replaceAll("-", "_")] = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value.`);
    }
    index += 1;
    const key = token.slice(2);
    if (key === "query") options.queries.push(value);
    else options[key.replaceAll("-", "_")] = value;
  }
  return options;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function queryEntries(values) {
  return values.map((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1) {
      throw new Error(`Invalid --query value "${entry}"; use key=value.`);
    }
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  });
}

function writeSnapshot(filename, snapshot, force) {
  const outputPath = path.resolve(filename);
  const flags = force ? "w" : "wx";
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    flag: flags,
    mode: 0o600,
  });
  fs.chmodSync(outputPath, 0o600);
  return outputPath;
}

function usage() {
  return `Pull Acceptd applications into a private local JSON snapshot.

Usage:
  npm run acceptd:pull -- --output <file> [options]

Options:
  --output <file>       Required destination; created with owner-only permissions
  --list-only           Skip per-application detail requests
  --limit <number>      Stop after this many applications
  --max-pages <number>  Pagination safety limit (default: 100)
  --concurrency <n>     Concurrent detail requests, 1-20 (default: 4)
  --query <key=value>   Pass an Acceptd list query; may be repeated
  --force               Explicitly allow overwriting the output file
  --help                Show this help

Environment:
  ACCEPTD_API_TOKEN       Required bearer token (server-only)
  ACCEPTD_API_BASE_URL    Optional; defaults to https://api.getacceptd.com
  ACCEPTD_API_TIMEOUT_MS  Optional request timeout (default: 30000)
`;
}

export async function main(argv = process.argv.slice(2)) {
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));

  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.output) {
    throw new Error("Provide --output so application PII is not printed to the terminal.");
  }

  const token = process.env.ACCEPTD_API_TOKEN;
  if (!token) {
    throw new Error(
      "ACCEPTD_API_TOKEN is required. Keep it server-only and never prefix it with NEXT_PUBLIC_.",
    );
  }

  const timeoutMs = positiveInteger(
    process.env.ACCEPTD_API_TIMEOUT_MS,
    30_000,
    "ACCEPTD_API_TIMEOUT_MS",
  );
  const maxPages = positiveInteger(args.max_pages, 100, "--max-pages");
  const concurrency = positiveInteger(args.concurrency, 4, "--concurrency");
  const limit = args.limit
    ? positiveInteger(args.limit, undefined, "--limit")
    : Number.POSITIVE_INFINITY;

  const client = createAcceptdClient({
    token,
    baseUrl: process.env.ACCEPTD_API_BASE_URL,
    timeoutMs,
  });

  console.log(
    `Pulling Acceptd applications${args.list_only ? " (list records only)" : " with details"}…`,
  );
  const result = await client.pullApplications({
    includeDetails: !args.list_only,
    concurrency,
    limit,
    maxPages,
    query: queryEntries(args.queries),
    onPage: ({ page, received }) =>
      console.log(`Received list page ${page} (${received} records).`),
  });

  const snapshot = {
    schema_version: 1,
    source: "acceptd-api-v2",
    pulled_at: new Date().toISOString(),
    includes_application_details: !args.list_only,
    application_count: result.applications.length,
    applications: result.applications,
  };
  const outputPath = writeSnapshot(args.output, snapshot, Boolean(args.force));
  console.log(
    `Saved ${result.applications.length} applications from ${result.pageCount} page(s) to ${outputPath}.`,
  );
  console.log("The snapshot may contain applicant PII; keep it out of source control.");
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Acceptd pull failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}

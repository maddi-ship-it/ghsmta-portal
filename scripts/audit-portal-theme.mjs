import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const portalRoot = path.join(projectRoot, "app", "portal");
const globalCssPath = path.join(projectRoot, "app", "globals.css");
const portalLayoutPath = path.join(portalRoot, "layout.tsx");

const roles = [
  "applicant",
  "adjudicator",
  "advisory_member",
  "program_manager",
  "owner",
];

const allRoles = [...roles];
const reviewRoles = ["adjudicator", "advisory_member", "owner"];
const ownerOnly = ["owner"];

const routeRoleCoverage = new Map([
  ["/portal", allRoles],
  ["/portal/account", allRoles],
  ["/portal/admin/applications", allRoles],
  ["/portal/appeals", allRoles],
  ["/portal/applications/[id]", allRoles],
  ["/portal/chat", allRoles],
  ["/portal/feedback", allRoles],
  ["/portal/files", allRoles],
  ["/portal/invoices", allRoles],
  ["/portal/notifications", allRoles],
  ["/portal/reference-documents", allRoles],
  ["/portal/schedule", allRoles],
  ["/portal/adjudication", reviewRoles],
  ["/portal/adjudication-sandbox", reviewRoles],
  ["/portal/adjudication/[id]", reviewRoles],
  ["/portal/digital-signing", ["adjudicator", "advisory_member"]],
  ["/portal/results", ["applicant", "program_manager"]],
  ["/portal/school-team", ["applicant"]],
  ["/portal/admin/cycles", ["advisory_member", "owner"]],
  ["/portal/admin/acceptd", ownerOnly],
  ["/portal/admin/archive", ownerOnly],
  ["/portal/admin/billing", ownerOnly],
  ["/portal/admin/feedback", ownerOnly],
  ["/portal/admin/feedback/[id]", ownerOnly],
  ["/portal/admin/forms", ownerOnly],
  ["/portal/admin/forms/[id]", ownerOnly],
  ["/portal/admin/operations", ownerOnly],
  ["/portal/admin/operations/schedule", ownerOnly],
  ["/portal/admin/operations/calls", ownerOnly],
  ["/portal/admin/operations/calls/[callId]", ownerOnly],
  ["/portal/admin/operations/budgets", ownerOnly],
  ["/portal/admin/operations/budgets/[productionId]", ownerOnly],
  ["/portal/admin/reports", ownerOnly],
  ["/portal/admin/scoring", ownerOnly],
  ["/portal/admin/scoring/rubrics/[id]", ownerOnly],
  ["/portal/admin/setup", ownerOnly],
  ["/portal/admin/users", ownerOnly],
  ["/portal/admin/workflows", ownerOnly],
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function pagePathToRoute(pagePath) {
  const relative = path.relative(portalRoot, path.dirname(pagePath));
  return relative === "" ? "/portal" : `/portal/${relative.split(path.sep).join("/")}`;
}

function fail(message) {
  console.error(`Theme audit failed: ${message}`);
  process.exitCode = 1;
}

const discoveredRoutes = walk(portalRoot)
  .filter((filePath) => path.basename(filePath) === "page.tsx")
  .map(pagePathToRoute)
  .sort();

const mappedRoutes = [...routeRoleCoverage.keys()].sort();
const missingRoutes = discoveredRoutes.filter((route) => !routeRoleCoverage.has(route));
const staleRoutes = mappedRoutes.filter((route) => !discoveredRoutes.includes(route));

if (missingRoutes.length > 0) {
  fail(`new portal pages need role coverage: ${missingRoutes.join(", ")}`);
}
if (staleRoutes.length > 0) {
  fail(`the role coverage map contains missing pages: ${staleRoutes.join(", ")}`);
}

for (const [route, coveredRoles] of routeRoleCoverage) {
  if (coveredRoles.length === 0) fail(`${route} is not assigned to any role`);
  for (const role of coveredRoles) {
    if (!roles.includes(role)) fail(`${route} contains unknown role ${role}`);
  }
}

const css = fs.readFileSync(globalCssPath, "utf8");
const layout = fs.readFileSync(portalLayoutPath, "utf8");

if (!layout.includes('data-portal-role={profile.role}')) {
  fail("the portal shell must expose its resolved role for role-aware QA");
}

const requiredAliases = new Map([
  ["--border", "var(--portal-line)"],
  ["--brand", "var(--portal-blue)"],
  ["--page-bg", "var(--portal-bg)"],
  ["--surface", "var(--portal-surface)"],
  ["--surface-muted", "var(--portal-surface-2)"],
  ["--surface-soft", "var(--portal-surface-3)"],
  ["--surface-subtle", "var(--portal-surface-2)"],
  ["--text", "var(--portal-text)"],
  ["--portal-surface-raised", "var(--portal-surface)"],
]);

for (const [name, value] of requiredAliases) {
  if (!css.includes(`${name}: ${value};`)) {
    fail(`missing semantic alias ${name}: ${value}`);
  }
}

function lastRuleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, "g"))];
  return matches.at(-1)?.[1] ?? "";
}

function variablesFrom(body) {
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*(#[\da-fA-F]{6})\s*;/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const channels = rgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

for (const theme of ["dark", "light"]) {
  const portalTokens = variablesFrom(lastRuleBody(`html[data-theme="${theme}"] .portal-shell`));
  const appTokens = variablesFrom(lastRuleBody(`html[data-theme="${theme}"]`));
  const contrastPairs = [
    [portalTokens, "--portal-ivory", "--portal-surface"],
    [portalTokens, "--portal-text", "--portal-surface"],
    [portalTokens, "--portal-muted", "--portal-surface"],
    [portalTokens, "--portal-gold-bright", "--portal-surface"],
    [portalTokens, "--portal-blue", "--portal-surface"],
    [appTokens, "--app-text", "--app-surface"],
    [appTokens, "--app-muted", "--app-surface"],
  ];

  for (const [tokens, foregroundName, backgroundName] of contrastPairs) {
    const foreground = tokens.get(foregroundName);
    const background = tokens.get(backgroundName);
    if (!foreground || !background) {
      fail(`${theme} theme is missing ${foregroundName} or ${backgroundName}`);
      continue;
    }
    const ratio = contrast(foreground, background);
    if (ratio < 4.5) {
      fail(
        `${theme} ${foregroundName} on ${backgroundName} has ${ratio.toFixed(2)}:1 contrast`,
      );
    }
  }
}

if (!process.exitCode) {
  const rolePageChecks = [...routeRoleCoverage.values()].reduce(
    (total, coveredRoles) => total + coveredRoles.length,
    0,
  );
  console.log(
    `Theme audit passed: ${discoveredRoutes.length} portal pages, ${roles.length} roles, ${rolePageChecks} role/page checks.`,
  );
}

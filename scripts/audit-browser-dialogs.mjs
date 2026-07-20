#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const roots = ["app", "components", "lib"];
const extensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const pattern = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/g;
const findings = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!extensions.has(path.extname(entry.name))) continue;

    const source = fs.readFileSync(fullPath, "utf8");
    for (const match of source.matchAll(pattern)) {
      const before = source.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      findings.push(`${fullPath}:${line}: ${match[0]}`);
    }
  }
}

for (const root of roots) walk(root);

if (findings.length > 0) {
  console.error("Browser-native dialogs remain in the portal:");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "\nReplace these with an inline state, toast, or RegalConfirmDialog.",
  );
  process.exit(1);
}

console.log("No browser-native alert(), confirm(), or prompt() calls found.");

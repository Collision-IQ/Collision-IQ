/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { execFileSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

// Files already covered by dedicated test:* package.json scripts — skip to avoid
// double execution when "test" calls both this runner and those scripts.
const EXCLUDED = new Set([
  "src/lib/ai/claimSpecificReportRegression.test.cjs",
]);

function walk(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, results);
    } else if (full.endsWith(".test.cjs")) {
      const rel = relative(process.cwd(), full).replace(/\\/g, "/");
      if (!EXCLUDED.has(rel)) {
        results.push(full);
      }
    }
  }
  return results;
}

const files = walk(join(process.cwd(), "src"));
const failed = [];

for (const file of files) {
  const rel = relative(process.cwd(), file);
  try {
    execFileSync(process.execPath, [file], { stdio: "inherit" });
  } catch {
    failed.push(rel);
    console.error(`\n[SUITE FAILED] ${rel}`);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} suite(s) failed:\n${failed.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log(`\nAll ${files.length} .cjs suite(s) passed.`);
}

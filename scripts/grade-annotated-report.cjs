#!/usr/bin/env node
/**
 * Grade an annotated delta report against an adjudicated manifest.
 *
 * Usage:
 *   node scripts/grade-annotated-report.cjs <report-text-file> <manifest.json>
 *
 * The report text is the pdftotext extraction of the produced annotated
 * estimate (keyed notes included). The manifest is a hand-adjudicated
 * expectation set (tests/fixtures/<ro>/adjudicated-manifest.json). An item
 * counts as covered when the report's notes reference its estimate line
 * number ("Ln 34") or its anchor text. Coverage is a REVIEW aid — it grades
 * recall against a human adjudication; it does not by itself prove the
 * report wrong, because the adjudication and the engine may legitimately
 * disagree (see the manifest's reconciliationCautions).
 */
const fs = require("node:fs");

const [reportPath, manifestPath] = process.argv.slice(2);
if (!reportPath || !manifestPath) {
  console.error("usage: grade-annotated-report.cjs <report-text-file> <manifest.json>");
  process.exit(2);
}

const report = fs.readFileSync(reportPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const compactReport = report.replace(/\s+/g, " ");

const results = manifest.items.map((item) => {
  const byLine = new RegExp(`\\bLn\\s*${item.line}\\b`).test(compactReport);
  const anchorPattern = item.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const byAnchor = new RegExp(anchorPattern, "i").test(compactReport);
  return { ...item, covered: byLine || byAnchor, byLine, byAnchor };
});

const covered = results.filter((row) => row.covered);
const byCategory = {};
for (const row of results) {
  byCategory[row.category] ??= { covered: 0, total: 0 };
  byCategory[row.category].total += 1;
  if (row.covered) byCategory[row.category].covered += 1;
}

console.log(`RO ${manifest.ro}: ${covered.length}/${results.length} adjudicated items referenced by the report`);
for (const [category, counts] of Object.entries(byCategory)) {
  console.log(`  ${category}: ${counts.covered}/${counts.total}`);
}
const missed = results.filter((row) => !row.covered);
if (missed.length) {
  console.log("\nNot referenced:");
  for (const row of missed) console.log(`  Ln ${row.line} [${row.category}] ${row.anchor}`);
}

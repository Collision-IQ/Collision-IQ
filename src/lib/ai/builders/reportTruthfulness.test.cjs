/* eslint-disable @typescript-eslint/no-require-imports */
// Report truthfulness rules (RO 22009 regression): narrative report builders
// must never emit comparison language without a real estimate pair, never
// attribute findings to a "carrier estimate"/"shop estimate" outside a
// comparison, never call non-estimate documents "estimates", and never print
// the same long sentence twice. Standalone because estimateExportQuality.test
// early-exits on its own backlog (tracked separately).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function registerTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  formatMileageDisplay,
  buildEstimatePrecisionNote,
} = require("./customerReportPdfBuilder.ts");
const {
  buildExecutiveSummary,
  dedupeRepeatedDocumentSentences,
} = require("./carrierPdfBuilder.ts");

let passed = 0;
let failed = 0;
function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

run("mileage mismatch names the reviewed documents, never 'estimates'", () => {
  // RO 22009: the two readings came from a dealer quote and a scan report —
  // there were no estimates to disagree.
  const display = formatMileageDisplay(null, [51709, 83219]);
  assert.match(display, /across the reviewed documents/);
  assert.doesNotMatch(display, /across estimates/);
  const minor = formatMileageDisplay(null, [51709, 51900]);
  assert.match(minor, /minor discrepancy .* across the reviewed documents/);
});

const NOTE_REPORT = {
  openingSummary: "The estimate lists paint supplies and an A/M grille.",
  whichRepairPlanLooksStronger: "",
  safetyFirst: "",
  bottomLine: "",
  whatStillNeedsProof: [],
  yourOptions: [],
};

run("precision note drops 'differences' language when no comparison exists", () => {
  const single = buildEstimatePrecisionNote(NOTE_REPORT, [], false);
  assert.ok(single.length > 0, "note still emitted");
  assert.doesNotMatch(single, /differences/i);
  assert.match(single, /stay tied to the exact estimate line/);
  const comparison = buildEstimatePrecisionNote(NOTE_REPORT, [], true);
  assert.match(comparison, /specific differences/);
});

run("executive summary never restates the same open-item list twice", () => {
  const summary = buildExecutiveSummary({
    isComparison: false,
    credibilityConclusion: "The current file identifies specific verification items that need line-item support.",
    whyItWins: "The file most clearly leaves open adas calibration procedure support, structural measurement verification, and test-fit road-test and alignment proof.",
    strongestDisputes: "adas calibration procedure support, structural measurement verification, and test-fit road-test and alignment proof",
  });
  const occurrences = summary.match(/adas calibration procedure support/gi) ?? [];
  assert.equal(occurrences.length, 1, summary);
  // When the lists differ, the unresolved-items sentence still appears.
  const distinct = buildExecutiveSummary({
    isComparison: false,
    credibilityConclusion: "Conclusion.",
    whyItWins: "The file most clearly leaves open calibration support.",
    strongestDisputes: "alignment proof and teardown photos",
  });
  assert.match(distinct, /The unresolved review items are alignment proof and teardown photos/);
});

run("repeated long sentences render once across the document", () => {
  const repeated =
    "Based on the documents reviewed, your BMW X5 appears repairable, and the estimate includes several important repair-planning items that we like to see in a complete file.";
  const document = dedupeRepeatedDocumentSentences({
    brand: { companyName: "x", reportLabel: "x", logoPath: "x" },
    header: { title: "t", subtitle: "s", generatedLabel: "g" },
    summary: [],
    sections: [
      { title: "Plain-English Summary", body: `${repeated} The plan needs supporting records.` },
      { title: "What This Means", body: `${repeated} Ask the shop. Ask the shop.` },
    ],
    footer: [],
  });
  const combined = document.sections.map((section) => section.body).join(" ");
  const hits = combined.match(/appears repairable/g) ?? [];
  assert.equal(hits.length, 1, combined);
  // Short recurring phrases are untouched.
  assert.match(document.sections[1].body, /Ask the shop. Ask the shop./);
});

console.log(`\nreportTruthfulness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

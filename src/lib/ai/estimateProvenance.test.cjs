/* eslint-disable @typescript-eslint/no-require-imports */
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
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { resolveEstimateVersionLabels, isSameSourceEstimatePair, extractEstimateProvenance } =
  require("./estimateProvenance.ts");
const { buildComparisonAnalysis } = require("./builders/comparisonEngine.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const ORIGINAL_5_15 = [
  "Conestoga Autobody",
  "Repair Order: RO12345",
  "Workfile ID: WF-7",
  "Written By: Vincent Menichetti",
  "Estimate Date: 5/15/2026",
  "Insurance Company: USAA",
  "Owner/Insured: OLIVARES, ESMON",
  "Repl Front bumper cover 2.0",
  "Grand Total 11892.26",
].join("\n");

const SUPPLEMENT_6_23 = [
  "Conestoga Autobody",
  "Repair Order: RO12345",
  "Workfile ID: WF-7",
  "Written By: Vincent Menichetti",
  "Estimate Date: 6/23/2026",
  "Insurance Company: USAA",
  "Owner/Insured: OLIVARES, ESMON",
  "Repl Front bumper cover 2.0",
  "Repl Rear suspension crossmember 3.0",
  "Grand Total 17397.20",
].join("\n");

run("two same-RO Conestoga estimates classify as original + supplement, never carrier (Fix 1)", () => {
  // Provenance: same RO/workfile/writer -> same source.
  assert.equal(
    isSameSourceEstimatePair(
      extractEstimateProvenance(ORIGINAL_5_15),
      extractEstimateProvenance(SUPPLEMENT_6_23)
    ),
    true
  );

  // Pass them out of date order to also exercise date-based ordering (older = original).
  const versioned = resolveEstimateVersionLabels(
    { text: SUPPLEMENT_6_23, filename: "Shop Final 21896.pdf" },
    { text: ORIGINAL_5_15, filename: "Shop 21896.pdf" },
    (input, fallback) => fallback
  );

  assert.equal(versioned.sameSource, true);
  assert.equal(versioned.older.label, "Original estimate");
  assert.equal(versioned.newer.label, "Supplement");
  // The 5/15 estimate is the original; the 6/23 estimate is the supplement.
  assert.match(versioned.older.text, /11892\.26/);
  assert.match(versioned.newer.text, /17397\.20/);
  // Neither version is tagged "carrier".
  assert.doesNotMatch(versioned.older.label, /carrier/i);
  assert.doesNotMatch(versioned.newer.label, /carrier/i);

  // The delta between the two versions is +$5,504.94.
  const analysis = buildComparisonAnalysis({
    shopEstimateText: versioned.older.text,
    insurerEstimateText: versioned.newer.text,
    shopEstimateLabel: versioned.older.label,
    insurerEstimateLabel: versioned.newer.label,
  });
  const totalRow = analysis.estimateComparisons.rows.find((row) => row.id === "estimate-total");
  assert.equal(Math.abs(totalRow.delta), 5504.94);
  // The comparison rows are labeled by version, not carrier/shop.
  assert.equal(totalRow.rhsSource, "Supplement");
  assert.equal(totalRow.lhsSource, "Original estimate");
});

run("two independently-authored estimates are not forced into original/supplement", () => {
  const shop = "Written By: Vincent Menichetti\nRepair Order: RO-1000\nEstimate Date: 5/1/2026\nGrand Total 9000.00";
  const carrier = "Written By: State Farm Adjuster\nRepair Order: RO-2000\nEstimate Date: 5/2/2026\nGrand Total 8000.00";
  assert.equal(
    isSameSourceEstimatePair(extractEstimateProvenance(shop), extractEstimateProvenance(carrier)),
    false
  );
});

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

// CCC ONE text layers often print a block of labels and then their values
// below ("Workfile ID:\nFederal ID:\n<id>\n<federal id>"). A reader whose
// whitespace crosses the newline takes the next label word as the value, so
// two different shops' prints both read "FEDERAL" and were called one source.
const labelsThenValues = (workfile, federal) =>
  ["Workfile ID:", "Federal ID:", workfile, federal, "Estimate Date: 5/1/2026"].join("\n");

run("labels-then-values prints from different workfiles are not the same source", () => {
  const a = extractEstimateProvenance(labelsThenValues("a1b2c3d4", "12-3456789"));
  const b = extractEstimateProvenance(labelsThenValues("9f8e7d6c", "98-7654321"));
  assert.equal(a.workfileId, "A1B2C3D4");
  assert.equal(b.workfileId, "9F8E7D6C");
  assert.equal(isSameSourceEstimatePair(a, b), false);
});

run("the same workfile printed inline and as labels-then-values is the same source", () => {
  const inline = extractEstimateProvenance("Workfile ID: 613bea70\nEstimate Date: 5/1/2026");
  const stacked = extractEstimateProvenance(labelsThenValues("613bea70", "12-3456789"));
  const nextLine = extractEstimateProvenance("Workfile ID:\n613bea70\nEstimate Date: 6/1/2026");
  assert.equal(inline.workfileId, "613BEA70");
  assert.equal(stacked.workfileId, "613BEA70");
  assert.equal(nextLine.workfileId, "613BEA70");
  assert.equal(isSameSourceEstimatePair(inline, stacked), true);
  assert.equal(isSameSourceEstimatePair(inline, nextLine), true);
});

run("OCR letter/digit confusions in a workfile ID do not split one workfile", () => {
  const clean = extractEstimateProvenance("Workfile ID: 613bea70");
  const ocr = extractEstimateProvenance("Workfile ID: 6l3bea7O");
  assert.equal(isSameSourceEstimatePair(clean, ocr), true);
});

run("a label word is never read as an RO number, workfile ID, or writer", () => {
  const prov = extractEstimateProvenance(
    ["Repair Order:", "Workfile ID:", "Written By:", "Federal ID:", "Estimate Date: 5/1/2026"].join("\n")
  );
  assert.equal(prov.roNumber, null);
  assert.equal(prov.workfileId, null);
  assert.equal(prov.writtenBy, null);
  // Two such prints carry no identity at all, so they are not the same source.
  assert.equal(isSameSourceEstimatePair(prov, extractEstimateProvenance(
    ["Repair Order:", "Workfile ID:", "Written By:", "Federal ID:", "Estimate Date: 6/1/2026"].join("\n")
  )), false);
});

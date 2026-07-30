/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: RO 22047 — a carrier estimate labeled only by document type
// ("EOR" filename / "Estimate of Record" title) matched none of the insurer
// filename keywords, so a shop + carrier pair was analyzed as two VERSIONS of
// one estimate instead of a shop-vs-carrier comparison. Carrier-authored
// estimates must be recognized by their document-type designation too.
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

const { runRepairAnalysis } = require("./analysisOrchestrator.ts");

let passed = 0;
let failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

const ESTIMATE_BODY = [
  "Line Oper Description Part Number Qty Extended Price $ Labor Paint",
  "1 R&I RT Bumper cover PT00654961A 1 78.00 0.3 0.0",
  "2 Repl LT Headlamp assy PT00983789A 1 1,130.27 0.5 0.0",
  "3 Rpr Quarter panel 0 0.00 2.5 1.3",
  "SUBTOTALS 3,254.43 33.9 10.9",
  "ESTIMATE TOTALS",
  "Grand Total 11,296.09",
].join("\n");

const SHOP_DOC = {
  id: "shop-doc",
  filename: "Shop 12345.pdf",
  type: "application/pdf",
  text: [
    "Preliminary Estimate",
    "RO Number: 12345 Written By: SAMPLE ESTIMATOR",
    "Workfile ID: abc12345",
    ESTIMATE_BODY,
  ].join("\n"),
};

// Carrier estimate with NO insurer keyword in the filename — only the
// document-type designation identifies it.
const CARRIER_EOR_DOC = {
  id: "carrier-eor-doc",
  filename: "Sample EOR 12345.pdf",
  type: "application/pdf",
  text: [
    "SAMPLE MUTUAL AUTOMOBILE ASSOCIATION",
    "Estimate of Record",
    "Written By: SAMPLE APPRAISER, License Number: 000000",
    "Workfile ID: def67890",
    ESTIMATE_BODY,
    "Total Cost of Repairs 9,218.43",
  ].join("\n"),
};

(async () => {
  await run("shop + EOR pair is analyzed as shop-vs-carrier, not estimate versions", async () => {
    const report = await runRepairAnalysis({
      artifactIds: [SHOP_DOC.id, CARRIER_EOR_DOC.id],
      preloadedAttachments: [SHOP_DOC, CARRIER_EOR_DOC],
      sessionContext: null,
      userIntent: null,
    });
    const evidenceSources = (report.evidence ?? []).map((entry) => entry.source);
    assert.ok(
      evidenceSources.includes("Carrier estimate"),
      `expected a "Carrier estimate" evidence source, got: ${JSON.stringify(evidenceSources)}`
    );
    assert.ok(
      evidenceSources.includes("Shop estimate"),
      `expected a "Shop estimate" evidence source, got: ${JSON.stringify(evidenceSources)}`
    );
  });

  await run("fragmented EOR text (embedded OCR layer) is still detected as the carrier side", async () => {
    // One token per line with no "EOR" filename token — only the fragmented
    // "Estimate\nof\nRecord" designation identifies the carrier document.
    const fragmentedEor = {
      id: "fragmented-eor-doc",
      filename: "Sample_carrier_document_scan.pdf",
      type: "application/pdf",
      text: [
        "SAMPLE", "MUTUAL", "AUTOMOBILE", "ASSOCIATION",
        "Estimate", "of", "Record",
        "Written", "By:", "SAMPLE", "APPRAISER",
        ESTIMATE_BODY,
        "Total Cost of Repairs 9,218.43",
      ].join("\n"),
    };
    const report = await runRepairAnalysis({
      artifactIds: [SHOP_DOC.id, fragmentedEor.id],
      preloadedAttachments: [SHOP_DOC, fragmentedEor],
      sessionContext: null,
      userIntent: null,
    });
    const evidenceSources = (report.evidence ?? []).map((entry) => entry.source);
    assert.ok(
      evidenceSources.includes("Carrier estimate"),
      `expected fragmented EOR to pair as carrier, got: ${JSON.stringify(evidenceSources)}`
    );
  });

  await run("two shop estimate versions still take the version-pair path", async () => {
    // No carrier-authored document present: the EOR fallback must not invent
    // an insurer side, so same-job versions stay a version comparison.
    const shopV2 = {
      id: "shop-doc-v2",
      filename: "Shop 12345 supplement 2.pdf",
      type: "application/pdf",
      text: [
        "Supplement 2 with Summary",
        "RO Number: 12345 Written By: SAMPLE ESTIMATOR",
        "Workfile ID: abc12345",
        ESTIMATE_BODY,
      ].join("\n"),
    };
    const report = await runRepairAnalysis({
      artifactIds: [SHOP_DOC.id, shopV2.id],
      preloadedAttachments: [SHOP_DOC, shopV2],
      sessionContext: null,
      userIntent: null,
    });
    const evidenceSources = (report.evidence ?? []).map((entry) => entry.source);
    assert.ok(
      !evidenceSources.includes("Carrier estimate"),
      `same-source versions must not gain a carrier side, got: ${JSON.stringify(evidenceSources)}`
    );
  });

  console.log(`\nanalysisOrchestrator: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();

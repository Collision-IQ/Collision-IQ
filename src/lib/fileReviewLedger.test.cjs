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

const { buildFileReviewLedger } = require("./fileReviewLedger.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// A CCC estimate frequently bundles a work-authorization / contract page in the same PDF.
// That must NOT cause the estimate to be flagged support-only / non-estimate. This fixture
// has strong estimate signals plus work-authorization language so the support-only category
// is present in the evidence categories, exercising the DEFECT C guard.
const estimateWithAuthorizationText = [
  "CCC ONE Estimating",
  "Workfile ID: ABC123",
  "Insurance Company: USAA",
  "Owner/Insured: OLIVARES, ESMON",
  "2021 Honda CR-V",
  "Line 1 Repl Front bumper cover 2.0 $450.00",
  "Line 2 R&I Headlamp assembly 0.5 $60.00",
  "Total Cost of Repairs $11,892.26",
  "Work Authorization: vehicle owner authorizes the repair facility to perform repairs.",
].join("\n");

run("a documentType=estimate file is never support-only or flagged non-estimate", () => {
  const attachments = [
    {
      id: "att-estimate-1",
      filename: "Shop 21896.pdf",
      type: "application/pdf",
      text: estimateWithAuthorizationText,
      sha256: "hash-estimate-1",
      sizeBytes: 54321,
      classification: "pdf",
      imageDataUrl: null,
    },
  ];

  const ledger = buildFileReviewLedger(attachments);
  const entry = ledger[0];

  // The bundled authorization language must not demote the estimate.
  assert.equal(entry.documentType, "estimate");
  assert.equal(entry.usedAsSupportOnly, false);
  assert.equal(entry.usedInDetermination, true);
  assert.equal(entry.isReviewable, true);
  assert.equal(entry.reviewedForDetermination, true);
  assert.doesNotMatch(entry.reviewabilityHint, /support context only/i);
});

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

const {
  clampVerificationItemCount,
  resolveReportCompletionState,
} = require("./reviewCompleteness.ts");
const { cleanUserFacingPresentationText } = require("./ui/presentationText.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("verification item count is clamped to >= 0 (Fix 5)", () => {
  assert.equal(clampVerificationItemCount(-24), 0);
  assert.equal(clampVerificationItemCount(-1, "carrier_pdf"), 0);
  assert.equal(clampVerificationItemCount(3), 3);
  assert.equal(clampVerificationItemCount(null), 0);
  assert.equal(clampVerificationItemCount(undefined), 0);
});

run("report renders final only when diagnostics done, count >= 0, and file sets match (Fix 5)", () => {
  const ready = resolveReportCompletionState({
    diagnosticsReady: true,
    verificationItemCount: 2,
    renderedFileIds: ["a", "b", "c"],
    indexedFileIds: ["c", "b", "a"],
  });
  assert.equal(ready.state, "final");
  assert.deepEqual(ready.reasons, []);

  // Diagnostics not finished -> partial.
  assert.equal(
    resolveReportCompletionState({
      diagnosticsReady: false,
      verificationItemCount: 0,
      renderedFileIds: ["a"],
      indexedFileIds: ["a"],
    }).state,
    "partial"
  );

  // Negative verification count -> partial.
  assert.equal(
    resolveReportCompletionState({
      diagnosticsReady: true,
      verificationItemCount: -24,
      renderedFileIds: ["a"],
      indexedFileIds: ["a"],
    }).state,
    "partial"
  );

  // Rendered file set does not match the indexed set (context-overflow reduced it mid-run) -> partial.
  const mismatch = resolveReportCompletionState({
    diagnosticsReady: true,
    verificationItemCount: 0,
    renderedFileIds: ["a", "b"],
    indexedFileIds: ["a", "b", "c"],
  });
  assert.equal(mismatch.state, "partial");
  assert.match(mismatch.reasons.join(" "), /file set used to render does not match/i);
});

run("presentation layer never surfaces a negative verification count (Fix 5)", () => {
  const cleaned = cleanUserFacingPresentationText("Open verification items: -24 remain before sign-off.");
  assert.doesNotMatch(cleaned, /-24/);
  assert.doesNotMatch(cleaned, /Open verification items\s*:\s*-/i);
  assert.match(cleaned, /Open verification items/i);
});

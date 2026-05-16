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

const { normalizeNarrativeProse } = require("./narrativeNormalization.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("normalizes compressed umpire reasoning while preserving technical meaning", () => {
  const compressed =
    "Appraisal Recommendation: Award reconciled supported amount; carrier omits post-repair scan calibration alignment structural verification; shop supports OEM repair path but final invoice is not isolated; this is not a lowest-cost decision; this is not automatic shop preference Rationale: reviewed evidence supports safe complete OEM-consistent repair and amount-of-loss accuracy Vulnerabilities: carrier reduces ADAS calibration and alignment; shop must still prove blend labor and final invoice Unresolved Evidence: final invoice not yet located in reviewed files Final Posture: reconciled supported amount remains the posture.";

  const normalized = normalizeNarrativeProse(compressed, "UMPIRING");

  assert.match(normalized, /Appraisal Recommendation:\nAward reconciled supported amount/i);
  assert.match(normalized, /Rationale:\nreviewed evidence supports safe complete OEM-consistent repair/i);
  assert.match(normalized, /Vulnerabilities:\ncarrier reduces ADAS calibration and alignment/i);
  assert.match(normalized, /Unresolved Evidence:\nfinal invoice not yet located in reviewed files/i);
  assert.match(normalized, /Final Posture:\nreconciled supported amount remains the posture\./i);
  assert.match(normalized, /not a lowest-cost decision/i);
  assert.match(normalized, /not automatic shop preference/i);

  for (const sentence of normalized.split(/(?<=[.!?])\s+/)) {
    const semicolonCount = (sentence.match(/;/g) ?? []).length;
    assert.ok(semicolonCount <= 2, `too many semicolons in sentence: ${sentence}`);
  }
});

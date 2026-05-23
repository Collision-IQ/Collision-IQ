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
const { sanitizeUserFacingEvidenceText } = require("../ui/presentationText.ts");

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

run("normalizes stacked repair operation chains while preserving posture and amount", () => {
  const compressed =
    "Appraisal Recommendation: Award reconciled supported amount $18,425.36 Rationale: The file supports the quarter replacement path rear bumper replacement/overhaul tail lamp pocket/fuel pocket blind spot radar replacement related calibration activity because the reviewed evidence supports OE/safety repair scope Vulnerabilities: carrier omits calibration and structural verification; shop still must prove final invoice Final Posture: award reconciled supported amount $18,425.36.";

  const normalized = normalizeNarrativeProse(compressed, "UMPIRING");

  assert.match(normalized, /Award reconciled supported amount \$18,425\.36/i);
  assert.match(normalized, /Final Posture:\naward reconciled supported amount \$18,425\.36\./i);
  assert.match(
    normalized,
    /The file supports:\n- quarter replacement path\n- rear bumper replacement or overhaul\n- tail lamp pocket work\n- fuel pocket work\n- blind spot radar replacement\n- scan, calibration, and alignment activity/i
  );
  assert.match(normalized, /Because the reviewed evidence supports OE\/safety repair scope/i);
  assert.match(normalized, /carrier omits calibration and structural verification/i);
  assert.match(normalized, /shop still must prove final invoice/i);
});

run("separates numbered umpire sections and preserves sanitized decision output", () => {
  const internalIdPrefix = "cm" + "p";
  const compressed =
    `1. Appraisal Recommendation Award reconciled supported amount $18,425.36 2. Award Posture RECONCILED_SUPPORTED Evidence references: ${internalIdPrefix}8abc1234, ${internalIdPrefix}9def5678 3. Why the selected posture is better supported The carrier omits calibration and structural verification.`;

  const normalized = normalizeNarrativeProse(
    sanitizeUserFacingEvidenceText(compressed),
    "UMPIRING"
  );

  assert.match(normalized, /1\. Appraisal Recommendation Award reconciled supported amount \$18,425\.36/i);
  assert.match(normalized, /\n\n2\. Award Posture RECONCILED_SUPPORTED/i);
  assert.match(normalized, /\n\n3\. Why the selected posture is better supported/i);
  assert.doesNotMatch(normalized, /cmp[a-z0-9]{8,}/i);
});

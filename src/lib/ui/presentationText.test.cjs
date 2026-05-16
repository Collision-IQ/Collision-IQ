/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

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
  cleanEstimateLineForCustomer,
  cleanEstimateLineForTechnicalExport,
  cleanOperationDisplayText,
  isMalformedEstimateLine,
  normalizeEstimateOperationLabel,
  sanitizeUserFacingEvidenceText,
  sanitizeEstimateLine,
} = require("./presentationText.ts");
const {
  buildIndexedExclusionAuditNote,
  buildReviewCompletenessMessage,
  getReviewCompletenessState,
  normalizeReviewProgressCounts,
} = require("../reviewCompleteness.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const cases = [
  ["fuel71218877627121.940.2", "Fuel"],
  ["rear bumper refinish 123123123", "Rear Bumper Refinish"],
  ["door_replace.9999.888", "Door Replace"],
  ["   frame   repair   ", "Frame Repair"],
  ["123456789", "Repair Operation"],
  ["", "Repair Operation"],
];

run("cleanOperationDisplayText normalizes noisy operation labels", () => {
  for (const [input, expected] of cases) {
    assert.equal(cleanOperationDisplayText(input), expected);
  }
});

run("normalizeEstimateOperationLabel keeps meaningful estimator-grade labels and drops generic-only rows", () => {
  assert.equal(
    normalizeEstimateOperationLabel("Repl Impact bar 68293716AC 1 449.00 Incl."),
    "Repl Impact bar"
  );
  assert.equal(normalizeEstimateOperationLabel("Repl"), "");
  assert.equal(normalizeEstimateOperationLabel("R&I"), "");
  assert.equal(
    normalizeEstimateOperationLabel("Subl Pre-repair scan +34% 1 201.00 T m"),
    "Subl Pre-repair scan"
  );
  assert.equal(normalizeEstimateOperationLabel("Repair Operation"), "");
});

run("estimate-line sanitizer hides known parser junk for customer output", () => {
  for (const input of ["Proc 2 #** Procedure research &", "wheelm0.1", "battery primarym0.3"]) {
    const result = sanitizeEstimateLine(input);
    assert.equal(result.malformed, true);
    assert.equal(result.hideFromCustomer, true);
    assert.equal(cleanEstimateLineForCustomer(input), "");
    assert.equal(cleanEstimateLineForTechnicalExport(input), "Parser review needed");
  }
});

run("estimate-line sanitizer cleans fused part-number descriptions for technical output", () => {
  assert.equal(isMalformedEstimateLine("rear bumper68184713AB"), true);
  assert.equal(cleanEstimateLineForTechnicalExport("rear bumper68184713AB"), "Rear Bumper");
  assert.equal(cleanEstimateLineForCustomer("rear bumper68184713AB"), "Rear Bumper");
});

run("user-facing evidence sanitizer removes cmp evidence ids and dangling lead-ins", () => {
  const cmp = "cmp";
  const cleaned = sanitizeUserFacingEvidenceText(
    `Support basis: Evidence references: ${cmp}7qdm12345678, ${cmp}abcdefghi90; ${cmp}0123456789. Blend operation remains under-supported.`
  );

  assert.equal(/\bcmp[a-z0-9]{8,}\b/i.test(cleaned), false);
  assert.equal(/Evidence references?/i.test(cleaned), false);
  assert.equal(/Support basis:\s*Evidence references?/i.test(cleaned), false);
  assert.equal(cleaned, "Blend operation remains under-supported.");
});

run("user-facing evidence sanitizer replaces internal-only cmp ids with plain support text", () => {
  const cmp = "cm" + "p";
  const cleaned = sanitizeUserFacingEvidenceText(`${cmp}7qdm12345678`);

  assert.equal(cleaned, "Evidence supported.");
});

run("user-facing evidence sanitizer removes repeated cmp chains and cleans punctuation", () => {
  const cmp = "cm" + "p";
  const cleaned = sanitizeUserFacingEvidenceText(
    `Evidence references: ${cmp}7qdm12345678, ${cmp}abcdefghi90, ${cmp}0123456789. ; Support verified.`
  );

  assert.equal(/\bcmp[a-z0-9]{8,}\b/i.test(cleaned), false);
  assert.equal(/Evidence references?/i.test(cleaned), false);
  assert.equal(cleaned, "Support verified.");
});

run("user-facing evidence sanitizer removes evidence-reference lead-in without dangling punctuation", () => {
  const cmp = "cm" + "p";
  const cleaned = sanitizeUserFacingEvidenceText(
    `Evidence references: ${cmp}aaaaaaaa, ${cmp}bbbbbbbb. Repair path support is documented.`
  );

  assert.equal(cleaned, "Repair path support is documented.");
});

run("review completeness uses near-complete language for 185 of 186 reviewable files", () => {
  assert.equal(getReviewCompletenessState({ reviewed: 185, total: 186 }), "NEAR_COMPLETE_REVIEW");
  const message = buildReviewCompletenessMessage({ reviewed: 185, total: 186 });

  assert.match(message, /^Near-complete review: 185 of 186 reviewable files reviewed\./);
  assert.equal(/Do not rely on this as a final umpire determination/i.test(message), false);
});

run("review completeness treats indexed non-reviewable item as excluded, not skipped", () => {
  const counts = normalizeReviewProgressCounts({
    indexedCount: 186,
    visionProcessedCount: 185,
    reviewedFileCount: 185,
    reviewableFileCount: 185,
  });
  const message = buildReviewCompletenessMessage({
    reviewed: counts.reviewedFileCount,
    total: counts.reviewableFileCount,
  });
  const note = buildIndexedExclusionAuditNote(counts);

  assert.equal(counts.excludedFromReviewCount, 1);
  assert.match(message, /^Reviewed 185 of 185 reviewable files\. Full reviewable-file review complete\.$/);
  assert.equal(/Only 185 of 186 files reviewed/i.test(message), false);
  assert.equal(
    note,
    "1 indexed item was excluded from determination review because it was non-reviewable, duplicate, unsupported, or metadata-only."
  );
  assert.equal(/\bcmp[a-z0-9]{8,}\b/i.test(note), false);
});

run("review completeness still warns when a true reviewable file is skipped", () => {
  const counts = normalizeReviewProgressCounts({
    indexedCount: 186,
    reviewableFileCount: 186,
    reviewedFileCount: 185,
  });
  const message = buildReviewCompletenessMessage({
    reviewed: counts.reviewedFileCount,
    total: counts.reviewableFileCount,
  });

  assert.equal(counts.excludedFromReviewCount, 0);
  assert.match(message, /^Near-complete review: 185 of 186 reviewable files reviewed\./);
});

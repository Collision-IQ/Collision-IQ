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
  cleanEstimateLineForCustomer,
  cleanEstimateLineForTechnicalExport,
  cleanOperationDisplayText,
  cleanUserFacingPresentationText,
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
const {
  buildFileReviewLedger,
  resolveEvidenceCompletenessFromLedger,
} = require("../fileReviewLedger.ts");

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

run("presentation cleanup preserves markdown while adding readable status and section breaks", () => {
  const cleaned = cleanUserFacingPresentationText(
    "## Findings DOCUMENTED: bumper support is shown. 1. Appraisal Recommendation This supportable. claim-[REDACTED_CLAIM] should be clearly to address. Not clearly Not clearly Not clearly shown.",
    { preserveMarkdown: true }
  );

  assert.match(cleaned, /^## Findings\n\nDOCUMENTED:/);
  assert.match(cleaned, /\n\n1\. Appraisal Recommendation/);
  assert.match(cleaned, /This appears supportable/);
  assert.match(cleaned, /claim \[REDACTED_CLAIM\]/);
  assert.match(cleaned, /should be clearly documented to address/);
  assert.match(cleaned, /Not clearly shown\.$/);
});

run("presentation cleanup normalizes export grammar, timestamps, numbers, URLs, and parser artifacts", () => {
  const cleaned = cleanUserFacingPresentationText(
    [
      "Source: https://example.test/source.pdf Retrieved: : 50: 37.877Z.",
      "$16, 886.67 and 17, 563 at 13: 50: 43.",
      "The calibration-related procedures. The record includes not yet clearly with printouts.",
      "Please continue documentation added findings including a, pre-repair scan.",
      "Structural cues Structural frame-related operations battery primarym0.3 four-w repai Not clearly Not clearly shown.",
      "Carrier vulnerabilities: A. Shop vulnerabilities: B. Not final-award confidence: C.",
    ].join(" "),
    { preserveMarkdown: true }
  );

  assert.doesNotMatch(cleaned, /https?:\/\//);
  assert.match(cleaned, /source link/);
  assert.doesNotMatch(cleaned, /Retrieved:\s*(?::|\d{1,2}:\d{2})/);
  assert.match(cleaned, /\$16,886\.67/);
  assert.match(cleaned, /17,563/);
  assert.match(cleaned, /13:50:43/);
  assert.match(cleaned, /The file supports calibration-related procedures\. The record includes not yet clearly documented with printouts\./);
  assert.match(cleaned, /continue documenting added findings including a pre-repair scan/);
  assert.match(cleaned, /Structural frame-related operations/);
  assert.doesNotMatch(cleaned, /primarym|four-w|\brepai\b/);
  assert.match(cleaned, /Not clearly shown/);
  assert.match(cleaned, /\n\nCarrier vulnerabilities:/);
  assert.match(cleaned, /\n\nShop vulnerabilities:/);
  assert.match(cleaned, /\n\nNot final-award confidence:/);
});

run("presentation cleanup removes release-blocker export artifacts", () => {
  const cleaned = cleanUserFacingPresentationText(
    [
      "Generated May 18,2026.",
      "Safetydocumentation support in the mountingdocumentation area.",
      "Retrieved: 40:13.304Z.",
      "still needs to be clearly to avoid confusion.",
      "policy packet with Georgia (GA) policy indicators. Jurisdiction: Georgia (GA).",
      "The side sensor0. 5 remains referenced.",
      "some of the repair steps are still only partly.",
      "if calibration, alignment, or hidden mounting issues were not fully.",
      "added findings can be and sent in as a supplement",
      "make sure the claim handling stays.",
      "finish documentation the repair path",
      "finish documentation the structural checks",
      "finish documentation the structural measurements",
      "In Pennsylvania, the file supports asking for written communication when the repair position or delay needs to be explained.",
      "In Pennsylvania, the file also supports asking for written status updates when the claim is delayed.",
      "Pennsylvania-specific options should not return.",
      "If state-specific claim [REDACTED_CLAIM], you may also be able to request a written explanation.",
      "Reference: source link.",
      "continue at source link.",
      "four-whe post-pull c alignmen confi Not clearly Not clearly shown.",
      "Carrier estimate.: Not clearly Not clearly shown. Shop estimate.: not clearly not clearly shown.",
      "battery.3 e battery.3e rt/rear r&i wheel.2 m lt/rear r&i wheel.2 m wheel.2 m wheel.2m.",
      "windshield tesla 0. 5 windshield tesla0. 5 tesla0. 5 tesla 0. 5.",
      "Repl Tire info label Repl Tire info label vs not shown Present only in shop estimate).",
    ].join(" "),
    { preserveMarkdown: true }
  );

  assert.match(cleaned, /Generated May 18, 2026/);
  assert.match(cleaned, /Safety documentation support/);
  assert.match(cleaned, /mounting documentation area/);
  assert.doesNotMatch(cleaned, /Retrieved: 40:13\.304Z/);
  assert.match(cleaned, /still needs to be clearly documented to avoid/);
  assert.match(cleaned, /uploaded policy packet \/ appraisal-language support; jurisdiction metadata redacted or ambiguous/);
  assert.match(cleaned, /Jurisdiction metadata: redacted or ambiguous/);
  assert.match(cleaned, /side sensor remains referenced/i);
  assert.match(cleaned, /some of the repair steps are still only partly verified\./);
  assert.match(cleaned, /if calibration, alignment, or hidden mounting issues were not fully verified\./);
  assert.match(cleaned, /added findings can be documented and sent in as a supplement\./);
  assert.match(cleaned, /make sure the claim handling stays clear and documented\./);
  assert.match(cleaned, /finish documenting the repair path\./);
  assert.match(cleaned, /finish documenting the structural checks\./);
  assert.match(cleaned, /finish documenting the structural measurements\./);
  assert.match(cleaned, /If state-specific claim-handling rules apply, you may also be able to request written communication when the repair position or delay needs to be explained\./);
  assert.match(cleaned, /If state-specific claim-handling rules apply, you may also be able to request written status updates when the claim is delayed or when the repair position is not being explained clearly\./);
  assert.match(cleaned, /state-specific options should not return/i);
  assert.match(cleaned, /If state-specific claim-handling rules apply, you may also be able to request/);
  assert.match(cleaned, /Carrier estimate: Not clearly shown\./);
  assert.match(cleaned, /Shop estimate: Not clearly shown\./);
  assert.match(cleaned, /rt\/rear r&i wheel/i);
  assert.match(cleaned, /lt\/rear r&i wheel/i);
  assert.match(cleaned, /windshield Tesla/);
  assert.match(cleaned, /Repl Tire info label: present only in shop estimate\./);
  assert.doesNotMatch(cleaned, /Reference: source link|continue at source link|sensor0|\bfour-whe\b|post-pull c|\balignmen\b|\bconfi\b|Not clearly Not clearly|not clearly not clearly|battery\.3\s?e|wheel\.2\s?m|tesla0|tesla 0\. 5|vs not shown Present only|In Pennsylvania|Pennsylvania-specific|If state-specific claim \[REDACTED_CLAIM\]|finish documentation the structural/);
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
  assert.equal(
    message,
    "All uploaded reviewable files were reviewed. Repair-package completeness depends on the specific proof categories, not the upload count alone."
  );
  assert.match(message, /uploaded reviewable files were reviewed/i);
  assert.match(message, /Repair-package completeness depends/i);
  assert.doesNotMatch(message, /Full reviewable-file review complete|final file-complete conclusion/i);
  assert.equal(/Only 185 of 186 files reviewed/i.test(message), false);
  assert.equal(
    note,
    "1 indexed item was excluded from determination review. File-level diagnostics with filenames and reasons are required before treating exclusions as reviewed."
  );
  assert.equal(/\bcmp[a-z0-9]{8,}\b/i.test(note), false);
});

run("indexed exclusion note lists filenames, reasons, stages, parsing, support-only, and duplicate status", () => {
  const note = buildIndexedExclusionAuditNote({
    indexedCount: 3,
    reviewableFileCount: 1,
    excludedFromReviewCount: 2,
    excludedFromReviewFiles: [
      {
        filename: "Work Auth.pdf",
        detectedType: "work_authorization",
        reason: "NON_REVIEWABLE",
        indexed: true,
        stage: "source_selection",
        parsed: true,
        supportOnly: true,
        duplicate: false,
        reviewabilityHint: "Reviewable as support context only; not a primary estimate source.",
      },
      {
        filename: "duplicate scan.pdf",
        detectedType: "scan_report",
        reason: "DUPLICATE",
        indexed: true,
        stage: "reviewability",
        parsed: true,
        supportOnly: false,
        duplicate: true,
        duplicateOf: "scan-original",
      },
    ],
  });

  assert.match(note, /Work Auth\.pdf/);
  assert.match(note, /reason=NON_REVIEWABLE/);
  assert.match(note, /stage=source_selection/);
  assert.match(note, /parsed=yes/);
  assert.match(note, /support-only=yes/);
  assert.match(note, /duplicate=scan-original/);
  assert.doesNotMatch(note, /^2 indexed items were excluded from determination review because they were/i);
});

run("file ledger records every upload and evidence reconciliation does not mark present proof as missing", () => {
  const attachments = [
    {
      id: "shop",
      filename: "Shop Estimate.pdf",
      type: "application/pdf",
      text: "Preliminary Estimate Line 1 Replace bumper",
      imageDataUrl: "data:application/pdf;base64,AAA=",
      sizeBytes: 100,
    },
    {
      id: "cal",
      filename: "Calibration Record.pdf",
      type: "application/pdf",
      text: "ADAS calibration radar camera aiming completed",
      imageDataUrl: "data:application/pdf;base64,AAA=",
      sizeBytes: 100,
    },
    {
      id: "align",
      filename: "Alignment Printout.pdf",
      type: "application/pdf",
      text: "Hunter alignment before after toe camber caster",
      imageDataUrl: "data:application/pdf;base64,AAA=",
      sizeBytes: 100,
    },
    {
      id: "work-auth",
      filename: "Work Auth Contract.pdf",
      type: "application/pdf",
      text: "Work Authorization Contract of Repair customer acknowledges Repairer has posted labor rates",
      imageDataUrl: "data:application/pdf;base64,AAA=",
      sizeBytes: 100,
    },
  ];
  const ledger = buildFileReviewLedger(attachments);
  const categories = resolveEvidenceCompletenessFromLedger({
    ledger,
    corpus: "The case needs calibration records, alignment printout, and a work authorization.",
  });
  const calibration = categories.find((item) => item.category === "calibration_record");
  const alignment = categories.find((item) => item.category === "alignment_printout");
  const workAuth = ledger.find((item) => item.fileId === "work-auth");

  assert.equal(ledger.length, attachments.length);
  assert.equal(calibration.status, "present_but_not_line_tied");
  assert.equal(alignment.status, "present_but_not_line_tied");
  assert.notEqual(calibration.status, "not_found");
  assert.equal(workAuth.usedAsSupportOnly, true);
  assert.equal(workAuth.usedInDetermination, false);
  assert.match(workAuth.reviewabilityHint, /support context only/i);
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

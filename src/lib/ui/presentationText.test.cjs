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
  buildFileReviewDiagnosticRows,
  buildIndexedExclusionAuditNote,
  buildReviewCompletenessMessage,
  getReviewCompletenessState,
  normalizeReviewProgressCounts,
} = require("../reviewCompleteness.ts");
const {
  buildFileReviewDiagnosticsSummary,
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
      "Repair Intelligence references bumper cover1.8 and scan +34%1201.00t m.",
      "Post scan +34%1167.50t failure. Procedure cost open to invoice.",
      "Carrier vulnerabilities: A. Shop vulnerabilities: B. MISSING_CRITICAL_EVIDENCE: -8. Not final-award confidence: C.",
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
  assert.match(cleaned, /Repair Intelligence references bumper cover and scan\./);
  assert.match(cleaned, /Post scan repair support remains open pending invoice documentation\./);
  assert.doesNotMatch(cleaned, /primarym|four-w|\brepai\b|bumper cover1\.8|scan \+34%|Procedure cost open/);
  assert.match(cleaned, /Not clearly shown/);
  assert.match(cleaned, /\n\nCarrier estimate pressure points:/);
  assert.match(cleaned, /\n\nShop estimate verification risks:/);
  assert.doesNotMatch(cleaned, /MISSING_CRITICAL_EVIDENCE|Carrier\. vulnerabilities|Shop\. vulnerabilities/);
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
  assert.equal(note, "File review diagnostics are still being prepared.");
  assert.doesNotMatch(note, /\d+ indexed items? (?:was|were) excluded/);
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
  assert.match(note, /Some files were used as supporting context instead of direct estimate-determination evidence/);
  assert.match(note, /File Review Diagnostics/);
  assert.match(note, /reason=NON_REVIEWABLE/);
  assert.match(note, /stage=source_selection/);
  assert.match(note, /parsed=yes/);
  assert.match(note, /support-only=yes/);
  assert.match(note, /duplicate=scan-original/);
  assert.doesNotMatch(note, /^2 indexed items were excluded from determination review because they were/i);
});

run("file review diagnostic rows expose file-level status and flags", () => {
  const rows = buildFileReviewDiagnosticRows({
    fileReviewLedger: [
      {
        filename: "Work Auth.pdf",
        mimeType: "application/pdf",
        documentType: "work_authorization",
        indexedStatus: "indexed",
        isReviewable: true,
        reviewedForDetermination: true,
        usedAsSupportOnly: true,
        usedInDetermination: false,
        isDuplicate: false,
        exclusionReason: null,
        reviewabilityHint: "Reviewable as support context only; not a primary estimate source.",
        textExtractionStatus: "extracted",
        visionExtractionStatus: "not_applicable",
      },
      {
        filename: "duplicate.pdf",
        mimeType: "application/pdf",
        documentType: "other_supporting_document",
        indexedStatus: "indexed",
        isReviewable: false,
        reviewedForDetermination: false,
        usedAsSupportOnly: false,
        usedInDetermination: false,
        isDuplicate: true,
        exclusionReason: "DUPLICATE",
        reviewabilityHint: "Use the retained duplicate listed in duplicateOf.",
        textExtractionStatus: "extracted",
        visionExtractionStatus: "not_applicable",
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].filename, "Work Auth.pdf");
  assert.equal(rows[0].indexedStatus, "indexed");
  assert.equal(rows[0].reviewableStatus, "reviewable");
  assert.equal(rows[0].reviewedStatus, "reviewed");
  assert.equal(rows[0].supportOnly, true);
  assert.equal(rows[0].outsideDeterminationScope, true);
  assert.equal(rows[1].duplicate, true);
  assert.equal(rows[1].exclusionReason, "DUPLICATE");
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
    {
      id: "video",
      filename: "Walkaround video.mov",
      type: "video/quicktime",
      text: "",
      sizeBytes: 1000,
      classification: "video",
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
  const unsupported = ledger.find((item) => item.fileId === "video");

  assert.equal(ledger.length, attachments.length);
  assert.equal(calibration.status, "present_but_not_line_tied");
  assert.equal(alignment.status, "present_but_not_line_tied");
  assert.notEqual(calibration.status, "not_found");
  assert.equal(workAuth.usedAsSupportOnly, true);
  assert.equal(workAuth.usedInDetermination, false);
  assert.match(workAuth.reviewabilityHint, /support context only/i);
  assert.equal(unsupported.isSupported, false);
  assert.equal(unsupported.exclusionReason, "UNSUPPORTED_TYPE");
  assert.equal(unsupported.indexedStatus, "indexed");
  assert.equal(unsupported.textExtractionStatus, "not_applicable");
  assert.equal(unsupported.reviewabilityHint, "Upload a PDF, supported image, or extracted text version.");
});

run("user-facing cleanup rewrites passive OEM procedure asks into retrieval posture", () => {
  const cleaned = sanitizeUserFacingEvidenceText(
    "Ask the shop to provide the GM procedure before I can reason further. The item is not proven."
  );

  assert.match(cleaned, /Collision IQ identified this as an OEM-procedure-dependent issue/i);
  assert.match(cleaned, /retrieve and apply the applicable authority/i);
  assert.match(cleaned, /not yet supported by a named authority or proof source/i);
  assert.doesNotMatch(cleaned, /Ask the shop to provide/i);
});

run("file review diagnostics account for 110 images and 18 PDFs without excluding parsed support PDFs", () => {
  const imageAttachments = Array.from({ length: 110 }, (_, index) => ({
    id: `photo-${index + 1}`,
    filename: `Repair progress ${String(index + 1).padStart(3, "0")}.jpg`,
    type: "image/jpeg",
    text: "",
    imageDataUrl: "data:image/jpeg;base64,AAA=",
    sizeBytes: 2048,
    sha256: `photo-hash-${index + 1}`,
  }));
  const pdfAttachments = Array.from({ length: 18 }, (_, index) => ({
    id: `pdf-${index + 1}`,
    filename: index === 0 ? "Work Auth Contract.pdf" : `Case document ${String(index + 1).padStart(2, "0")}.pdf`,
    type: "application/pdf",
    text: index === 0
      ? "Work Authorization Contract of Repair customer acknowledges Repairer has posted labor rates"
      : "Estimate repair procedure invoice calibration support text",
    imageDataUrl: "data:application/pdf;base64,AAA=",
    sizeBytes: 4096,
    sha256: `pdf-hash-${index + 1}`,
  }));
  const attachments = [...imageAttachments, ...pdfAttachments];
  const ledger = buildFileReviewLedger(attachments);
  const diagnostics = buildFileReviewDiagnosticsSummary(attachments, ledger);
  const workAuth = ledger.find((entry) => entry.fileId === "pdf-1");

  assert.equal(ledger.length, 128);
  assert.equal(diagnostics.totalUploaded, 128);
  assert.equal(diagnostics.imageCount, 110);
  assert.equal(diagnostics.pdfCount, 18);
  assert.equal(diagnostics.imageVisionCount, 110);
  assert.equal(diagnostics.parsedPdfCount, 18);
  assert.equal(diagnostics.pdfBytesAvailableCount, 18);
  assert.equal(diagnostics.scannedPdfFallbackCount, 0);
  assert.equal(diagnostics.reviewableCount, 128);
  assert.equal(diagnostics.reviewedCount, 128);
  assert.equal(diagnostics.excludedCount, 0);
  assert.equal(diagnostics.supportOnlyCount, 1);
  assert.equal(diagnostics.determinationEligibleCount, 127);
  assert.equal(diagnostics.determinationUsedCount, 127);
  assert.equal(workAuth.isReviewable, true);
  assert.equal(workAuth.reviewedForDetermination, true);
  assert.equal(workAuth.usedAsSupportOnly, true);
  assert.equal(workAuth.usedInDetermination, false);
  assert.equal(workAuth.visionExtractionStatus, "not_applicable");
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

run("Collision IQ footer uses Shop Hub link and removes Collision Hub label", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/ChatbotPage.tsx"), "utf8");

  assert.match(source, /label:\s*"Shop Hub"/);
  assert.match(source, /href:\s*"\/technical-systems\/shop-hub"/);
  assert.doesNotMatch(source, /label:\s*"Collision Hub"/);
});

run("header auth has visible Sign in fallback for stalled or missing Clerk state", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/ChatShell.tsx"), "utf8");

  assert.match(source, /authFallbackReady/);
  assert.match(source, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  assert.match(source, /window\.setTimeout\([\s\S]*1400/);
  assert.match(source, /href="\/sign-in"[\s\S]*Sign in/);
  assert.match(source, /SIGN_IN_BUTTON_CLASS/);
  assert.doesNotMatch(source, /<div className="h-8 w-\[62px\] shrink-0" aria-hidden \/>\s*\}\s*<\/div>\s*\);/);
});

run("right rail layout is bounded to chat row with internal scroll", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/ChatShell.tsx"), "utf8");

  assert.match(source, /ci-workstation flex-1 min-h-0 flex flex-col/);
  assert.match(source, /grid flex-1 min-h-0[\s\S]{0,120}overflow-hidden/);
  assert.match(source, /hidden h-full min-h-0 w-full flex-col overflow-hidden/);
  assert.match(source, /flex-1 min-h-0 overflow-y-auto p-3/);
  assert.match(source, /\{bottom \? <div className="mt-2 shrink-0 sm:mt-3">\{bottom\}<\/div> : null\}/);
  assert.doesNotMatch(source, /sticky top-3 hidden min-h-0 w-full flex-col/);
});

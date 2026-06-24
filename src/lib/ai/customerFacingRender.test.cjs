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

const { buildCustomerReportPdf } = require("./builders/customerReportPdfBuilder.ts");
const {
  buildCollisionSnapshotPdfFromSnapshot,
  sanitizeSnapshotForFinalRender,
} = require("./builders/collisionSnapshotPdfBuilder.ts");
const { renderCustomerReportHtml } = require("./renderCustomerReportHtml.ts");
const { toCustomerFacingText } = require("./customerFacingText.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function flattenDocument(document) {
  return [
    document.header?.title,
    document.header?.subtitle,
    ...(document.summary ?? []).flatMap((item) => [item.label, item.value]),
    ...(document.sections ?? []).flatMap((section) => [
      section.title,
      section.body,
      ...(section.bullets ?? []),
    ]),
    ...(document.footer ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function assertNoForbiddenCustomerText(text) {
  const forbidden = [
    /evidence\s+references?/i,
    /\bcmp[a-z0-9]{8,}\b/i,
    /cmox/i,
    /support\s+basis/i,
    /risk\s*if\s*omitted/i,
    /support\s*:\s*verified/i,
    /documented\s+evidence\s+at\s+\d+%\s+confidence/i,
    /\b\d{1,3}%\s+confidence\b/i,
    /\bruntime\b/i,
    /\bimmutable\b/i,
    /inferred\s+support/i,
    /verified\s+support/i,
    /\bProc\s*\d+\s*#?\s*\*+/i,
    /\bwheelm\d+(?:\.\d+)?\b/i,
    /\bbattery\s+primarym\d+(?:\.\d+)?\b/i,
    /\bparser\b/i,
  ];

  for (const pattern of forbidden) {
    assert.equal(pattern.test(text), false, `forbidden customer text leaked: ${pattern}`);
  }
}

const cmp = "cmp";

const dirtyReport = {
  title: "Customer Report",
  openingSummary:
    `Evidence references ${cmp}7qdm12345678, ${cmp}abcdefghi90 cmox-abc Support: Verified. Hidden Mounting Geometry Teardown Growth documented evidence at 86% confidence.`,
  whichRepairPlanLooksStronger:
    "Risk if omitted: Proc 2 #** Procedure research & wheelm0.1 battery primarym0.3",
  safetyFirst: "ADAS Calibration Procedure Support. Support basis runtime immutable.",
  whatStillNeedsProof: [
    `Side Structure Aperture Door-Shell Fit Verification support basis Evidence references: ${cmp}0123456789 cmox-22`,
    "Proc 2 #** Procedure research &",
    "battery primarym0.3",
  ],
  yourOptions: [
    "Request the missing supporting documentation or a written estimate explanation",
    "Inferred support should not show.",
  ],
  bottomLine: "Fit And Finish Validation. verified support labels should not appear.",
};

run("customer report PDF final render strips forbidden debug and parser text", () => {
  const document = buildCustomerReportPdf({
    report: dirtyReport,
    vehicle: "2024 Jeep Gladiator Sport 4WD",
    vin: null,
    insurer: null,
    mileage: "17,563",
    estimateTotal: "$16,200",
    findingReasoning: [
      {
        issue: `Hidden Mounting Geometry Teardown Growth ${cmp}7qdm12345678 cmox-123`,
        what_proves_it: "Proc 2 #** Procedure research &",
        why_it_matters: "Support basis and documented evidence at 86% confidence.",
        next_action: "Risk if omitted: battery primarym0.3",
        evidenceLevel: "supported",
        supportConfidenceIndicator: "high",
        claimSpecificity: "high",
        confidence: 0.86,
        leverageScore: 90,
      },
    ],
  });

  const text = flattenDocument(document);
  assert.equal(text.includes("Hidden mounting or structural damage is not verified from the reviewed file"), true);
  assert.equal(text.includes("Scan and calibration documentation is not verified from the reviewed file"), true);
  assertNoForbiddenCustomerText(text);
});

run("customer report HTML final render strips forbidden debug and parser text", () => {
  const html = renderCustomerReportHtml({
    report: dirtyReport,
    vehicle: "2024 Jeep Gladiator Sport 4WD",
    generatedAt: "May 8, 2026",
  });

  assert.equal(html.includes("Fit and finish proof is not produced in the reviewed file"), true);
  assertNoForbiddenCustomerText(html);
});

run("snapshot modal/PDF final render strips forbidden debug and parser text", () => {
  const dirtySnapshot = {
    title: "Collision Snapshot",
    vehicleLabel: "2024 Jeep Gladiator Sport 4WD",
    damageSummary: ["Proc 2 #** Procedure research &", "battery primarym0.3", "Front bumper impact noted."],
    repairPlanVerdict: {
      moreCompletePlan: "SHOP",
      carrierPlanStatus: "PARTIAL",
      reason: "Support: Verified. Documented evidence at 86% confidence.",
    },
    estimateComparison: {
      available: true,
      shopEstimateTotal: "$20,000",
      carrierEstimateTotal: "$16,000",
      difference: "$4,000",
      keyDeltas: ["wheelm0.1", "Body labor appears different."],
    },
    topDisputeItems: [
      {
        issue: `Hidden Mounting Geometry Teardown Growth evidence references ${cmp}7qdm12345678 cmox-9`,
        whyItMatters: "Support basis runtime immutable.",
        evidenceState: "Documented evidence at 86% confidence.",
        nextAction: "Risk if omitted: Proc 2 #** Procedure research &",
        pressureMode: "educational",
      },
    ],
    pressureMode: "educational",
    pressureModeRationale: "verified support labels",
    evidenceCompleteness: {
      adjustedConfidence: "High",
      completenessStatus: "PARTIAL",
      uploadedFileCount: 2,
      uploadLimitReached: false,
      userIndicatedMoreFiles: false,
      missingCriticalEvidence: ["battery primarym0.3", "Support basis cmox"],
      userFacingDisclosure: "Runtime immutable parser fragments hidden.",
    },
    nextActions: ["Ask about wheelm0.1", "Request the missing supporting documentation or a written estimate explanation"],
    verdictLine: "inferred support",
    valuationSnapshot: {
      available: false,
      disclosure: "Market preview unavailable because live comparable search did not complete.",
    },
    disclosure: "Snapshot disclosure with cmox evidence references.",
    redactionNotice: "Sensitive details removed for sharing.",
  };

  const cleanSnapshot = sanitizeSnapshotForFinalRender(dirtySnapshot);
  const modalText = JSON.stringify(cleanSnapshot);
  const pdfText = flattenDocument(buildCollisionSnapshotPdfFromSnapshot(dirtySnapshot));

  assert.equal(modalText.includes("Hidden mounting or structural damage is not verified from the reviewed file"), true);
  assert.equal(modalText.includes("The current file appears to support this item."), true);
  assertNoForbiddenCustomerText(modalText);
  assertNoForbiddenCustomerText(pdfText);
});

run("customer-facing text removes spaced parser fragments", () => {
  assert.equal(toCustomerFacingText("Proc 2 #** Procedure research & wheelm0.1 battery primarym0.3"), "");
});

run("customer-facing text replaces malformed redaction sentence with complete scan proof language", () => {
  const cleaned = toCustomerFacingText(
    "It [REDACTED_INSURER], but scan and calibration proof remains unclear. Keep the repair file organized."
  );

  assert.match(cleaned, /Scan and calibration support still needs stronger file proof/i);
  assert.doesNotMatch(cleaned, /It \[REDACTED_INSURER\], but/i);
});

run("customer-facing text repairs redaction and rendering grammar defects", () => {
  const cleaned = toCustomerFacingText(
    [
      "The [REDACTED_INSURER], but proof remains unclear remains unclear.",
      "Ask for for the missing support with with the shop.",
      "This [REDACTED_CLAIM], but documentation remains unclear.",
      "Send it from [REDACTED_INSURER] [REDACTED_CLAIM].",
      "The estimate [REDACTED_INSURER] repair areas total $20,290. 23 vs $12,046. 49.",
      "Use line-by-documentation to explain it.",
    ].join(" ")
  );

  assert.match(cleaned, /insurer's position still needs stronger file proof/i);
  assert.match(cleaned, /ask for the missing support with the shop/i);
  assert.match(cleaned, /This item still needs stronger file proof/i);
  assert.match(cleaned, /\$20,290\.23/);
  assert.match(cleaned, /\$12,046\.49/);
  assert.match(cleaned, /estimate repair areas/);
  assert.match(cleaned, /line-by-line documentation/);
  assert.doesNotMatch(cleaned, /\[REDACTED_[A-Z_]+\]|for for|with with|remains unclear remains unclear/i);
});

run("customer report PDF keeps source insurer and neutral estimate labels", () => {
  const document = buildCustomerReportPdf({
    report: {
      title: "Customer Report",
      openingSummary: "The source/lower estimate lists Insurance Company: USAA and the comparison/final estimate is higher.",
      whichRepairPlanLooksStronger: "The comparison/final estimate looks more complete than the source/lower estimate.",
      safetyFirst: "Diagnostics and calibration proof should be verified.",
      whatStillNeedsProof: ["Final invoice and scan proof."],
      yourOptions: ["Ask for the final estimate reconciliation."],
      bottomLine: "Use the source/lower and comparison/final estimates to explain the gap.",
    },
    vehicle: "2024 Jeep Grand Wagoneer",
    vin: null,
    insurer: "USAA",
    mileage: null,
    estimateTotal: "$11,892.26",
  });

  const text = flattenDocument(document);
  assert.equal(document.summary.find((item) => item.label === "Insurer")?.value, "USAA");
  assert.match(text, /source\/lower estimate/i);
  assert.match(text, /comparison\/final estimate/i);
  assert.doesNotMatch(text, /\[REDACTED_INSURER\]/);
});

run("customer-facing text completes export fragments and neutralizes unsupported Pennsylvania wording", () => {
  const cleaned = toCustomerFacingText(
    [
      "some of the repair steps are still only partly.",
      "if calibration, alignment, or hidden mounting issues were not fully.",
      "added findings can be and sent in as a supplement",
      "make sure the claim handling stays.",
      "finish documentation the repair path",
      "finish documentation the structural checks",
      "finish documentation the structural measurements",
      "In Pennsylvania, the file supports asking for written communication when the repair position or delay needs to be explained.",
      "In Pennsylvania, the file also supports asking for written status updates when the claim is delayed or when the repair position is not being explained clearly.",
      "Pennsylvania-specific options should not return.",
      "If state-specific claim [REDACTED_CLAIM], you may also be able to request a written explanation.",
      "If you are in Pennsylvania, ask for a written explanation.",
    ].join(" ")
  );
  const html = renderCustomerReportHtml({
    report: {
      ...dirtyReport,
      yourOptions: ["If you are in Pennsylvania, ask for a written explanation."],
    },
    vehicle: "2024 Jeep Gladiator Sport 4WD",
    generatedAt: "May 19, 2026",
  });

  assert.match(cleaned, /some of the repair steps are still only partly verified\./);
  assert.match(cleaned, /hidden mounting issues were not fully verified\./);
  assert.match(cleaned, /added findings can be documented and sent in as a supplement\./i);
  assert.match(cleaned, /claim handling stays clear and documented\./);
  assert.match(cleaned, /finish documenting the repair path\./);
  assert.match(cleaned, /finish documenting the structural checks\./);
  assert.match(cleaned, /finish documenting the structural measurements\./);
  assert.match(cleaned, /If state-specific claim-handling rules apply, you may also be able to request written communication when the repair position or delay needs to be explained/i);
  assert.match(cleaned, /If state-specific claim-handling rules apply, you may also be able to request written status updates/i);
  assert.match(cleaned, /state-specific options should not return/i);
  assert.match(cleaned, /If state-specific claim-handling rules apply, you may also be able to request/i);
  assert.match(cleaned, /If state-specific claim-handling rules apply/);
  assert.doesNotMatch(`${cleaned}\n${html}`, /If you are in Pennsylvania|In Pennsylvania|Pennsylvania-specific|state-specific claim \[REDACTED_CLAIM\]|finish documentation the structural/i);
});

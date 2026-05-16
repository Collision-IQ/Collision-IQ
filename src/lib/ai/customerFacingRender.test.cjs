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
  assert.equal(text.includes("Possible hidden mounting or structural damage may still need inspection after teardown"), true);
  assert.equal(text.includes("The vehicle may need scan and calibration work after repairs"), true);
  assertNoForbiddenCustomerText(text);
});

run("customer report HTML final render strips forbidden debug and parser text", () => {
  const html = renderCustomerReportHtml({
    report: dirtyReport,
    vehicle: "2024 Jeep Gladiator Sport 4WD",
    generatedAt: "May 8, 2026",
  });

  assert.equal(html.includes("The repaired panels, lights, bumper, and trim should be checked for proper fit before the job is finished"), true);
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

  assert.equal(modalText.includes("Possible hidden mounting or structural damage may still need inspection after teardown"), true);
  assert.equal(modalText.includes("The current file appears to support this item."), true);
  assertNoForbiddenCustomerText(modalText);
  assertNoForbiddenCustomerText(pdfText);
});

run("customer-facing text removes spaced parser fragments", () => {
  assert.equal(toCustomerFacingText("Proc 2 #** Procedure research & wheelm0.1 battery primarym0.3"), "");
});

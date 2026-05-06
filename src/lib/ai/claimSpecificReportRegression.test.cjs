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
  buildClaimFingerprint,
  buildEvidenceMap,
  shouldIncludeFinding,
} = require("./claimFingerprint.ts");
const { buildExportModel } = require("./builders/buildExportModel.ts");
const {
  buildCollisionSnapshot,
  buildSnapshotSafeReport,
  redactSensitiveData,
} = require("./builders/collisionSnapshot.ts");
const { buildCollisionSnapshotPdfFromSnapshot } = require("./builders/collisionSnapshotPdfBuilder.ts");
const { buildDisputeIntelligencePdf } = require("./builders/disputeIntelligencePdfBuilder.ts");
const { buildRebuttalEmailPdf } = require("./builders/rebuttalEmailPdfBuilder.ts");
const {
  buildSnapshotEmailBody,
  buildSnapshotPlainText,
  buildSnapshotSendSafeEvent,
} = require("./builders/snapshotShare.ts");
const {
  buildPlanRecommendationGuard,
  buildProductAccessGuard,
  canAccessFeature,
} = require("../featureAccess.ts");
const { sanitizeCrmPayload } = require("../crm/events.ts");
const {
  buildNextBatchPrompt,
  buildUploadBatchGuidance,
  NEXT_UPLOAD_PRIORITY,
} = require("../uploadBatching.ts");
const { TTS_STYLE_PROMPT, VOICE_PRESETS } = require("../voicePresets.ts");

console.info = () => {};

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function baseReport(overrides = {}) {
  return {
    summary: {
      riskScore: "moderate",
      confidence: "moderate",
      criticalIssues: 1,
      evidenceQuality: "moderate",
    },
    vehicle: {
      year: 2022,
      make: "Toyota",
      model: "Camry",
      trim: "SE",
      vin: "4T1G11AK0NU123456",
      confidence: 0.9,
      source: "attachment",
    },
    issues: [
      {
        id: "labor-gap",
        category: "documentation",
        title: "Body Labor Difference",
        finding: "Shop estimate shows body labor hours above the carrier estimate.",
        impact: "The line-item labor difference should be reconciled against the documented repair operations.",
        severity: "medium",
        evidenceIds: [],
      },
    ],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: ["Body labor reconciliation"],
    supplementOpportunities: ["Body Labor Difference"],
    evidence: [],
    recommendedActions: ["Request a line-by-line labor reconciliation."],
    ...overrides,
  };
}

function gateFinding(input, finding) {
  const fingerprint = buildClaimFingerprint(input);
  const evidenceMap = buildEvidenceMap(input);
  return shouldIncludeFinding(finding, fingerprint, evidenceMap);
}

run("rear bumper claim with no ADAS signals suppresses ADAS finding", () => {
  const input = {
    shopEstimateText: [
      "2021 Toyota Corolla LE",
      "Rear bumper cover remove and install",
      "Rear bumper cover refinish",
      "Rear impact repair",
    ].join("\n"),
    insurerEstimateText: "",
    retrievedDocuments: [],
  };

  const gated = gateFinding(input, {
    issue: "ADAS calibration triggered by rear bumper work",
    finding: "Bumper removal is present on the estimate.",
    evidenceLevel: "referenced",
    supportSources: ["upload"],
    risk: "medium",
    confidence: 0.82,
    secondLevelReasoning: "Generic bumper work alone does not prove ADAS involvement.",
    thirdLevelAction: "Do not request calibration unless sensor, scan, or vehicle-feature evidence appears.",
  });

  assert.equal(gated.include, false);
  assert.match(gated.reasonExcluded ?? "", /ADAS\/scan\/calibration evidence is not present/i);
});

run("clear labor/material mismatch includes estimate-specific finding", () => {
  const input = {
    shopEstimateText: [
      "2020 Honda Accord EX",
      "Body labor 12.0 hours",
      "Refinish materials $420.00",
      "Replace left quarter molding",
    ].join("\n"),
    insurerEstimateText: [
      "2020 Honda Accord EX",
      "Body labor 5.0 hours",
      "Refinish materials $120.00",
    ].join("\n"),
    retrievedDocuments: [],
  };

  const gated = gateFinding(input, {
    issue: "Body labor hours gap",
    finding: "Shop documents 12.0 body hours vs 5.0 carrier body hours.",
    evidenceLevel: "documented",
    supportSources: ["upload"],
    risk: "medium",
    confidence: 0.86,
    secondLevelReasoning: "The mismatch is tied to documented body labor and material lines.",
    thirdLevelAction: "Request a line-by-line labor and material reconciliation.",
  });

  assert.equal(gated.include, true);
  assert.match(gated.what_proves_it, /shop-only|carrier-only|labor/i);
  assert.equal(gated.evidenceLevel, "documented");
});

run("retrieved OEM source surfaces as OEM evidence in report output", () => {
  const report = baseReport({
    findingReasoning: [
      {
        id: "corrosion-1",
        issue: "Corrosion protection",
        why_it_matters: "Welded panel repairs need material restoration.",
        what_proves_it: "OEM corrosion protection procedure retrieved.",
        next_action: "Attach the OEM corrosion procedure to the supplement.",
        evidenceLevel: "referenced",
        confidence: 0.82,
        claimSpecificity: "high",
      },
    ],
    retrievalSummary: {
      driveDocsUsed: 1,
      webSourcesUsed: 0,
      serperStatus: "NOT_RUN",
      oemEvidenceFound: true,
      sourcesInfluencingFindings: [
        {
          title: "Toyota OEM Corrosion Protection Procedure",
          sourceType: "oem",
          relatedFindingIds: ["corrosion-1"],
        },
      ],
    },
  });

  const renderModel = buildExportModel({ report, analysis: null, panel: null, assistantAnalysis: "" });

  assert.equal(renderModel.retrievalSummary?.oemEvidenceFound, true);
  assert.equal(renderModel.retrievalSummary?.driveDocsUsed, 1);
  assert.equal(renderModel.retrievalSummary?.sourcesInfluencingFindings[0]?.sourceType, "oem");
});

run("OEM contradiction detection separates cited support from inferred conflicts", () => {
  const citedReport = baseReport({
    issues: [
      {
        id: "calibration-gap",
        category: "documentation",
        title: "ADAS calibration omitted by carrier",
        finding: "Carrier estimate does not include ADAS calibration after front sensor work.",
        impact: "Calibration documentation is needed to reconcile the repair path.",
        missingOperation: "ADAS calibration",
        severity: "high",
        evidenceIds: [],
      },
    ],
    requiredProcedures: [
      {
        procedure: "ADAS calibration",
        reason: "OEM procedure support requires calibration after front radar removal.",
        source: "oem_doc",
        severity: "high",
      },
    ],
    supplementOpportunities: ["ADAS calibration omitted by carrier"],
  });
  const citedModel = buildExportModel({ report: citedReport, analysis: null, panel: null, assistantAnalysis: "" });
  const cited = citedModel.oemContradictions[0];

  assert.equal(cited.supportStatus, "verified");
  assert.match(cited.oemSupportCitation, /Required procedure: ADAS calibration/i);
  assert.match(cited.conflictSummary, /OEM support metadata is available/i);

  const inferredReport = baseReport({
    issues: [
      {
        id: "structural-gap",
        category: "documentation",
        title: "Structural verification denied",
        finding: "Carrier position denies structural measurement verification.",
        impact: "Structural verification may be needed before final repair-path closure.",
        missingOperation: "Structural measurement verification",
        severity: "high",
        evidenceIds: [],
      },
    ],
    requiredProcedures: [],
    supplementOpportunities: ["Structural verification denied"],
  });
  const inferredModel = buildExportModel({ report: inferredReport, analysis: null, panel: null, assistantAnalysis: "" });
  const inferred = inferredModel.oemContradictions[0];

  assert.equal(inferred.supportStatus, "inferred");
  assert.equal(inferred.oemSupportCitation, null);
  assert.match(inferred.conflictSummary, /inferred and requires OEM source verification/i);
  assert.match(inferred.recommendedFollowUp, /verify the applicable OEM procedure/i);
});

run("Serper failed is exposed without implying web support", () => {
  const report = baseReport({
    retrievalSummary: {
      driveDocsUsed: 0,
      webSourcesUsed: 0,
      serperStatus: "FAILED",
      oemEvidenceFound: false,
      sourcesInfluencingFindings: [],
    },
  });
  const document = buildDisputeIntelligencePdf({
    report,
    analysis: null,
    panel: null,
    assistantAnalysis: "",
  });

  const text = JSON.stringify(document);
  assert.match(text, /Serper status: Failed/i);
  assert.match(text, /Web sources used: 0/i);
  assert.doesNotMatch(text, /Sources: web/i);
  assert.doesNotMatch(text, /OEM evidence found: Yes/i);
});

run("weak unsupported agent finding is suppressed, not reportable", () => {
  const input = {
    shopEstimateText: "2019 Nissan Altima rear bumper refinish only",
    insurerEstimateText: "",
    retrievedDocuments: [],
  };

  const gated = gateFinding(input, {
    issue: "Structural measurement verification",
    finding: "Structural measurement should be reviewed.",
    evidenceLevel: "inferred",
    supportSources: ["upload"],
    risk: "medium",
    confidence: 0.44,
    secondLevelReasoning: "Generic structural concern without current-file support.",
    thirdLevelAction: "Request measurement support.",
  });

  const suppressedFindings = gated.include
    ? []
    : [{ issue: gated.issue, reasonExcluded: gated.reasonExcluded }];
  const report = baseReport({
    findingReasoning: gated.include ? [gated] : [],
  });
  const renderModel = buildExportModel({ report, analysis: null, panel: null, assistantAnalysis: "" });

  assert.equal(gated.include, false);
  assert.equal(renderModel.findingReasoning.some((finding) => finding.issue === gated.issue), false);
  assert.equal(suppressedFindings[0]?.issue, "Structural measurement verification");
  assert.match(suppressedFindings[0]?.reasonExcluded ?? "", /Structural measurement requires|Confidence is below/i);
});

run("rebuttal email uses numbered asks and avoids banned generic phrases", () => {
  const report = baseReport({
    issues: [
      {
        id: "scan-1",
        category: "documentation",
        title: "Post-Repair Scan",
        finding: "Post-repair scan is not shown on the carrier estimate.",
        impact: "The estimate references electronic repair verification, but the scan record is not included.",
        missingOperation: "Post-Repair Scan",
        severity: "medium",
        evidenceIds: [],
      },
    ],
    missingProcedures: ["Post-Repair Scan"],
    supplementOpportunities: ["Post-Repair Scan"],
    recommendedActions: ["Add post-repair scan or provide line-item explanation."],
  });

  const document = buildRebuttalEmailPdf({
    report,
    analysis: null,
    panel: null,
    assistantAnalysis: "",
  });
  const text = JSON.stringify(document);

  assert.match(text, /1\./);
  assert.match(text, /Evidence:/);
  assert.match(text, /Requested action:/);
  assert.match(text, /revised estimate or provide a written line-item explanation/i);
  assert.doesNotMatch(text, /credible preliminary repair plan/i);
  assert.doesNotMatch(text, /support remains open/i);
  assert.doesNotMatch(text, /repair path appears supportable/i);
  assert.doesNotMatch(text, /procedure support should not be treated as no support/i);
});

run("collision snapshot masks VIN and claim number", () => {
  const report = baseReport({
    claimNumber: "CLM-99887766",
    sourceEstimateText: "VIN 4T1G11AK0NU123456 claim number CLM-99887766",
  });
  const renderModel = buildExportModel({ report, analysis: null, panel: null, assistantAnalysis: "" });
  const snapshot = buildCollisionSnapshot(renderModel);
  const text = JSON.stringify(snapshot);

  assert.doesNotMatch(text, /4T1G11AK0NU123456/);
  assert.match(text, /\*{5}3456|2022 Toyota Camry/);
  assert.doesNotMatch(text, /CLM-99887766/);
  assert.doesNotMatch(text, /claim number CLM/i);
});

run("collision snapshot redaction is deterministic and keeps identifier last 4", () => {
  const redacted = redactSensitiveData({
    vin: "1HGCM82633A009188",
    claimNumber: "ABC-45678037",
    note: "VIN 1HGCM82633A009188 claim number ABC-45678037",
    debug: {
      rawVin: "1HGCM82633A009188",
      rawClaim: "ABC-45678037",
    },
  });
  const text = JSON.stringify(redacted);

  assert.match(text, /\*{5}9188/);
  assert.match(text, /\*{5}8037/);
  assert.doesNotMatch(text, /1HGCM82633A009188/);
  assert.doesNotMatch(text, /ABC-45678037/);
  assert.doesNotMatch(text, /rawVin/);
  assert.doesNotMatch(text, /rawClaim/);
});

run("collision snapshot removes customer contact info", () => {
  const redacted = redactSensitiveData({
    customerName: "Jordan Smith",
    email: "jordan@example.com",
    phone: "555-123-4567",
    address: "123 Market Street",
    notes: "Owner: Jordan Smith phone 555-123-4567 email jordan@example.com at 123 Market Street",
  });
  const text = JSON.stringify(redacted);

  assert.match(text, /Vehicle Owner/);
  assert.doesNotMatch(text, /Jordan Smith/);
  assert.doesNotMatch(text, /jordan@example\.com/);
  assert.doesNotMatch(text, /555-123-4567/);
  assert.doesNotMatch(text, /123 Market Street/);
});

run("collision snapshot safe report is used without debug or raw identifiers", () => {
  const safeReport = buildSnapshotSafeReport({
    vehicle: { vin: "1HGCM82633A009188" },
    claimNumber: "ABC-45678037",
    customerName: "Jordan Smith",
    phone: "555-123-4567",
    email: "jordan@example.com",
    address: "123 Market Street",
    debug: { rawText: "Jordan Smith 1HGCM82633A009188 ABC-45678037" },
  });
  const text = JSON.stringify(safeReport);

  assert.match(text, /Vehicle Owner/);
  assert.match(text, /\*{5}9188/);
  assert.match(text, /\*{5}8037/);
  assert.doesNotMatch(text, /Jordan Smith/);
  assert.doesNotMatch(text, /555-123-4567/);
  assert.doesNotMatch(text, /jordan@example\.com/);
  assert.doesNotMatch(text, /123 Market Street/);
  assert.doesNotMatch(text, /debug/);
});

run("collision snapshot shows upload cap disclosure", () => {
  const report = baseReport({
    confidenceIntegrity: {
      baseConfidence: "High",
      adjustedConfidence: "Moderate",
      completenessStatus: "PARTIAL",
      uploadedFileCount: 5,
      uploadLimitReached: true,
      userIndicatedMoreFiles: true,
      missingCriticalEvidence: ["Scan records", "Final invoice"],
      confidencePenalties: [
        {
          reason: "UPLOAD_LIMIT_REACHED",
          impact: 15,
          explanation: "Current upload cap was reached.",
        },
      ],
      userFacingDisclosure: "The current file set appears incomplete, so this should not be treated as final.",
    },
  });
  const renderModel = buildExportModel({ report, analysis: null, panel: null, assistantAnalysis: "" });
  const snapshot = buildCollisionSnapshot(renderModel);

  assert.equal(snapshot.evidenceCompleteness.adjustedConfidence, "Moderate");
  assert.equal(snapshot.evidenceCompleteness.uploadLimitReached, true);
  assert.equal(snapshot.evidenceCompleteness.userIndicatedMoreFiles, true);
  assert.match(snapshot.disclosure, /incomplete file set/i);
});

run("collision snapshot includes top 3 dispute items only", () => {
  const report = baseReport({
    findingReasoning: [1, 2, 3, 4].map((index) => ({
      id: `finding-${index}`,
      issue: `Claim-specific item ${index}`,
      why_it_matters: `Item ${index} affects the estimate gap.`,
      what_proves_it: `Estimate line ${index} documents the mismatch.`,
      next_action: `Request correction ${index}.`,
      evidenceLevel: "documented",
      confidence: 0.9 - index * 0.02,
      claimSpecificity: "high",
    })),
    disputeStrategy: {
      leverageScore: 82,
      priorityFindings: ["Claim-specific item 4", "Claim-specific item 2", "Claim-specific item 1"],
      easyWins: [],
      hardFights: [],
      recommendedSequence: [],
    },
  });
  const renderModel = buildExportModel({ report, analysis: null, panel: null, assistantAnalysis: "" });
  const snapshot = buildCollisionSnapshot(renderModel);

  assert.equal(snapshot.topDisputeItems.length, 3);
  assert.equal(snapshot.topDisputeItems[0]?.issue, "Claim-specific item 1");
  assert.equal(snapshot.topDisputeItems[1]?.issue, "Claim-specific item 2");
  assert.equal(snapshot.topDisputeItems[2]?.issue, "Claim-specific item 3");
  assert.equal(snapshot.topDisputeItems.some((item) => item.issue === "Claim-specific item 4"), false);
});

run("collision snapshot does not include banned generic phrases", () => {
  const report = baseReport({
    findingReasoning: [
      {
        id: "generic-phrase",
        issue: "Refinish labor mismatch",
        why_it_matters: "Current file set supports the narrative supports a gap.",
        what_proves_it: "The estimate shows refinish labor delta.",
        next_action: "Support remains open and repair path appears supportable.",
        evidenceLevel: "documented",
        confidence: 0.82,
        claimSpecificity: "high",
      },
    ],
  });
  const renderModel = buildExportModel({ report, analysis: null, panel: null, assistantAnalysis: "" });
  const snapshot = buildCollisionSnapshot(renderModel);
  const text = JSON.stringify(snapshot);

  assert.doesNotMatch(text, /credible preliminary repair plan/i);
  assert.doesNotMatch(text, /support remains open/i);
  assert.doesNotMatch(text, /repair path appears supportable/i);
  assert.doesNotMatch(text, /procedure support should not be treated as no support/i);
  assert.doesNotMatch(text, /file documents several parts/i);
  assert.doesNotMatch(text, /current file set supports/i);
  assert.doesNotMatch(text, /the narrative supports/i);
});

function assertNoSnapshotIdentifiers(text) {
  assert.doesNotMatch(text, /1HGCM82633A009188/);
  assert.doesNotMatch(text, /ABC-45678037/);
  assert.doesNotMatch(text, /Jordan Smith/);
  assert.doesNotMatch(text, /555-123-4567/);
  assert.doesNotMatch(text, /jordan@example\.com/);
  assert.doesNotMatch(text, /123 Market Street/);
  assert.doesNotMatch(text, /debug/i);
}

function sensitiveSnapshotFixture() {
  const report = baseReport({
    vehicle: {
      year: 2022,
      make: "Toyota",
      model: "Camry",
      trim: "SE",
      vin: "1HGCM82633A009188",
      confidence: 0.9,
      source: "attachment",
    },
    claimNumber: "ABC-45678037",
    customerName: "Jordan Smith",
    phone: "555-123-4567",
    email: "jordan@example.com",
    address: "123 Market Street",
    debug: { rawText: "Jordan Smith 1HGCM82633A009188 ABC-45678037" },
    findingReasoning: [
      {
        id: "labor-gap",
        issue: "Body labor mismatch",
        why_it_matters: "The carrier labor reduction affects the repair-plan scope.",
        what_proves_it: "Shop estimate shows body labor above the carrier estimate.",
        next_action: "Request a line-by-line labor reconciliation.",
        evidenceLevel: "documented",
        confidence: 0.86,
        claimSpecificity: "high",
      },
    ],
  });
  const renderModel = buildExportModel({ report, analysis: null, panel: null, assistantAnalysis: "" });
  return buildCollisionSnapshot(renderModel);
}

run("snapshot preview contains no raw identifiers or debug", () => {
  const snapshot = sensitiveSnapshotFixture();
  const previewText = JSON.stringify(snapshot);

  assert.match(previewText, /Sensitive details removed for sharing/);
  assertNoSnapshotIdentifiers(previewText);
});

run("snapshot copied summary contains no identifiers", () => {
  const copiedText = buildSnapshotPlainText(sensitiveSnapshotFixture());

  assert.match(copiedText, /Repair verdict/i);
  assertNoSnapshotIdentifiers(copiedText);
});

run("snapshot PDF document text contains no identifiers", () => {
  const document = buildCollisionSnapshotPdfFromSnapshot(sensitiveSnapshotFixture());
  const pdfDocumentText = JSON.stringify(document);

  assert.match(pdfDocumentText, /Sensitive details removed for sharing/);
  assertNoSnapshotIdentifiers(pdfDocumentText);
});

run("snapshot send payload contains no identifiers", () => {
  const snapshot = sensitiveSnapshotFixture();
  const payload = {
    destinationType: "customer",
    subject: "Collision Snapshot for Your Vehicle",
    message: buildSnapshotEmailBody(snapshot, "customer"),
    snapshot,
    pdfBase64: "JVBERi0xLjQ=",
  };

  assertNoSnapshotIdentifiers(JSON.stringify(payload));
});

run("snapshot send logs contain no recipient email or raw report text", () => {
  const snapshot = sensitiveSnapshotFixture();
  const safeEvent = buildSnapshotSendSafeEvent({
    snapshot,
    destinationType: "carrier",
    hasPdf: true,
  });
  const logText = JSON.stringify(safeEvent);

  assert.match(logText, /snapshot_send_attempt/);
  assert.match(logText, /carrier/);
  assert.doesNotMatch(logText, /recipient/i);
  assert.doesNotMatch(logText, /adjuster@example\.com/);
  assertNoSnapshotIdentifiers(logText);
});

run("product gating keeps snapshot on Starter and locks report exports", () => {
  assert.equal(canAccessFeature("starter", "snapshot_export"), true);
  assert.equal(canAccessFeature("starter", "full_report_export"), false);
  assert.equal(canAccessFeature("starter", "dispute_report_export"), false);
  assert.equal(canAccessFeature("starter", "policy_rights_review_export"), false);
  assert.equal(canAccessFeature("starter", "customer_report_export"), false);
  assert.equal(canAccessFeature("starter", "chat_report_recommendations"), false);
  assert.equal(canAccessFeature("pro", "snapshot_export"), true);
  assert.equal(canAccessFeature("pro", "full_report_export"), true);
  assert.equal(canAccessFeature("pro", "dispute_report_export"), true);
  assert.equal(canAccessFeature("pro", "policy_rights_review_export"), true);
  assert.equal(canAccessFeature("pro", "customer_report_export"), true);
});

run("Starter can preview, download, and send Snapshot only", () => {
  const starterSnapshotActions = ["preview", "download", "send"];

  assert.equal(canAccessFeature("starter", "snapshot_export"), true);
  assert.deepEqual(
    starterSnapshotActions.map((action) => ({
      action,
      allowed: canAccessFeature("starter", "snapshot_export"),
    })),
    [
      { action: "preview", allowed: true },
      { action: "download", allowed: true },
      { action: "send", allowed: true },
    ]
  );
});

run("Starter cannot access full, dispute, customer, or chat PDFs", () => {
  const lockedFeatures = [
    "full_report_export",
    "dispute_report_export",
    "policy_rights_review_export",
    "customer_report_export",
    "chat_report_recommendations",
  ];

  for (const feature of lockedFeatures) {
    assert.equal(canAccessFeature("starter", feature), false, `${feature} should be locked`);
  }
});

run("Starter chat recommendations require upgrade framing for locked exports", () => {
  const guard = buildPlanRecommendationGuard(false);
  const productGuard = buildProductAccessGuard({
    plan: "starter",
    chatReportRecommendations: false,
    snapshotExport: true,
  });

  assert.match(guard, /Snapshot export is available/i);
  assert.match(guard, /Pro-only upgrades/i);
  assert.doesNotMatch(guard, /Generate the Dispute Intelligence Report next/i);
  assert.match(productGuard, /Snapshot export is available/i);
  assert.match(productGuard, /Pro-only upgrades/i);
});

run("Pro can access every export feature", () => {
  const exportFeatures = [
    "snapshot_export",
    "full_report_export",
    "dispute_report_export",
    "policy_rights_review_export",
    "customer_report_export",
    "chat_report_recommendations",
    "crm_sync",
  ];

  for (const feature of exportFeatures) {
    assert.equal(canAccessFeature("pro", feature), true, `${feature} should be available`);
  }
});

run("export API routes enforce locked features server-side", () => {
  const routeChecks = [
    {
      file: "src/app/api/chat/export/route.ts",
      feature: "full_report_export",
    },
    {
      file: "src/app/api/customer-report/route.ts",
      feature: "customer_report_export",
    },
    {
      file: "src/app/api/snapshot/send/route.ts",
      feature: "snapshot_export",
    },
  ];

  for (const check of routeChecks) {
    const source = fs.readFileSync(path.join(process.cwd(), check.file), "utf8");
    assert.match(source, /canAccessFeature/);
    assert.match(source, new RegExp(check.feature));
    assert.match(source, /403/);
  }
});

run("CRM events stay redacted", () => {
  const safe = sanitizeCrmPayload({
    event: "snapshot_sent_customer",
    plan: "pro",
    destinationType: "customer",
    adjustedConfidence: "Moderate",
    completenessStatus: "PARTIAL",
    topDisputeCount: 3,
    uploadLimitReached: true,
    userIndicatedMoreFiles: true,
    fileCount: 6,
    totalFilesReviewed: 12,
    vin: "1HGCM82633A009188",
    claimNumber: "ABC-45678037",
    recipientEmail: "owner@example.com",
    rawEstimateText: "raw estimate text",
    debug: { raw: true },
  });
  const text = JSON.stringify(safe);

  assert.match(text, /snapshot_sent_customer/);
  assert.match(text, /Moderate/);
  assert.doesNotMatch(text, /1HGCM82633A009188/);
  assert.doesNotMatch(text, /ABC-45678037/);
  assert.doesNotMatch(text, /owner@example\.com/);
  assert.doesNotMatch(text, /raw estimate text/);
  assert.doesNotMatch(text, /debug/);
});

run("upload batching tracks total files across batches", () => {
  const firstBatchTotal = 6;
  const secondBatchTotal = firstBatchTotal + 4;
  const prompt = buildNextBatchPrompt(secondBatchTotal, 6);
  const guidance = buildUploadBatchGuidance(firstBatchTotal, 5, 6);

  assert.match(prompt, /Files reviewed so far: 10/);
  assert.match(prompt, /Upload the next 6 most important files/);
  assert.match(guidance, /Files reviewed so far: 6/);
  assert.match(guidance, /You can upload up to 6 files at a time/);
  assert.match(guidance, /Upload the next 6 most important files/);
  assert.equal(NEXT_UPLOAD_PRIORITY[0], "final invoice");
});

run("voice presets render without celebrity or clone wording", () => {
  const labels = VOICE_PRESETS.map((preset) => preset.label);
  const presetText = JSON.stringify(VOICE_PRESETS);

  assert.deepEqual(labels, [
    "Default",
    "Clear Professional Female",
    "Firm NY Advisor",
    "Calm Customer Explainer",
    "Carrier Negotiation Voice",
  ]);
  assert.match(presetText, /female-coded, fast, confident, assertive, New York-style delivery/);
  assert.doesNotMatch(presetText, /Marisa|Tomei|My Cousin|Vinny|celebrity|clone|cloning/i);
  assert.doesNotMatch(TTS_STYLE_PROMPT, /Marisa|Tomei|My Cousin|Vinny/i);
  assert.match(TTS_STYLE_PROMPT, /Avoid parody, caricature, celebrity imitation, or cloning any real person's voice/i);
});

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
  buildLargeCaseChatContext,
  countLargeCaseSummaryArtifacts,
  resolveLargeCaseChatFallback,
} = require("./chatLargeCaseContext.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function fixtureCase(fileCount) {
  return {
    id: "case-large",
    estimateText: "RAW_ESTIMATE_TEXT_SHOULD_NOT_APPEAR ".repeat(100),
    files: Array.from({ length: fileCount }, (_, index) => ({
      id: `file-${index + 1}`,
      name: `reviewed-${index + 1}.pdf`,
      type: "application/pdf",
      text: `RAW_FILE_TEXT_${index + 1}_SHOULD_NOT_APPEAR `.repeat(80),
      summary: null,
    })),
    linkedEvidence: [
      {
        url: "https://example.test/oem.pdf",
        finalUrl: "https://example.test/oem.pdf",
        title: "OEM support",
        mimeType: "application/pdf",
        sourceType: "pdf",
        text: "linked text",
        status: "ok",
      },
    ],
    transcriptSummary: "Chat export context says the supplement dispute remains focused on calibration proof.",
    determination: "Carrier estimate is missing supported repair operations.",
    supportGaps: ["Need final calibration invoice.", "Need scan result proof."],
    extractedFacts: {
      vehicleLabel: "2022 Honda Accord",
      estimateTotal: 12345,
    },
    vehicle: {
      year: 2022,
      make: "Honda",
      model: "Accord",
      trim: null,
      vin: "1HGTEST123",
    },
    factualCore: {
      vehicleSummary: "2022 Honda Accord",
      currentCaseSummary: "Repair Intelligence Report summary says ADAS and structural evidence remain central.",
      visibleDamageObservations: ["Front impact"],
      documentedRepairOperations: ["Bumper overhaul"],
      evidenceRegistrySummary: ["Estimate and photos reviewed."],
      linkedEvidenceState: ["OEM support referenced."],
      issueAssessments: [
        {
          key: "adas_calibration",
          title: "ADAS calibration",
          status: "open",
          severity: "high",
          summary: "Calibration proof remains open.",
          evidenceIds: ["file-1"],
        },
      ],
      documentedPositives: ["Photos support impact location."],
      openIssues: ["ADAS calibration"],
      unresolvedVerificationNeeds: ["Calibration invoice"],
      currentDetermination: "Supplement support remains partly open.",
      caseContinuity: {
        mode: "active_case_update",
        reassessedAt: "2026-05-21T00:00:00.000Z",
        evidenceCount: fileCount,
      },
    },
    evidenceRegistry: [
      {
        id: "e1",
        sourceType: "calibration_report",
        label: "Calibration report",
        extractedSummary: "Calibration report is referenced but final invoice is missing.",
        ingestionState: "ingested",
        evidenceStatus: "open",
        relatedIssueKeys: ["adas_calibration"],
        createdAt: "2026-05-21T00:00:00.000Z",
        updatedAt: "2026-05-21T00:00:00.000Z",
      },
    ],
    reassessmentDelta: {
      addedEvidenceIds: ["e1"],
      affectedIssueKeys: ["adas_calibration"],
      statusChanges: [],
      newlyDocumented: ["Impact photos"],
      stillOpen: ["Calibration invoice"],
      determinationChanged: false,
      summary: "Estimate Delta summary says new photos help but calibration proof remains open.",
    },
    artifactRefreshPolicy: {
      mainReport: { shouldRefresh: false, reason: "Stable.", signals: [] },
      customerReport: { shouldRefresh: true, reason: "Customer explanation changed.", signals: ["photos"] },
      disputeReport: { shouldRefresh: false, reason: "No material dispute change.", signals: [] },
      rebuttalOutput: { shouldRefresh: false, reason: "No rebuttal change.", signals: [] },
      chatSummaryOnly: { shouldRefresh: true, reason: "Chat summary is sufficient.", signals: ["delta"] },
    },
    exportModel: {
      vehicle: { label: "2022 Honda Accord", confidence: "supported" },
      estimateFacts: {},
      reportFields: {
        documentedHighlights: [],
        documentedProcedures: [],
        presentStrengths: [],
        likelySupplementAreas: [],
        estimateFacts: {},
      },
      repairPosition: "Repair position",
      positionStatement: "Position",
      supplementItems: [],
      request: "Review supplement",
      valuation: {},
      determination: { answer: "Carrier estimate is incomplete.", reasons: [], missingFactors: [] },
      disputeIntelligenceReport: {
        summary: "Top dispute is incomplete calibration support.",
        topDrivers: [
          {
            title: "ADAS calibration",
            impact: "high",
            supportStatus: "missing",
            whyItMatters: "Safety system readiness.",
            currentGap: "No invoice.",
            nextAction: "Request calibration proof.",
            evidenceLevel: "referenced",
            retrievalSupport: ["upload"],
            leverageScore: 80,
            priorityRank: 1,
            whyThisWins: "Safety support.",
          },
        ],
        top3: [],
        positives: [],
        supportGaps: ["Need calibration invoice."],
        nextMoves: ["Ask carrier to address calibration."],
      },
      findingReasoning: [
        {
          issue: "ADAS calibration",
          why_it_matters: "Safety",
          what_proves_it: "Invoice",
          next_action: "Request invoice",
          evidenceLevel: "referenced",
          confidence: 0.7,
          claimSpecificity: "high",
          rationaleSummary: "Calibration is referenced but not fully proven.",
        },
      ],
      retrievalSummary: {
        driveDocsUsed: 2,
        webSourcesUsed: 0,
        serperStatus: "NOT_RUN",
        oemEvidenceFound: true,
        sourcesInfluencingFindings: [],
      },
      oemContradictions: [],
      confidenceIntegrity: {
        baseConfidence: "Moderate",
        adjustedConfidence: "Moderate",
        completenessStatus: "PARTIAL",
        uploadedFileCount: fileCount,
        indexedFileCount: fileCount,
        reviewedFileCount: fileCount,
        reviewableFileCount: fileCount,
        excludedFromReviewCount: 0,
        totalKnownFileCount: fileCount,
        uploadLimitReached: false,
        userIndicatedMoreFiles: false,
        missingCriticalEvidence: ["Calibration invoice"],
        confidencePenalties: [],
        userFacingDisclosure: "Some proof remains open.",
      },
      collisionSnapshot: {
        title: "Collision Snapshot",
        vehicleLabel: "2022 Honda Accord",
        damageSummary: ["Front impact"],
        repairPlanVerdict: {
          moreCompletePlan: "SHOP",
          carrierPlanStatus: "PARTIAL",
          reason: "Shop plan accounts for more safety operations.",
        },
        estimateComparison: {
          available: true,
          keyDeltas: ["Calibration omitted by carrier."],
        },
        topDisputeItems: [],
        pressureMode: "standard",
        pressureModeRationale: "Standard",
        evidenceCompleteness: {
          adjustedConfidence: "Moderate",
          completenessStatus: "PARTIAL",
          uploadedFileCount: fileCount,
          indexedFileCount: fileCount,
          reviewedFileCount: fileCount,
          reviewableFileCount: fileCount,
          excludedFromReviewCount: 0,
          totalKnownFileCount: fileCount,
          uploadLimitReached: false,
          userIndicatedMoreFiles: false,
          missingCriticalEvidence: ["Calibration invoice"],
          userFacingDisclosure: "Some proof remains open.",
        },
        nextActions: [],
        verdictLine: "Shop repair plan is better supported.",
        valuationSnapshot: { available: false, disclosure: "No valuation." },
        disclosure: "Snapshot summary disclosure.",
        redactionNotice: "Redacted.",
      },
      negotiationPlaybook: {
        likelyApproved: [],
        likelyPushback: [],
        strongestArguments: [],
        vulnerablePoints: [],
        suggestedSequence: [],
        documentationNeeded: ["Calibration invoice"],
      },
      financialGapBreakdown: { drivers: [], narrativeSummary: "" },
      pressureMode: {},
      outputMode: "STANDARD",
    },
  };
}

run("small file set stays on normal chat context path", () => {
  const decision = resolveLargeCaseChatFallback(fixtureCase(3), []);

  assert.equal(decision.useFallback, false);
  assert.equal(decision.fileCount, 3);
});

run("large file set uses summarized context", () => {
  const activeCase = fixtureCase(26);
  const decision = resolveLargeCaseChatFallback(activeCase, []);
  const context = buildLargeCaseChatContext({
    activeCase,
    conversationContext: "Recent chat asks whether calibration is still open.",
    newUploadSummary: "- None in this turn",
  });

  assert.equal(decision.useFallback, true);
  assert.match(context, /LARGE CASE SUMMARY FALLBACK/);
  assert.match(context, /Repair Intelligence Report summary/);
  assert.match(context, /Customer Report summary/);
  assert.match(context, /DOI Readiness state/);
  assert.match(context, /Chat export context/);
  assert.equal(context.includes("RAW_FILE_TEXT_1_SHOULD_NOT_APPEAR"), false);
  assert.equal(context.includes("RAW_ESTIMATE_TEXT_SHOULD_NOT_APPEAR"), false);
});

run("high estimated context also triggers summarized context", () => {
  const activeCase = fixtureCase(2);
  activeCase.files[0].text = "x".repeat(130000);

  const decision = resolveLargeCaseChatFallback(activeCase, []);

  assert.equal(decision.useFallback, true);
  assert.match(decision.reasons.join(" "), /estimated_context_chars/);
});

run("summary context includes generated artifact sections before external search can be considered", () => {
  const context = buildLargeCaseChatContext({
    activeCase: fixtureCase(26),
    conversationContext: "",
    newUploadSummary: "- None in this turn",
  });

  assert.equal(countLargeCaseSummaryArtifacts(context) >= 7, true);
});

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
  alignCustomerEstimatePostureText,
  resolveEstimatePosture,
  stripEstimateComparisonLanguage,
} = require("./estimatePosture.ts");
const {
  enforceCustomerReportGuards,
  APPRAISAL_CONDITIONAL_SENTENCE,
} = require("./generateCustomerReport.ts");
const { buildCustomerReportPdf } = require("./builders/customerReportPdfBuilder.ts");
const { formatRepairIntelligenceSourceStatus } = require("./builders/carrierPdfBuilder.ts");
const { buildCollisionSnapshot } = require("./builders/collisionSnapshot.ts");
const { renderCustomerReportHtml } = require("./renderCustomerReportHtml.ts");

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function customerReport(bodyText) {
  return {
    title: "Customer Report",
    openingSummary: "The current file was reviewed.",
    whichRepairPlanLooksStronger: bodyText,
    safetyFirst: "Repair quality should be verified.",
    whatStillNeedsProof: ["Final repair documentation."],
    yourOptions: ["Ask for a written explanation."],
    bottomLine: "Use the shared estimate posture.",
  };
}

function renderModel(posture) {
  return {
    vehicle: { year: 2020, make: "Tesla", model: "Model 3", confidence: "supported" },
    reportFields: {
      documentedHighlights: [],
      documentedProcedures: [],
    },
    supplementItems: [],
    findingReasoning: [],
    confidenceIntegrity: {
      adjustedConfidence: "Moderate",
      completenessStatus: "PARTIAL",
      uploadedFileCount: 1,
      indexedFileCount: 1,
      reviewedFileCount: 1,
      reviewableFileCount: 1,
      excludedFromReviewCount: 0,
      excludedFromReviewReasons: [],
      totalKnownFileCount: 1,
      uploadLimitReached: false,
      userIndicatedMoreFiles: false,
      missingCriticalEvidence: [],
      userFacingDisclosure: "Current file set remains partial.",
    },
    disputeStrategy: { priorityFindings: [] },
    supplementItemsByCategory: [],
    selectedEstimatePosture: posture,
    valuation: {
      acvRange: null,
      dvRange: null,
      acvConfidence: null,
      dvConfidence: null,
      acvReasoning: "",
    },
    outputMode: {
      mode: "explanatory",
      rationale: "Consensus test fixture.",
      itemBreakdown: [],
    },
    pressureMode: {
      mode: "explanatory",
      rationale: "Consensus test fixture.",
      itemBreakdown: [],
    },
  };
}

run("customer report heading aligns with carrier-selected posture", () => {
  const posture = {
    selectedEstimateLabel: "carrier",
    selectedEstimateReason: "The shared estimate posture favors the carrier estimate.",
    confidence: "medium",
    limitations: [],
  };
  const document = buildCustomerReportPdf({
    report: customerReport("The shop estimate appears materially more complete."),
    vehicle: "2020 Tesla Model 3",
    selectedEstimatePosture: posture,
  });
  const section = document.sections.find((item) => /what this means for you/i.test(item.title));

  assert.match(section?.title ?? "", /What This Means for You/);
  assert.doesNotMatch(JSON.stringify(section), /shop estimate appears materially more complete/i);
  assert.match(JSON.stringify(section), /insurance estimate appears more complete/i);
});

run("customer HTML heading aligns with shop-selected posture", () => {
  const posture = {
    selectedEstimateLabel: "shop",
    selectedEstimateReason: "The shared estimate posture favors the shop estimate.",
    confidence: "medium",
    limitations: [],
  };
  const html = renderCustomerReportHtml({
    report: customerReport("The carrier estimate appears materially more complete."),
    vehicle: "2020 Tesla Model 3",
    generatedAt: "June 6, 2026",
    selectedEstimatePosture: posture,
  });

  assert.match(html, /What This Means for You/);
  assert.doesNotMatch(html, /carrier estimate appears materially more complete/i);
  assert.match(html, /shop estimate appears more complete/i);
});

run("snapshot uses the same selected estimate posture", () => {
  const posture = {
    selectedEstimateLabel: "carrier",
    selectedEstimateReason: "The shared estimate posture favors the carrier estimate.",
    confidence: "medium",
    limitations: [],
  };
  const snapshot = buildCollisionSnapshot(renderModel(posture));

  assert.equal(snapshot.repairPlanVerdict.moreCompletePlan, "CARRIER");
  assert.match(snapshot.repairPlanVerdict.reason, /shared estimate posture favors the carrier estimate/i);
});

run("customer report uses neutral heading for undetermined posture", () => {
  const posture = {
    selectedEstimateLabel: "undetermined",
    selectedEstimateReason: "The shared estimate posture is undetermined.",
    confidence: "low",
    limitations: [],
  };
  const document = buildCustomerReportPdf({
    report: customerReport("The shop estimate appears materially more complete."),
    vehicle: "2020 Tesla Model 3",
    selectedEstimatePosture: posture,
  });
  const section = document.sections.find((item) => /what this means for you/i.test(item.title));

  assert.match(section?.title ?? "", /What This Means for You/i);
  assert.doesNotMatch(JSON.stringify(section), /shop estimate appears materially more complete/i);
  assert.match(JSON.stringify(section), /estimate posture is not yet clear/i);
});

run("shared posture resolver selects shop when shop-only gaps dominate", () => {
  const posture = resolveEstimatePosture({
    estimateComparisons: {
      rows: [
        {
          id: "scan-row",
          category: "Diagnostics",
          operation: "Post-repair scan",
          lhsSource: "Shop estimate",
          rhsSource: "Carrier estimate",
          lhsValue: "Post-repair scan",
          rhsValue: null,
          delta: "Present only in shop estimate",
          deltaType: "added",
        },
      ],
    },
  });
  const chatSafeText = alignCustomerEstimatePostureText(
    "The carrier estimate appears materially more complete.",
    posture
  );

  assert.equal(posture.selectedEstimateLabel, "shop");
  assert.match(chatSafeText, /shop estimate appears more complete/i);
  assert.doesNotMatch(chatSafeText, /carrier estimate appears materially more complete/i);
});

run("single-estimate file never yields comparison posture, even with support gaps", () => {
  const posture = resolveEstimatePosture({
    estimateComparisons: { rows: [] },
    report: {
      supplementOpportunities: [{ title: "Seam sealer" }],
      missingProcedures: ["OEM rear body panel procedure"],
      findingReasoning: [],
    },
  });

  assert.equal(posture.selectedEstimateLabel, "undetermined");
  assert.equal(posture.comparisonAvailable, false);
  assert.doesNotMatch(posture.selectedEstimateReason, /carrier|insurer|shop estimate/i);
});

run("single-estimate customer report drops carrier-comparison wording and headings", () => {
  const posture = {
    selectedEstimateLabel: "undetermined",
    selectedEstimateReason: "Only one estimate is present in the reviewed file, so no estimate comparison was made.",
    confidence: "low",
    limitations: [],
    comparisonAvailable: false,
  };
  const document = buildCustomerReportPdf({
    report: {
      ...customerReport("The insurance estimate may be missing items compared to the shop estimate."),
      whatStillNeedsProof: ["The [REDACTED_INSURER] estimate may be missing items for the rear body panel."],
    },
    vehicle: "2010 Nissan Altima",
    selectedEstimatePosture: posture,
  });
  const flattened = JSON.stringify(document.sections);
  const titles = document.sections.map((section) => section.title).join("|");

  assert.equal(
    titles,
    "Plain-English Summary|What This Means for You|Key Findings|Why These Items Matter|Questions to Ask|Supporting Documentation|Technical Appendix"
  );
  assert.doesNotMatch(flattened, /insurance estimate|insurer|carrier estimate|\[REDACTED_INSURER\]/i);
  assert.doesNotMatch(titles, /estimates differ|insurance estimate/i);
});

run("appraisal claims are downgraded to the approved conditional sentence without policy language", () => {
  const guarded = enforceCustomerReportGuards(
    {
      title: "Customer Report",
      openingSummary: "The file was reviewed.",
      whichRepairPlanLooksStronger: "The estimate covers the core repairs.",
      safetyFirst: "Verification matters.",
      whatStillNeedsProof: ["Scan reports."],
      yourOptions: [
        "Your policy includes an appraisal option that lets you dispute the amount.",
        "The policy provides an appraisal clause you can invoke.",
        "Ask for a written explanation.",
      ],
      bottomLine: "Your policy includes an appraisal option if you disagree.",
    },
    { policySignals: {}, comparisonAvailable: true }
  );

  assert.equal(guarded.yourOptions[0], APPRAISAL_CONDITIONAL_SENTENCE);
  assert.equal(guarded.yourOptions.length, 2, "duplicate appraisal assertions collapse to one conditional");
  assert.equal(guarded.yourOptions[1], "Ask for a written explanation.");
  assert.match(guarded.bottomLine, /If your policy includes an appraisal or dispute-resolution provision/);
  assert.doesNotMatch(guarded.bottomLine, /policy includes an appraisal option/i);
});

run("appraisal statements survive when actual policy language was reviewed", () => {
  const guarded = enforceCustomerReportGuards(
    {
      title: "Customer Report",
      openingSummary: "",
      whichRepairPlanLooksStronger: "",
      safetyFirst: "",
      whatStillNeedsProof: [],
      yourOptions: ["Your policy includes an appraisal option that applies to amount disputes."],
      bottomLine: "",
    },
    { policySignals: { hasAppraisalClause: true }, comparisonAvailable: true }
  );

  assert.match(guarded.yourOptions[0], /policy includes an appraisal option/i);
});

run("estimate documentation and research leads never render as Verified support", () => {
  assert.equal(
    formatRepairIntelligenceSourceStatus("documented"),
    "Documented on the estimate — supporting proof still open"
  );
  assert.equal(
    formatRepairIntelligenceSourceStatus("online fallback research lead"),
    "General/non-make-specific research lead"
  );
  assert.equal(
    formatRepairIntelligenceSourceStatus("verified OEM procedure retrieved"),
    "Verified OEM/procedure support"
  );
  assert.doesNotMatch(formatRepairIntelligenceSourceStatus("inferred"), /verified/i);
});

run("stripEstimateComparisonLanguage rewrites carrier framing to single-estimate framing", () => {
  assert.equal(
    stripEstimateComparisonLanguage("The [REDACTED_INSURER] estimate may be missing items."),
    "Some items on the estimate still need supporting documentation."
  );
  assert.equal(
    stripEstimateComparisonLanguage("The insurance estimate leaves out scans."),
    "The estimate leaves out scans."
  );
  assert.doesNotMatch(
    stripEstimateComparisonLanguage("Where the estimates differ, the carrier estimate leaves out scans."),
    /estimates differ|carrier estimate/i
  );
});

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
} = require("./estimatePosture.ts");
const { buildCustomerReportPdf } = require("./builders/customerReportPdfBuilder.ts");
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
  const section = document.sections.find((item) => /estimate looks more complete/i.test(item.title));

  assert.match(section?.title ?? "", /Why The Insurance Estimate Looks More Complete\.?/);
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

  assert.match(html, /Why The Shop Estimate Looks More Complete/);
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
  const section = document.sections.find((item) => /estimates differ/i.test(item.title));

  assert.match(section?.title ?? "", /Where The Estimates Differ/i);
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

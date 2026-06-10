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
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  resolveAnnotatedCitationDensityTarget,
  shouldGenerateAnnotatedCitationDensityEstimate,
} = require("./citationDensityIntent.ts");
const {
  NO_SOURCE_PDF_ERROR,
  NO_SOURCE_PDF_USER_MESSAGE,
  describeReviewTarget,
  resolveSourceEstimatePdf,
} = require("./citationDensitySourcePdf.ts");

function pdfAttachment(overrides = {}) {
  return {
    id: overrides.id ?? "pdf-1",
    filename: overrides.filename ?? "carrier-estimate.pdf",
    type: overrides.type ?? "application/pdf",
    text: overrides.text ?? "Carrier insurance estimate lower cost estimate line 12 ADAS calibration",
    imageDataUrl: overrides.imageDataUrl ?? "data:application/pdf;base64,JVBERi0xLjQK",
    classification: "pdf",
    ...overrides,
  };
}

function reportWithEvidenceRegistry() {
  return {
    narrative: "",
    evidenceRegistry: [
      {
        id: "carrier-evidence",
        sourceType: "carrier_estimate",
        label: "Carrier Estimate",
        ingestionState: "ingested",
        evidenceStatus: "verified",
        relatedIssueKeys: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "shop-evidence",
        sourceType: "shop_estimate",
        label: "Shop Estimate",
        ingestionState: "ingested",
        evidenceStatus: "verified",
        relatedIssueKeys: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function finding(overrides = {}) {
  return {
    id: "finding-1",
    operationLabel: "ADAS calibration",
    category: "adas_calibration",
    estimateGapType: "needs_proof",
    carrierEvidence: {
      lineNumber: "12",
      description: "ADAS calibration",
      amount: 250,
      laborHours: 1.5,
      sourceLabel: "Carrier Estimate",
    },
    shopEvidence: {
      lineNumber: "12",
      description: "ADAS calibration",
      amount: 450,
      laborHours: 2,
      sourceLabel: "Shop Estimate",
    },
    impact: {
      safetyImpact: "high",
      supplementPriority: "high",
    },
    citationStatus: {
      oem: "needed",
      pPages: "not_found",
      scrs: "not_applicable",
      deg: "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: 35,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: ["OEM procedure"],
    currentSupportSummary: "Estimate line only.",
    missingProofSummary: "OEM proof needed.",
    recommendedNextAction: "Attach OEM procedure.",
    confidence: "medium",
    limitations: [],
    ...overrides,
  };
}

function run(name, test) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("chat intent routes annotated citation density carrier estimate requests to annotated export", () => {
  const input = "Generate an annotated citation density estimate PDF for the carrier estimate.";

  assert.equal(shouldGenerateAnnotatedCitationDensityEstimate(input), true);
  assert.equal(resolveAnnotatedCitationDensityTarget(input), "carrier");

  const chatSource = fs.readFileSync(path.join(process.cwd(), "src/components/ChatWidget.tsx"), "utf8");
  assert.match(chatSource, /\/api\/reports\/citation-density\/annotated-estimate/);
  assert.doesNotMatch(chatSource, /I can't generate a PDF|I can only give you the annotation set|use this in Adobe|use this in Bluebeam/i);
  assert.doesNotMatch(chatSource, /annotation map/i);
});

run("explicit standalone summary requests do not trigger annotated estimate intent", () => {
  assert.equal(shouldGenerateAnnotatedCitationDensityEstimate("Download the Citation Density summary report."), false);
  assert.equal(shouldGenerateAnnotatedCitationDensityEstimate("Generate the standalone Citation Density Gap Report."), false);
});

run("export card primary Citation Density action calls annotated route, not standalone report builder", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/ChatbotPage.tsx"), "utf8");
  const downloadIndex = source.indexOf('if (reportType === "estimate_scrubber")');
  const annotatedFetchIndex = source.indexOf('"/api/reports/citation-density/annotated-estimate"', downloadIndex);
  const standaloneBuilderIndex = source.indexOf("buildAnnotatedEstimateReviewPdf", downloadIndex);

  assert.match(source, /Download annotated estimate/);
  assert.ok(annotatedFetchIndex > downloadIndex);
  assert.ok(standaloneBuilderIndex === -1 || annotatedFetchIndex < standaloneBuilderIndex);
});

run("one uploaded estimate PDF is selected as the annotated source base", () => {
  const selected = resolveSourceEstimatePdf({
    attachments: [pdfAttachment({ id: "only-estimate", filename: "uploaded-estimate.pdf" })],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "selected",
    findings: [finding()],
  });

  assert.equal(selected.id, "only-estimate");
  assert.equal(describeReviewTarget(selected, "selected", [selected]), "Uploaded estimate");
});

run("carrier target selects carrier or lower-cost PDF over shop PDF", () => {
  const carrier = pdfAttachment({
    id: "carrier",
    filename: "Carrier Estimate.pdf",
    text: "Carrier insurance estimate lower cost estimate line 12 ADAS calibration",
  });
  const shop = pdfAttachment({
    id: "shop",
    filename: "Shop Estimate.pdf",
    text: "Shop repair facility estimate higher cost ADAS calibration",
  });

  const selected = resolveSourceEstimatePdf({
    attachments: [shop, carrier],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "carrier",
    findings: [finding()],
  });

  assert.equal(selected.id, "carrier");
});

run("missing source PDF returns clear user-facing missing-source message data", () => {
  const selected = resolveSourceEstimatePdf({
    attachments: [
      pdfAttachment({
        id: "text-only",
        filename: "notes.txt",
        type: "text/plain",
        text: "not a pdf",
        imageDataUrl: undefined,
      }),
    ],
    report: reportWithEvidenceRegistry(),
    targetEstimate: "carrier",
    findings: [finding()],
  });

  assert.equal(selected, null);
  assert.equal(NO_SOURCE_PDF_ERROR, "No original estimate PDF was found for annotation.");
  assert.match(NO_SOURCE_PDF_USER_MESSAGE, /select or upload the estimate PDF/i);
});

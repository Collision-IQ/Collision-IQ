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

const { buildCarrierReport } = require("./builders/carrierPdfBuilder.ts");
const { buildDisputeIntelligencePdf } = require("./builders/disputeIntelligencePdfBuilder.ts");
const { __testables } = require("./builders/exportPdf.ts");

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeFakeDoc() {
  return {
    internal: {
      pageSize: {
        getWidth: () => 216,
        getHeight: () => 279,
      },
    },
    splitTextToSize(value, width) {
      const maxChars = Math.max(1, Math.floor(width / 2.5));
      const text = `${value}`;
      const lines = [];
      for (let index = 0; index < text.length; index += maxChars) {
        lines.push(text.slice(index, index + maxChars));
      }
      return lines.length > 0 ? lines : [""];
    },
  };
}

function estimateDocumentSectionsHeight(document) {
  const doc = makeFakeDoc();
  const layout = __testables.createPdfPageLayout(doc);
  const total = document.sections.reduce(
    (sum, section) => sum + __testables.estimateSectionHeight(doc, layout.contentWidth, section),
    0
  );

  return { total, layout };
}

function makeLongReportFixture() {
  const longNarrative = "This estimate reads as broadly credible, but the file still leaves multiple documentation, validation, and parts-position questions open as teardown and repair planning mature. ";
  const repeated = (value, count) => Array.from({ length: count }, () => value).join(" ");

  const report = {
    summary: {
      riskScore: "high",
      confidence: "moderate",
      criticalIssues: 4,
      evidenceQuality: "moderate",
    },
    vehicle: {
      vin: "5UXCR6C06P9D12345",
      year: 2023,
      make: "BMW",
      model: "X5",
      trim: "xDrive40i",
      source: "attachment",
      confidence: 0.96,
    },
    issues: [
      {
        id: "issue-1",
        category: "documentation",
        title: "Structural Measurement Verification",
        finding: "Structural Measurement Verification",
        impact: repeated("Geometry validation remains under-documented relative to the visible repair path.", 5),
        missingOperation: "Structural Measurement Verification",
        severity: "high",
        evidenceIds: ["evidence-1"],
      },
      {
        id: "issue-2",
        category: "calibration",
        title: "ADAS Calibration Procedure Support",
        finding: "ADAS Calibration Procedure Support",
        impact: repeated("Calibration closure is not clearly tied to OEM procedures or invoice-backed proof.", 5),
        missingOperation: "ADAS Calibration Procedure Support",
        severity: "high",
        evidenceIds: ["evidence-1"],
      },
      {
        id: "issue-3",
        category: "fit",
        title: "Pre-Paint Test Fit",
        finding: "Pre-Paint Test Fit",
        impact: repeated("Fit-sensitive front-end work remains exposed without pre-paint validation records.", 4),
        missingOperation: "Pre-Paint Test Fit",
        severity: "medium",
        evidenceIds: ["evidence-2"],
      },
      {
        id: "issue-4",
        category: "parts",
        title: "OEM vs Alternate Suspension Components",
        finding: "OEM vs Alternate Suspension Components",
        impact: repeated("The parts-position remains vulnerable without OEM support for the selected suspension path.", 4),
        missingOperation: "OEM vs Alternate Suspension Components",
        severity: "high",
        evidenceIds: ["evidence-2"],
      },
      {
        id: "issue-5",
        category: "materials",
        title: "Corrosion Protection / Cavity Wax",
        finding: "Corrosion Protection / Cavity Wax",
        impact: repeated("Corrosion-restoration support is referenced lightly and still needs documentation closure.", 4),
        missingOperation: "Corrosion Protection / Cavity Wax",
        severity: "medium",
        evidenceIds: ["evidence-1"],
      },
    ],
    requiredProcedures: [],
    presentProcedures: [
      "Pre-repair scan",
      "Post-repair scan",
      "Headlamp aim",
      "Procedure research and documentation",
      "Road test",
      "Refrigerant recovery and recharge",
    ],
    missingProcedures: [
      "Structural Measurement Verification",
      "ADAS Calibration Procedure Support",
      "Pre-Paint Test Fit",
      "Wheel Alignment Documentation",
    ],
    supplementOpportunities: [
      repeated("Request OEM front-end calibration procedure references and invoice-backed proof.", 3),
      repeated("Request structural setup, measurement, and final verification records.", 3),
      repeated("Request alignment printout and pre-paint fit-validation support before final finish work.", 3),
      repeated("Anchor the suspension parts strategy to BMW procedure support and one-time-use requirements.", 3),
    ],
    evidence: [
      {
        id: "evidence-1",
        title: "BMW front-end estimate",
        snippet: repeated("BMW X5 supplement excerpt with calibration, structural, and materials references.", 16),
        source: "bmw-front-estimate.pdf",
        authority: "inferred",
      },
      {
        id: "evidence-2",
        title: "BMW procedure packet",
        snippet: repeated("OEM packet references fit-sensitive assemblies, measuring requirements, and calibration closure.", 16),
        source: "bmw-procedures.pdf",
        authority: "oem",
      },
    ],
    recommendedActions: [
      `${longNarrative}${longNarrative}${longNarrative}`,
      repeated("Lead with OEM procedures, safety items, and invoice-backed validation records.", 6),
    ],
    analysis: undefined,
    sourceEstimateText: repeated("2023 BMW X5 xDrive40i estimate with structural, calibration, and parts-support gaps.", 20),
  };

  const analysis = {
    mode: "comparison",
    parserStatus: "ok",
    summary: report.summary,
    findings: [],
    supplements: [],
    evidence: report.evidence.map((item) => ({ source: item.source, quote: item.snippet })),
    operations: [
      { operation: "Structural Measurement Verification", component: "Front structure", rawLine: "Meas Structural setup and verification" },
      { operation: "ADAS Calibration Procedure Support", component: "Front camera and radar", rawLine: "Cal ADAS calibration verification" },
      { operation: "Pre-Paint Test Fit", component: "Front bumper and lamp package", rawLine: "Proc Pre-paint fit check" },
      { operation: "OEM vs Alternate Suspension Components", component: "Right front suspension", rawLine: "Part Suspension parts strategy" },
      { operation: "Corrosion Protection / Cavity Wax", component: "Corrosion materials", rawLine: "Mat Cavity wax and corrosion protection" },
    ],
    estimateComparisons: {
      rows: Array.from({ length: 10 }, (_, index) => ({
        category: index % 2 === 0 ? "Paint" : "Structural",
        operation: `Operation ${index + 1}`,
        partName: `Part ${index + 1}`,
        lhsSource: "Shop",
        lhsValue: repeated("Full-support repair path ", 6),
        rhsSource: "Carrier",
        rhsValue: repeated("Reduced or unsupported carrier posture ", 6),
        delta: `$${(index + 1) * 450}`,
        deltaType: index % 3 === 0 ? "changed" : "added",
        notes: [repeated("Long comparison note describing why this row matters for scope, process, and support.", 3)],
      })),
    },
    rawEstimateText: report.sourceEstimateText,
    narrative: repeated("The carrier posture underwrites structural, calibration, and parts-position support in several decision-relevant areas.", 8),
    vehicle: report.vehicle,
  };

  return { report, analysis };
}

run("long main report fixture estimates beyond one page for pagination QA", () => {
  const { report, analysis } = makeLongReportFixture();
  const document = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: analysis.narrative,
    workspaceData: null,
  });
  const { total, layout } = estimateDocumentSectionsHeight(document);

  assert.equal(document.header.title, "Collision Repair Supplement & Evaluation");
  assert.ok(document.sections.length >= 8);
  assert.ok(total > layout.usableHeight * 1.8);
});

run("long dispute intelligence fixture stays concise but still stresses multi-page rendering", () => {
  const { report, analysis } = makeLongReportFixture();
  const document = buildDisputeIntelligencePdf({
    report,
    analysis,
    panel: null,
    assistantAnalysis: analysis.narrative,
    workspaceData: null,
  });
  const { total, layout } = estimateDocumentSectionsHeight(document);
  const topDrivers = document.sections.find((section) => section.title === "Top Dispute Drivers");

  assert.equal(document.header.title, "Dispute Intelligence Report");
  assert.ok(document.sections.length >= 4);
  assert.ok(total > layout.usableHeight);
  assert.ok((topDrivers?.bullets ?? []).length >= 4);
  assert.equal(
    document.sections.some((section) => section.title === "What Still Needs Support"),
    true
  );
});

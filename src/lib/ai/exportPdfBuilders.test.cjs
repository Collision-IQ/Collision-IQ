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
  buildRebuttalEmailPdf,
} = require("./builders/rebuttalEmailPdfBuilder.ts");
const {
  buildDisputeIntelligencePdf,
} = require("./builders/disputeIntelligencePdfBuilder.ts");

const TEST_VIN = "1GKKNRLS7MZ123456";

const REPORT = {
  summary: {
    riskScore: "moderate",
    confidence: "moderate",
    criticalIssues: 1,
    evidenceQuality: "moderate",
  },
  vehicle: {
    vin: TEST_VIN,
    year: 2021,
    make: "GMC",
    model: "Acadia",
    trim: "SLT AWD",
    source: "attachment",
    confidence: 0.92,
  },
  issues: [
    {
      id: "issue-1",
      category: "documentation",
      title: "Pre-Repair Scan",
      finding: "Pre-Repair Scan",
      impact: "Pre-scan support is not clearly represented in the estimate.",
      missingOperation: "Pre-Repair Scan",
      severity: "medium",
      evidenceIds: [],
    },
  ],
  requiredProcedures: [],
  presentProcedures: [],
  missingProcedures: ["Pre-Repair Scan"],
  supplementOpportunities: ["Add and document Four-Wheel Alignment."],
  evidence: [
    {
      id: "evidence-1",
      title: "Estimate excerpt",
      snippet: "2021 GMC Acadia VIN 1GKKNRLS7MZ123456. Pre-scan not shown. Alignment not documented.",
      source: "shop estimate",
      authority: "inferred",
    },
  ],
  recommendedActions: [
    "The current estimate underwrites scan and alignment support that should be carried clearly.",
  ],
  analysis: undefined,
};

const ANALYSIS = {
  mode: "comparison",
  parserStatus: "ok",
  summary: {
    riskScore: "moderate",
    confidence: "moderate",
    criticalIssues: 1,
    evidenceQuality: "moderate",
  },
  findings: [],
  supplements: [],
  evidence: [
    {
      source: "shop estimate",
      quote: "Pre-scan not shown and alignment support remains open.",
    },
  ],
  operations: [
    {
      operation: "Pre-Repair Scan",
      component: "Front bumper and ADAS",
      rawLine: "Proc Pre-Repair Scan",
    },
    {
      operation: "Four-Wheel Alignment",
      component: "Suspension",
      rawLine: "Algn Four-Wheel Alignment",
    },
  ],
  rawEstimateText: "Proc Pre-Repair Scan\nAlgn Four-Wheel Alignment",
  narrative: "The carrier posture underwrites scan and alignment support relative to the repair path.",
  vehicle: REPORT.vehicle,
};

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("rebuttal PDF renders expected sections", () => {
  const document = buildRebuttalEmailPdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Carrier Rebuttal Email");
  assert.ok(document.sections.some((section) => section.title === "Recommended Subject"));
  assert.ok(document.sections.some((section) => section.title === "Editable Email Body"));
  assert.ok(document.summary.some((item) => item.label === "VIN" && item.value === TEST_VIN));
});

run("dispute intelligence PDF renders decision-ready sections", () => {
  const document = buildDisputeIntelligencePdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Dispute Intelligence Report");
  assert.ok(document.sections.some((section) => section.title === "At-a-Glance Conclusion"));
  assert.ok(
    document.sections.some((section) =>
      section.title === "Top Dispute Drivers"
    )
  );
  assert.ok(
    document.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => /Status:/i.test(bullet))
    )
  );
});

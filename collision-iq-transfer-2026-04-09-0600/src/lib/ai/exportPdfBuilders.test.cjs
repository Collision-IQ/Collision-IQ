/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

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
  buildSideBySidePdf,
} = require("./builders/sideBySidePdfBuilder.ts");
const {
  buildLineByLinePdf,
} = require("./builders/lineByLinePdfBuilder.ts");

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

run("side-by-side PDF renders expected comparison sections", () => {
  const document = buildSideBySidePdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Side-by-Side Comparison Report");
  assert.ok(document.sections.some((section) => section.title === "Overall Position"));
  assert.ok(
    document.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => bullet.startsWith("Shop position:"))
    )
  );
  assert.ok(
    document.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => bullet.startsWith("Carrier position:"))
    )
  );
});

run("line-by-line PDF renders expected operation rows", () => {
  const document = buildLineByLinePdf({
    report: REPORT,
    analysis: ANALYSIS,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(document.header.title, "Line-by-Line Comparison Report");
  assert.ok(document.sections.some((section) => section.title.includes("Pre-Repair Scan")));
  assert.ok(
    document.sections.some((section) =>
      (section.bullets ?? []).includes("Estimate line: Proc Pre-Repair Scan")
    )
  );
  assert.ok(
    document.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => bullet.startsWith("Support status:"))
    )
  );
});

run("line-by-line PDF keeps procedure rows grounded instead of forcing fuzzy supplement matches", () => {
  const document = buildLineByLinePdf({
    report: REPORT,
    analysis: {
      ...ANALYSIS,
      operations: [
        {
          operation: "Proc",
          component: "Seat belt dynamic function test",
          rawLine: "Proc Seat belt dynamic function test",
        },
        {
          operation: "Proc",
          component: "Final road test",
          rawLine: "Proc Final road test",
        },
        {
          operation: "Proc",
          component: "Cavity wax",
          rawLine: "Proc Cavity wax",
        },
        {
          operation: "Proc",
          component: "Pre-paint test fit",
          rawLine: "Proc Pre-paint test fit",
        },
      ],
      rawEstimateText:
        "Proc Seat belt dynamic function test\nProc Final road test\nProc Cavity wax\nProc Pre-paint test fit",
    },
    panel: null,
    assistantAnalysis: null,
  });

  const seatBeltSection = document.sections.find((section) =>
    section.title.includes("Seat belt dynamic function test")
  );
  const roadTestSection = document.sections.find((section) =>
    section.title.includes("Final road test")
  );
  const cavityWaxSection = document.sections.find((section) =>
    section.title.includes("Cavity wax")
  );
  const testFitSection = document.sections.find((section) =>
    section.title.includes("Pre-paint test fit")
  );

  assert.ok(seatBeltSection);
  assert.ok(roadTestSection);
  assert.ok(cavityWaxSection);
  assert.ok(testFitSection);
  assert.equal(document.sections.some((section) => /^Line \d+: Proc$/i.test(section.title)), false);
  assert.equal(
    (seatBeltSection.bullets ?? []).some((bullet) => /Pre-Paint Test Fit/i.test(bullet)),
    false
  );
  assert.equal(
    (roadTestSection.bullets ?? []).some((bullet) => /Pre-Paint Test Fit/i.test(bullet)),
    false
  );
  assert.equal(
    (cavityWaxSection.bullets ?? []).some((bullet) => /Pre-Paint Test Fit/i.test(bullet)),
    false
  );
  assert.equal(
    (cavityWaxSection.bullets ?? []).some((bullet) => /Support status: Supported/i.test(bullet)),
    true
  );
});

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
  normalizeWorkspaceEstimateComparisons,
  buildWorkspaceEstimateComparisonSummary,
} = require("./estimateComparisons.ts");
const { buildWorkspaceDataFromReport } = require("./buildWorkspaceData.ts");

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeCanonicalRows() {
  return [
    {
      id: "row-1",
      category: "Labor",
      operation: "Body labor hours",
      lhsSource: "Shop estimate",
      rhsSource: "Carrier estimate",
      lhsValue: 12.5,
      rhsValue: 10,
      delta: 2.5,
      deltaType: "changed",
      confidence: 0.95,
      notes: ["Carrier labor reads lighter."],
    },
    {
      id: "row-2",
      category: "Operations",
      operation: "Pre-repair scan",
      lhsSource: "Shop estimate",
      rhsSource: "Carrier estimate",
      lhsValue: "Proc Pre-repair scan",
      rhsValue: null,
      delta: "Present only in shop estimate",
      deltaType: "added",
      confidence: 0.82,
      notes: [],
    },
  ];
}

function makeComparisonReport(overrides = {}) {
  return {
    summary: {
      riskScore: "moderate",
      confidence: "high",
      criticalIssues: 1,
      evidenceQuality: "strong",
    },
    vehicle: undefined,
    issues: [
      {
        id: "issue-1",
        category: "documentation",
        title: "Carrier estimate narrows repair scope",
        finding: "Carrier estimate narrows repair scope",
        impact: "Panels visible in the shop estimate are not clearly carried over.",
        severity: "high",
        evidenceIds: [],
      },
    ],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [],
    supplementOpportunities: ["Add and document pre-repair scan."],
    evidence: [],
    recommendedActions: ["Use the structured comparison rows for Workspace rendering."],
    analysis: {
      mode: "comparison",
      parserStatus: "ok",
      summary: {
        riskScore: "moderate",
        confidence: "high",
        criticalIssues: 1,
        evidenceQuality: "strong",
      },
      findings: [],
      supplements: [],
      evidence: [],
      operations: [],
      estimateComparisons: {
        rows: makeCanonicalRows(),
        summary: {
          totalRows: 999,
          changedRows: 999,
          addedRows: 999,
          removedRows: 999,
          sameRows: 999,
        },
      },
      narrative: "Structured comparison narrative.",
    },
    ...overrides,
  };
}

run("canonical structured comparison object normalizes and recomputes summary from rows", () => {
  const normalized = normalizeWorkspaceEstimateComparisons({
    rows: makeCanonicalRows(),
    summary: {
      totalRows: 999,
      changedRows: 999,
      addedRows: 999,
      removedRows: 999,
      sameRows: 999,
    },
  });

  assert.equal(normalized.rows.length, 2);
  assert.equal(normalized.rows[0].id, "row-1");
  assert.equal(normalized.summary.totalRows, 2);
  assert.equal(normalized.summary.changedRows, 1);
  assert.equal(normalized.summary.addedRows, 1);
});

run("raw row array input normalizes into structured rows and summary", () => {
  const normalized = normalizeWorkspaceEstimateComparisons([
    {
      id: "array-1",
      category: "Refinish",
      lhsValue: "Mask jambs",
      rhsValue: "",
    },
  ]);

  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.rows[0].lhsSource, "Shop estimate");
  assert.equal(normalized.rows[0].rhsSource, "Carrier estimate");
  assert.equal(normalized.rows[0].deltaType, "added");
  assert.equal(normalized.summary.totalRows, 1);
  assert.equal(normalized.summary.addedRows, 1);
});

run("legacy shop and insurance rows normalize correctly", () => {
  const normalized = normalizeWorkspaceEstimateComparisons([
    {
      id: "legacy-1",
      category: "ADAS",
      shop: "Pre-repair scan included",
      insurance: "Not shown",
    },
  ]);

  assert.equal(normalized.rows[0].lhsValue, "Pre-repair scan included");
  assert.equal(normalized.rows[0].rhsValue, "Not shown");
  assert.equal(normalized.rows[0].deltaType, "changed");
});

run("empty or missing comparison input returns a safe empty structured result", () => {
  const fromNull = normalizeWorkspaceEstimateComparisons(null);
  const fromUndefined = normalizeWorkspaceEstimateComparisons(undefined);
  const fromGarbage = normalizeWorkspaceEstimateComparisons({ nope: true });

  assert.deepEqual(fromNull.rows, []);
  assert.deepEqual(fromUndefined.rows, []);
  assert.deepEqual(fromGarbage.rows, []);
  assert.equal(fromNull.summary.totalRows, 0);
  assert.equal(fromUndefined.summary.totalRows, 0);
  assert.equal(fromGarbage.summary.totalRows, 0);
});

run("summary counts are derived consistently from row delta types", () => {
  const summary = buildWorkspaceEstimateComparisonSummary([
    { id: "a", deltaType: "changed" },
    { id: "b", deltaType: "added" },
    { id: "c", deltaType: "removed" },
    { id: "d", deltaType: "same" },
    { id: "e", deltaType: "unknown" },
  ]);

  assert.equal(summary.totalRows, 5);
  assert.equal(summary.changedRows, 1);
  assert.equal(summary.addedRows, 1);
  assert.equal(summary.removedRows, 1);
  assert.equal(summary.sameRows, 1);
});

run("structured rows are preferred when a comparison object also carries legacy-compatible fields", () => {
  const normalized = normalizeWorkspaceEstimateComparisons({
    rows: [
      {
        id: "preferred-row",
        category: "Labor",
        lhsValue: "Structured left",
        rhsValue: "Structured right",
      },
    ],
    shop: "Legacy left should be ignored",
    insurance: "Legacy right should be ignored",
  });

  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.rows[0].id, "preferred-row");
  assert.equal(normalized.rows[0].lhsValue, "Structured left");
  assert.equal(normalized.rows[0].rhsValue, "Structured right");
});

run("workspace data assembly preserves structured comparison rows from comparison-mode analysis", () => {
  const workspaceData = buildWorkspaceDataFromReport(makeComparisonReport());

  assert.equal(workspaceData.estimateComparisons.rows.length, 2);
  assert.equal(workspaceData.estimateComparisons.rows[0].id, "row-1");
  assert.equal(workspaceData.estimateComparisons.summary.totalRows, 2);
  assert.match(workspaceData.fullAnalysis, /Structured comparison narrative/);
});

run("workspace data assembly does not fall back to legacy-compatible comparison fields when structured rows are present", () => {
  const report = makeComparisonReport({
    analysis: {
      mode: "comparison",
      parserStatus: "ok",
      summary: {
        riskScore: "moderate",
        confidence: "high",
        criticalIssues: 1,
        evidenceQuality: "strong",
      },
      findings: [],
      supplements: [],
      evidence: [],
      operations: [],
      estimateComparisons: {
        rows: [
          {
            id: "structured-only",
            category: "Operations",
            lhsValue: "Structured shop line",
            rhsValue: "Structured carrier line",
          },
        ],
        summary: {
          totalRows: 1,
          changedRows: 1,
          addedRows: 0,
          removedRows: 0,
          sameRows: 0,
        },
        shop: "legacy-shop",
        insurance: "legacy-insurance",
      },
      narrative: "Structured comparison narrative.",
    },
  });

  const workspaceData = buildWorkspaceDataFromReport(report);

  assert.equal(workspaceData.estimateComparisons.rows.length, 1);
  assert.equal(workspaceData.estimateComparisons.rows[0].id, "structured-only");
  assert.equal(workspaceData.estimateComparisons.rows[0].lhsValue, "Structured shop line");
});

/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
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

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(__dirname, "..", "..", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const {
  buildActiveContext,
  resolveComparisonVehicleIdentity,
} = require("./orchestrator/vehicleIdentityContext.ts");
const { normalizeReportToAnalysisResult } = require("./builders/normalizeReportToAnalysisResult.ts");
const { buildExportModel } = require("./builders/buildExportModel.ts");
const { decodeVinVehicleIdentity } = require("./vehicleContext.ts");

const TEST_VIN = "1GKKNRLS7MZ123456";
const INVALID_VIN_LIKE = "18380E2A270822500";

const BASE_REPORT = {
  summary: {
    riskScore: "moderate",
    confidence: "moderate",
    criticalIssues: 0,
    evidenceQuality: "moderate",
  },
  vehicle: undefined,
  issues: [],
  requiredProcedures: [],
  presentProcedures: [],
  missingProcedures: [],
  supplementOpportunities: [],
  evidence: [],
  recommendedActions: [],
  analysis: undefined,
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

run("compare-mode preserves vehicle identity and VIN across merged evidence", () => {
  const decoded = decodeVinVehicleIdentity(TEST_VIN);
  const merged = resolveComparisonVehicleIdentity(
    {
      make: "GMC",
      source: "session",
      confidence: 0.6,
    },
    {
      vin: TEST_VIN,
      source: "attachment",
      confidence: 0.96,
    },
    {
      year: 2021,
      make: "GMC",
      model: "Acadia",
      source: "attachment",
      confidence: 0.82,
    },
    {
      ...decoded,
      model: "Acadia",
      trim: "SLT AWD",
      source: "vin_decoded",
      confidence: 0.94,
    }
  );

  assert.equal(merged?.vin, TEST_VIN);
  assert.equal(merged?.year, 2021);
  assert.equal(merged?.make, "GMC");
  assert.equal(merged?.model, "Acadia");
  assert.equal(merged?.trim, "SLT AWD");
});

run("invalid VIN-like strings are rejected in export fallback", () => {
  const exportModel = buildExportModel({
    report: {
      ...BASE_REPORT,
      evidence: [
        {
          id: "ocr-1",
          title: "OCR",
          snippet: `Possible VIN: ${INVALID_VIN_LIKE}`,
          source: "ocr",
          authority: "inferred",
        },
      ],
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.ok(!exportModel.vehicle.vin);
  assert.notEqual(exportModel.vehicle.label, INVALID_VIN_LIKE);
});

run("normalization does not use recommendedActions to steer vehicle identity", () => {
  const normalized = normalizeReportToAnalysisResult({
    ...BASE_REPORT,
    recommendedActions: [
      "Review the 2019 Ford F-150 repair path before supplement submission.",
    ],
  });

  assert.equal(normalized.vehicle, undefined);
});

run("retrieval context includes inferred vehicle identity when available", () => {
  const context = buildActiveContext(null, {
    vin: TEST_VIN,
    year: 2021,
    make: "GMC",
    model: "Acadia",
    source: "attachment",
    confidence: 0.91,
  });

  assert.ok(context);
  assert.deepEqual(context?.vehicle, {
    year: 2021,
    make: "GMC",
    model: "Acadia",
    vin: TEST_VIN,
    confidence: 0.91,
    source: "explicit",
    updatedAt: context.vehicle.updatedAt,
  });
});

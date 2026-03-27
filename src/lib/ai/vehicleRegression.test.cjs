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
  buildVehicleLabel,
  decodeVinVehicleIdentity,
  isBetterVinCandidate,
  isBetterVehicleCandidate,
  mergeVehicleIdentity,
} = require("./vehicleContext.ts");
const { buildCarrierReport } = require("./builders/carrierPdfBuilder.ts");

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

const TEST_VIN = "1GKKNRLS7MZ123456";

function findSummaryValue(document, label) {
  return document.summary.find((item) => item.label === label)?.value;
}

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("decoded VIN vehicle survives later null or placeholder merges", () => {
  const decoded = decodeVinVehicleIdentity(TEST_VIN);
  const merged = mergeVehicleIdentity(decoded, {
    make: "Unspecified",
    model: "",
    trim: "Not clearly supported in the current material.",
    source: "attachment",
    confidence: 0.99,
  });

  assert.equal(merged?.vin, TEST_VIN);
  assert.equal(merged?.make, "GMC");
  assert.equal(merged?.year, 2021);
  assert.equal(
    isBetterVehicleCandidate(
      decoded,
      {
        year: 2021,
        source: "attachment",
        confidence: 0.99,
      }
    ),
    true
  );
});

run("valid VIN is preserved when a later OCR candidate is worse", () => {
  assert.equal(isBetterVinCandidate("18380E2A270822500", TEST_VIN), false);

  const merged = mergeVehicleIdentity(
    {
      vin: TEST_VIN,
      year: 2021,
      make: "GMC",
      model: "Acadia",
      source: "attachment",
      confidence: 0.92,
    },
    {
      vin: "18380E2A270822500",
      source: "attachment",
      confidence: 0.99,
    }
  );

  assert.equal(merged?.vin, TEST_VIN);
});

run("invalid OCR VIN does not replace a validated VIN in export output", () => {
  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      vehicle: {
        vin: TEST_VIN,
        year: 2021,
        make: "GMC",
        model: "Acadia",
        source: "attachment",
        confidence: 0.92,
      },
      evidence: [
        {
          id: "ocr-1",
          title: "OCR text",
          snippet: "VIN: 18380E2A270822500",
          source: "ocr",
          authority: "inferred",
        },
      ],
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(findSummaryValue(document, "VIN"), TEST_VIN);
  assert.equal(findSummaryValue(document, "Vehicle"), "2021 GMC Acadia");
});

run("VIN present with decoded vehicle data populates report vehicle", () => {
  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      vehicle: {
        vin: TEST_VIN,
        source: "attachment",
        confidence: 0.94,
      },
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(findSummaryValue(document, "VIN"), TEST_VIN);
  assert.equal(findSummaryValue(document, "Vehicle"), "2021 GMC");
});

run("decoded and structured vehicle stay intact in export rendering with partial later data", () => {
  const decoded = decodeVinVehicleIdentity(TEST_VIN);
  const vehicle = mergeVehicleIdentity(decoded, {
    model: "Acadia",
    trim: "AT4 AWD",
    source: "attachment",
    confidence: 0.88,
  });

  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      vehicle,
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(findSummaryValue(document, "Vehicle"), "2021 GMC Acadia AT4 AWD");
  assert.equal(findSummaryValue(document, "VIN"), TEST_VIN);
});

run("VIN present with structured fields uses assembled vehicle string in report", () => {
  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      vehicle: {
        vin: TEST_VIN,
        year: 2021,
        make: "GMC",
        model: "Acadia",
        trim: "AT4 AWD",
        source: "attachment",
        confidence: 0.92,
      },
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(findSummaryValue(document, "VIN"), TEST_VIN);
  assert.equal(findSummaryValue(document, "Vehicle"), "2021 GMC Acadia AT4 AWD");
});

run("raw malformed vehicle labels do not replace valid structured year make model", () => {
  const merged = mergeVehicleIdentity(
    {
      year: 2021,
      make: "GMC",
      model: "Acadia",
      trim: "AT4 AWD",
      source: "attachment",
      confidence: 0.86,
    },
    {
      year: 2021,
      make: "GMC",
      model: "Acadia AWD 4D UTV",
      trim: "AT4 AWD 4D UTV",
      source: "attachment",
      confidence: 0.95,
    }
  );

  assert.equal(merged?.model, "Acadia");
  assert.equal(merged?.trim, "AT4 AWD");
});

run("true no-data export still falls back to Unspecified", () => {
  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(findSummaryValue(document, "Vehicle"), "Unspecified");
  assert.equal(
    findSummaryValue(document, "VIN"),
    "Not clearly supported in the current material."
  );
});

run("year-only vehicle data is upgraded by VIN support instead of rendering as year-only", () => {
  assert.equal(
    buildVehicleLabel({
      year: 2025,
      vin: TEST_VIN,
      source: "vin_decoded",
      confidence: 0.94,
    }),
    ""
  );

  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      vehicle: {
        year: 2025,
        vin: TEST_VIN,
        source: "vin_decoded",
        confidence: 0.94,
      },
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(findSummaryValue(document, "Vehicle"), "2021 GMC");
  assert.equal(findSummaryValue(document, "VIN"), TEST_VIN);
});

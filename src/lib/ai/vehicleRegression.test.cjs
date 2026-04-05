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
  extractVehicleIdentityFromText,
  isBetterVinCandidate,
  isBetterVehicleCandidate,
  mergeVehicleIdentity,
} = require("./vehicleContext.ts");
const { buildCarrierReport } = require("./builders/carrierPdfBuilder.ts");
const { buildRebuttalEmailPdf } = require("./builders/rebuttalEmailPdfBuilder.ts");
const {
  buildRebuttalEmailTemplate,
  formatAnalysisModeLabel,
} = require("./builders/exportTemplates.ts");
const { buildPreferredVehicleIdentityLabel } = require("./builders/buildExportModel.ts");

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

run("VIN-only decoded vehicle falls back to VIN tail when model is unavailable", () => {
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
  assert.equal(findSummaryValue(document, "Vehicle"), "VIN ending 123456");
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
    "Unspecified"
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

  assert.equal(findSummaryValue(document, "Vehicle"), "VIN ending 123456");
  assert.equal(findSummaryValue(document, "VIN"), TEST_VIN);
});

run("partial decoded year-make identity falls back to VIN tail before render", () => {
  assert.equal(
    buildPreferredVehicleIdentityLabel({
      year: 2021,
      make: "GMC",
      vin: TEST_VIN,
      confidence: "partial",
    }),
    "VIN ending 123456"
  );
});

run("estimate header parsing normalizes safe make abbreviations", () => {
  const vehicle = extractVehicleIdentityFromText(
    [
      "2019 JAGU E-PACE P250 S AWD",
      "VIN: SADFJ2FX7K1Z36402",
    ].join("\n"),
    "attachment"
  );

  assert.equal(vehicle?.year, 2019);
  assert.equal(vehicle?.make, "Jaguar");
  assert.equal(vehicle?.model, "E-PACE P250");
  assert.equal(vehicle?.trim, "S AWD");
});

run("parsed estimate header identity reaches final export vehicle label", () => {
  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      evidence: [
        {
          id: "shop-header",
          title: "Estimate header",
          snippet: "2019 JAGU E-PACE P250 S AWD\nVIN: SADFJ2FX7K1Z36402",
          source: "estimate",
          authority: "inferred",
        },
      ],
    },
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(findSummaryValue(document, "Vehicle"), "2019 Jaguar E-Pace P250 S AWD");
  assert.equal(findSummaryValue(document, "VIN"), "SADFJ2FX7K1Z36402");
});

run("executive and opening prose drop appended numbered findings blocks", () => {
  const contaminatedNarrative = [
    "The carrier estimate remains underwritten relative to the documented repair path.",
    "",
    "1. Pre-repair scan is not clearly documented.",
    "2. Post-repair calibration support remains missing.",
  ].join("\n");

  const carrierDocument = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      vehicle: {
        year: 2021,
        make: "GMC",
        model: "Acadia",
        source: "attachment",
        confidence: 0.92,
      },
    },
    analysis: {
      mode: "single-document-review",
      parserStatus: "ok",
      summary: BASE_REPORT.summary,
      findings: [],
      supplements: [],
      evidence: [],
      operations: [],
      narrative: contaminatedNarrative,
      vehicle: undefined,
    },
    panel: null,
    assistantAnalysis: contaminatedNarrative,
  });
  const rebuttalDocument = buildRebuttalEmailPdf({
    report: {
      ...BASE_REPORT,
      vehicle: {
        year: 2021,
        make: "GMC",
        model: "Acadia",
        source: "attachment",
        confidence: 0.92,
      },
    },
    analysis: {
      mode: "single-document-review",
      parserStatus: "ok",
      summary: BASE_REPORT.summary,
      findings: [],
      supplements: [],
      evidence: [],
      operations: [],
      narrative: contaminatedNarrative,
      vehicle: undefined,
    },
    panel: null,
    assistantAnalysis: contaminatedNarrative,
  });

  const executiveBody = carrierDocument.sections.find(
    (section) => section.title === "Executive Repair Position"
  )?.body;
  const openingBody = rebuttalDocument.sections.find(
    (section) => section.title === "Opening Position"
  )?.body;

  assert.ok(executiveBody);
  assert.ok(openingBody);
  assert.equal(executiveBody.includes("1. Pre-repair scan"), false);
  assert.equal(executiveBody.includes("2. Post-repair calibration support remains missing."), false);
  assert.equal(openingBody.includes("1. Pre-repair scan"), false);
  assert.equal(openingBody.includes("2. Post-repair calibration support remains missing."), false);
  assert.match(openingBody, /^After reviewing the current file, our position is that .+\.$/);
});

run("rebuttal subject prefers full vehicle identity and falls back to VIN tail", () => {
  const withIdentity = buildRebuttalEmailPdf({
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
  const withVinOnly = buildRebuttalEmailTemplate({
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

  assert.equal(
    withIdentity.sections.find((section) => section.title === "Recommended Subject")?.body,
    "Request for estimate revision - 2021 GMC Acadia AT4 AWD"
  );
  assert.match(withVinOnly, /Subject: Request for estimate revision - VIN ending 123456/);
});

run("vehicle label falls back to VIN tail before rendering year-only", () => {
  assert.equal(
    buildPreferredVehicleIdentityLabel({
      year: 2019,
      vin: "SADFJ2FX7K1Z36402",
      confidence: "partial",
    }),
    "VIN ending Z36402"
  );
});

run("side-by-side mode label is product-friendly outside compare mode", () => {
  assert.equal(formatAnalysisModeLabel("comparison"), "Comparison Review");
  assert.equal(formatAnalysisModeLabel("single-document-review"), "Single Estimate Review");
  assert.equal(formatAnalysisModeLabel("parser-incomplete"), "Estimate Review");
});

run("clean presentation prose removes empty pushback stub", () => {
  const document = buildCarrierReport({
    report: {
      ...BASE_REPORT,
      vehicle: {
        year: 2021,
        make: "GMC",
        model: "Acadia",
        source: "attachment",
        confidence: 0.92,
      },
    },
    analysis: {
      mode: "single-document-review",
      parserStatus: "ok",
      summary: BASE_REPORT.summary,
      findings: [],
      supplements: [],
      evidence: [],
      operations: [],
      narrative:
        "The carrier estimate remains underwritten. Areas that look aggressive or likely to get pushback:.",
      vehicle: undefined,
    },
    panel: null,
    assistantAnalysis:
      "The carrier estimate remains underwritten. Areas that look aggressive or likely to get pushback:.",
  });

  const executiveBody = document.sections.find(
    (section) => section.title === "Executive Repair Position"
  )?.body;

  assert.ok(executiveBody);
  assert.equal(
    executiveBody.includes("Areas that look aggressive or likely to get pushback:."),
    false
  );
});

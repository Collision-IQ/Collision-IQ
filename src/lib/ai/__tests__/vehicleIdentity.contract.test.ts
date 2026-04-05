import assert from "node:assert/strict";

import fixture from "./fixtures/vehicleIdentityFixture.json";
import teslaCccNoteRegressionFixture from "./fixtures/teslaCccNoteRegressionFixture.json";
import vinFooterTimestampRegressionFixture from "./fixtures/vinFooterTimestampRegressionFixture.json";
import vinHeaderNoiseFixture from "./fixtures/vinHeaderNoiseFixture.json";
import vehicleNoVinFallbackFixture from "./fixtures/vehicleNoVinFallbackFixture.json";
import { buildExportModel } from "../builders/buildExportModel";
import { buildCarrierReport } from "../builders/carrierPdfBuilder";
import { inferDriveVehicleContext } from "../contracts/driveRetrievalContract";
import { normalizeReportToAnalysisResult } from "../builders/normalizeReportToAnalysisResult";
import {
  extractVehicleIdentityFromText,
  isBetterVehicleCandidate,
  isBetterVinCandidate,
  normalizeVin,
  resolveVehicleIdentity,
  validateVinChecksum,
} from "../vehicleContext";
import type { RepairIntelligenceReport, VehicleIdentity } from "../types/analysis";

const structuredFixtureVehicle = fixture.structuredVehicle as VehicleIdentity;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.info(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assertIncludesAll(actual: string[] | undefined, expected: string[]) {
  for (const value of expected) {
    assert.equal(actual?.includes(value), true, `Expected sourceSummary to include ${value}`);
  }
}

function makeReport(overrides?: Partial<RepairIntelligenceReport>): RepairIntelligenceReport {
  return {
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
    ...overrides,
  };
}

runTest("valid VIN survives later noisy OCR candidates", () => {
  const validated: VehicleIdentity = {
    ...structuredFixtureVehicle,
    fieldSources: {
      vin: "vin_decoded",
      year: "attachment",
      make: "attachment",
      model: "attachment",
    },
  };
  const noisyOcr: VehicleIdentity = {
    vin: "3MW89FF07R8E75553",
    source: "attachment",
    confidence: 0.99,
  };

  assert.equal(normalizeVin(fixture.vin), fixture.vin);
  assert.equal(validateVinChecksum(fixture.vin), true);
  assert.equal(validateVinChecksum(noisyOcr.vin!), false);
  assert.equal(isBetterVinCandidate(noisyOcr, validated), false);

  const resolved = resolveVehicleIdentity(validated, noisyOcr);
  assert.equal(resolved.vin, fixture.vin);
  assertIncludesAll(resolved.sourceSummary, ["vin_backed_decode"]);
});

runTest("labeled VIN outranks nearby 17-char header identifiers", () => {
  const extracted = extractVehicleIdentityFromText(vinHeaderNoiseFixture.text, "attachment");

  assert.equal(extracted?.vin, vinHeaderNoiseFixture.vin);
  assert.equal(extracted?.year, 2024);
  assert.equal(extracted?.make, "BMW");
});

runTest("footer timestamp furniture cannot become canonical VIN", () => {
  const extracted = extractVehicleIdentityFromText(
    vinFooterTimestampRegressionFixture.text,
    "attachment"
  );

  assert.equal(normalizeVin(vinFooterTimestampRegressionFixture.falseVin), undefined);
  assert.equal(extracted?.vin, vinFooterTimestampRegressionFixture.vin);
});

runTest("explicit labeled VIN beats synthetic PANEL mashup", () => {
  const bmwCaseText = [
    "Vehicle Description: 2024 BMW X5 xDrive40i Sports Activity Vehicle",
    "VIN: WB523CF05RCN81298",
    "PANEL517179320720",
    "Part Number 517179320720",
    "Qty 0.2 Labor 1.0 Paint 0.5",
  ].join("\n");
  const extracted = extractVehicleIdentityFromText(bmwCaseText, "attachment");
  const report = makeReport({
    vehicle: extracted ?? undefined,
    evidence: [
      {
        id: "bmw-vin-evidence-1",
        title: "Estimate Page 1",
        snippet: bmwCaseText,
        source: "estimate-page-1.pdf",
        authority: "inferred",
      },
    ],
  });
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(extracted?.vin, "WB523CF05RCN81298");
  assert.equal(extracted?.year, 2024);
  assert.equal(extracted?.make, "BMW");
  assert.equal(exportModel.vehicle.vin, "WB523CF05RCN81298");
  assert.notEqual(exportModel.vehicle.vin, "PANEL517179320720");
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "WB523CF05RCN81298");
});

runTest("fake PANEL517179320720 is rejected", () => {
  assert.equal(normalizeVin("PANEL517179320720"), undefined);

  const extracted = extractVehicleIdentityFromText(
    [
      "Part Number PANEL517179320720",
      "Panel 517179320720",
      "Qty 0.2 Labor 1.0 Paint 0.5",
    ].join("\n"),
    "attachment"
  );

  assert.equal(extracted?.vin, undefined);
});

runTest("if only noisy OCR-shaped candidate exists VIN resolves to null", () => {
  const extracted = extractVehicleIdentityFromText(
    [
      "Vehicle Description: 2022 BMW X7 xDrive40i Sports Activity Vehicle",
      "PANEL517179320720",
      "Part Number 517179320720",
      "Qty 0.2 Labor 1.0 Paint 0.5",
    ].join("\n"),
    "attachment"
  );

  assert.equal(extracted?.vin, undefined);
  assert.equal(extracted?.make, "BMW");
  assert.equal(extracted?.model, "X7 xDrive40i");
});

runTest("blacklisted header labels cannot become VIN candidates", () => {
  const headerOnly = extractVehicleIdentityFromText(
    [
      "Workfile ID: WRKF1LE1D12345678",
      "Federal ID: FEDRL12345678901",
      "Claim #: CLM123456789ABCDE",
      "RO #: RR123456789ABCDEF",
    ].join("\n"),
    "attachment"
  );

  assert.equal(headerOnly?.vin, undefined);
});

runTest("invalid OCR VIN cannot replace a validated VIN", () => {
  const current: VehicleIdentity = {
    vin: fixture.vin,
    year: 2024,
    make: "BMW",
    source: "vin_decoded",
    confidence: 0.98,
    fieldSources: {
      vin: "vin_decoded",
      year: "vin_decoded",
      make: "vin_decoded",
    },
  };
  const invalidOcr: VehicleIdentity = {
    vin: "VIN UNSPECIFIED",
    source: "attachment",
    confidence: 1,
  };

  assert.equal(normalizeVin(invalidOcr.vin), undefined);
  assert.equal(isBetterVinCandidate(invalidOcr, current), false);
  assert.equal(resolveVehicleIdentity(current, invalidOcr).vin, fixture.vin);
});

runTest("structured year/make/model beats raw vehicle text", () => {
  const structured: VehicleIdentity = {
    year: 2024,
    make: "BMW",
    model: "330i",
    source: "attachment",
    confidence: 0.92,
  };
  const rawTextLike: VehicleIdentity = {
    make: "Vehicle Description Unspecified",
    model: "OCR Label",
    source: "attachment",
    confidence: 0.95,
  };

  assert.equal(isBetterVehicleCandidate(structured, rawTextLike), true);
  assert.equal(resolveVehicleIdentity(rawTextLike, structured).display, fixture.expectedDisplay);
});

runTest("explicit header beats later CCC closest-like-kind-quality note", () => {
  const extracted = extractVehicleIdentityFromText(
    teslaCccNoteRegressionFixture.combinedText,
    "attachment"
  );

  assert.equal(extracted?.vin, teslaCccNoteRegressionFixture.vin);
  assert.equal(extracted?.year, 2025);
  assert.equal(extracted?.make, "Tesla");
  assert.equal(extracted?.model, "Model 3");
  assert.equal(extracted?.trim, teslaCccNoteRegressionFixture.expectedTrim);
  assert.equal(extracted?.sourceQuality, "explicit_header");
});

runTest("final resolved vehicle stays on explicit Tesla header across export and PDF", () => {
  const headerVehicle = extractVehicleIdentityFromText(
    teslaCccNoteRegressionFixture.headerText,
    "attachment"
  );
  const noteVehicle = extractVehicleIdentityFromText(
    teslaCccNoteRegressionFixture.noteText,
    "attachment"
  );
  const report = makeReport({
    vehicle: resolveVehicleIdentity(headerVehicle, noteVehicle).identity,
    evidence: [
      {
        id: "tesla-evidence-1",
        title: "Estimate Page 1",
        snippet: teslaCccNoteRegressionFixture.combinedText,
        source: "estimate-page-1.pdf",
        authority: "inferred",
      },
    ],
  });
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const chatVehicle = inferDriveVehicleContext({
    estimateText: teslaCccNoteRegressionFixture.combinedText,
    analysisVehicle: {
      ...(headerVehicle as VehicleIdentity),
      source: "attachment",
      confidence: headerVehicle?.confidence ?? 0.98,
    },
    userQuery: `Review this 2025 Tesla Model 3 Standard RWD. VIN: ${teslaCccNoteRegressionFixture.vin}`,
  });

  assert.equal(exportModel.vehicle.vin, teslaCccNoteRegressionFixture.vin);
  assert.equal(exportModel.vehicle.display, teslaCccNoteRegressionFixture.expectedDisplay);
  assert.equal(exportModel.vehicle.vehicleDisplay, teslaCccNoteRegressionFixture.expectedDisplay);
  assert.equal(exportModel.vehicle.trim, teslaCccNoteRegressionFixture.expectedTrim);
  assertIncludesAll(exportModel.vehicle.sourceSummary, ["explicit_vehicle_block", "vin_backed_decode"]);
  assert.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, teslaCccNoteRegressionFixture.expectedDisplay);
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, teslaCccNoteRegressionFixture.vin);
  assert.equal(chatVehicle.year, 2025);
  assert.equal(chatVehicle.model, "Model 3");
  assert.equal(chatVehicle.trim, teslaCccNoteRegressionFixture.expectedTrim);
});

runTest("decoded vehicle survives export builder and report render path", () => {
  const report = makeReport({
    vehicle: structuredFixtureVehicle,
    evidence: [
      {
        id: "evidence-1",
        title: "Estimate OCR",
        snippet: fixture.estimateText,
        source: "estimate.pdf",
        authority: "inferred",
      },
    ],
    recommendedActions: ["Repair plan remains supportable."],
  });
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: "Vehicle identity confirmed from estimate support.",
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: "Vehicle identity confirmed from estimate support.",
  });

  assert.equal(exportModel.vehicle.display, fixture.expectedDisplay);
  assert.equal(exportModel.vehicle.vehicleDisplay, fixture.expectedDisplay);
  assert.equal(exportModel.vehicle.vin, fixture.vin);
  assert.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, fixture.expectedDisplay);
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, fixture.vin);
});

runTest("footer false VIN never propagates into export or PDF", () => {
  const extracted = extractVehicleIdentityFromText(
    vinFooterTimestampRegressionFixture.text,
    "attachment"
  );
  const report = makeReport({
    vehicle: extracted ?? undefined,
    evidence: [
      {
        id: "footer-vin-evidence-1",
        title: "Estimate Page 1",
        snippet: vinFooterTimestampRegressionFixture.text,
        source: "estimate-page-1.pdf",
        authority: "inferred",
      },
    ],
  });
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const chatVehicle = inferDriveVehicleContext({
    estimateText: vinFooterTimestampRegressionFixture.text,
    userQuery: `VIN: ${vinFooterTimestampRegressionFixture.vin}`,
    analysisVehicle: extracted
      ? {
          ...extracted,
          source: "attachment",
          confidence: extracted.confidence ?? 0.98,
        }
      : null,
  });

  assert.equal(exportModel.vehicle.vin, vinFooterTimestampRegressionFixture.vin);
  assert.notEqual(exportModel.vehicle.vin, vinFooterTimestampRegressionFixture.falseVin);
  assertIncludesAll(exportModel.vehicle.sourceSummary, ["vin_backed_decode"]);
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, vinFooterTimestampRegressionFixture.vin);
  assert.equal(chatVehicle.vin, vinFooterTimestampRegressionFixture.vin);
});

runTest("chat, right rail, and export stay aligned on the same resolved identity", () => {
  const report = makeReport({
    vehicle: structuredFixtureVehicle,
    evidence: [
      {
        id: "evidence-1",
        title: "Estimate OCR",
        snippet: fixture.estimateText,
        source: "estimate.pdf",
        authority: "inferred",
      },
    ],
  });
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const chatVehicle = inferDriveVehicleContext({
    estimateText: fixture.estimateText,
    userQuery: `Need help on this ${fixture.expectedDisplay}. VIN: ${fixture.vin}`,
    analysisVehicle: {
      ...structuredFixtureVehicle,
      source: "attachment",
      confidence: structuredFixtureVehicle.confidence ?? 0.98,
    },
  });

  assert.equal(exportModel.vehicle.display, fixture.expectedDisplay);
  assert.equal(exportModel.vehicle.label, fixture.expectedDisplay);
  assert.equal(chatVehicle.vin, exportModel.vehicle.vin);
  assert.equal(chatVehicle.year, exportModel.vehicle.year);
  assert.equal(chatVehicle.make, exportModel.vehicle.make);
  assert.equal(chatVehicle.model, exportModel.vehicle.model);
});

runTest("export and PDF preserve canonical structured vehicle against noisy evidence text", () => {
  const canonicalVehicle: VehicleIdentity = {
    vin: fixture.vin,
    year: 2024,
    make: "BMW",
    model: "330i",
    source: "attachment",
    confidence: 0.98,
    fieldSources: {
      vin: "attachment",
      year: "attachment",
      make: "attachment",
      model: "attachment",
    },
  };
  const noisyEvidence = [
    "Workfile ID: WRKF1LE1D12345678",
    "Federal ID: FEDRL12345678901",
    "3/24/2026 5:38:57 PM 300060 Page 1",
    "Vehicle: Unspecified",
  ].join("\n");
  const report = makeReport({
    vehicle: canonicalVehicle,
    evidence: [
      {
        id: "canonical-noisy-evidence-1",
        title: "Estimate OCR",
        snippet: noisyEvidence,
        source: "estimate.pdf",
        authority: "inferred",
      },
    ],
  });
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(exportModel.vehicle.display, fixture.expectedDisplay);
  assert.notEqual(exportModel.vehicle.display, "Unspecified");
  assert.equal(exportModel.vehicle.vin, fixture.vin);
  assert.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, fixture.expectedDisplay);
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, fixture.vin);
});

runTest("report export locks structured estimate VIN even when OCR fallback is weak", () => {
  const report = makeReport({
    vehicle: {
      year: 2024,
      make: "BMW",
      model: "iX xDrive",
      trim: "50 Sports Activity",
      vin: "WB523CF05RCN81298",
      source: "attachment",
      confidence: 0.88,
    },
    evidence: [
      {
        id: "weak-ocr-1",
        title: "Estimate OCR",
        snippet: [
          "2024 BMW iX xDrive 50 Sports Activity Vehicle",
          "Page 6",
          "Claim #: 38-97K9-17T01",
          "Workfile ID: 70074ad2",
          "policy text / estimate footer / page furniture",
        ].join("\n"),
        source: "estimate.pdf",
        authority: "inferred",
      },
    ],
  });

  const analysis = normalizeReportToAnalysisResult(report);

  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(analysis.vehicle?.vin, "WB523CF05RCN81298");
  assert.equal(analysis.vehicle?.trim, "50 Sports Activity");
  assert.equal(exportModel.vehicle.vin, "WB523CF05RCN81298");
  assert.equal(exportModel.vehicle.display, "2024 BMW iX xDrive");
  assert.equal(exportModel.vehicle.trim, "50 Sports Activity");
  assert.equal(exportModel.vehicle.confidence, "supported");
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "WB523CF05RCN81298");
});

runTest("live-path handoff keeps analysis VIN when report vehicle lags behind", () => {
  const report = makeReport({
    vehicle: {
      year: 2024,
      make: "BMW",
      model: "iX xDrive",
      trim: "50 Sports Activity",
      source: "attachment",
      confidence: 0.88,
    },
    analysis: {
      mode: "single-document-review",
      parserStatus: "ok",
      summary: {
        riskScore: "moderate",
        confidence: "moderate",
        criticalIssues: 0,
        evidenceQuality: "moderate",
      },
      findings: [],
      supplements: [],
      evidence: [],
      operations: [],
      narrative: "Vehicle identity already supported from estimate.",
      vehicle: {
        year: 2024,
        make: "BMW",
        model: "iX xDrive",
        trim: "50 Sports Activity",
        vin: "WB523CF05RCN81298",
        source: "attachment",
        confidence: 0.88,
        fieldSources: {
          year: "attachment",
          make: "attachment",
          model: "attachment",
          trim: "attachment",
          vin: "attachment",
        },
      },
    },
    evidence: [
      {
        id: "live-path-vin-1",
        title: "Estimate OCR",
        snippet: [
          "2024 BMW iX xDrive 50 Sports Activity Vehicle",
          "Page 6",
          "Claim #: 38-97K9-17T01",
          "Workfile ID: 70074ad2",
        ].join("\n"),
        source: "estimate.pdf",
        authority: "inferred",
      },
    ],
  });

  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(analysis.vehicle?.vin, "WB523CF05RCN81298");
  assert.equal(report.analysis?.vehicle?.vin, "WB523CF05RCN81298");
  assert.equal(exportModel.vehicle.vin, "WB523CF05RCN81298");
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "WB523CF05RCN81298");
  assert.equal(exportModel.vehicle.display, "2024 BMW iX xDrive");
  assert.equal(exportModel.vehicle.trim, "50 Sports Activity");
});

runTest("export and PDF do not downgrade supported canonical vehicle when evidence is noisy", () => {
  const canonicalVehicle: VehicleIdentity = {
    ...structuredFixtureVehicle,
    source: "attachment",
    confidence: structuredFixtureVehicle.confidence ?? 0.98,
  };

  const report = makeReport({
    vehicle: canonicalVehicle,
    evidence: [
      {
        id: "noisy-evidence-1",
        title: "Estimate OCR",
        snippet: [
          "Upload an estimate or supporting documents to generate a real repair intelligence read.",
          "3/24/2026 9:32:11 AM 300060 Page 6",
          "Workfile ID: WRKF1LE1D12345678",
          "Federal ID: FEDRL12345678901",
        ].join("\n"),
        source: "estimate.pdf",
        authority: "inferred",
      },
    ],
  });

  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  const expectedDisplay = resolveVehicleIdentity(canonicalVehicle).display;

  assert.notEqual(expectedDisplay, "Unspecified");
  assert.equal(exportModel.vehicle.display, expectedDisplay);
  assert.equal(exportModel.vehicle.vin, canonicalVehicle.vin);
  assert.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, expectedDisplay);
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, canonicalVehicle.vin);
});

runTest("report export still falls back safely when no structured VIN exists", () => {
  const report = makeReport({
    vehicle: {
      year: 2024,
      make: "BMW",
      model: "iX xDrive",
      trim: "50 Sports Activity",
      source: "attachment",
      confidence: 0.88,
    },
  });

  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(exportModel.vehicle.vin, undefined);
});

runTest("safe fallback keeps vehicle when VIN is not clearly supported", () => {
  const extracted = extractVehicleIdentityFromText(
    vehicleNoVinFallbackFixture.text,
    "attachment"
  );
  const report = makeReport({
    vehicle: extracted ?? undefined,
    evidence: [
      {
        id: "fallback-evidence-1",
        title: "Estimate Page 1",
        snippet: vehicleNoVinFallbackFixture.text,
        source: "estimate-page-1.pdf",
        authority: "inferred",
      },
    ],
  });
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const chatVehicle = inferDriveVehicleContext({
    estimateText: vehicleNoVinFallbackFixture.text,
    userQuery: "Review this 2024 Honda Civic LX estimate",
    analysisVehicle: extracted
      ? {
          ...extracted,
          source: "attachment",
          confidence: extracted.confidence ?? 0.8,
        }
      : null,
  });

  assert.equal(exportModel.vehicle.vin, undefined);
  assert.equal(exportModel.vehicle.display, vehicleNoVinFallbackFixture.expectedDisplay);
  assert.notEqual(exportModel.vehicle.display, "Unspecified");
  assert.equal(exportModel.vehicle.trim, vehicleNoVinFallbackFixture.expectedTrim);
  assert.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, vehicleNoVinFallbackFixture.expectedDisplay);
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "Unspecified");
  assert.equal(chatVehicle.make, "BMW");
  assert.equal(chatVehicle.model, "X7 xDrive40i");
  assert.equal(chatVehicle.trim, vehicleNoVinFallbackFixture.expectedTrim);
});

runTest("no-data case still falls back safely to Unspecified", () => {
  const exportModel = buildExportModel({
    report: makeReport(),
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });
  const pdf = buildCarrierReport({
    report: makeReport(),
    analysis: null,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(exportModel.vehicle.display, "Unspecified");
  assert.equal(exportModel.vehicle.vin, undefined);
  assert.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, "Unspecified");
  assert.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "Unspecified");
});

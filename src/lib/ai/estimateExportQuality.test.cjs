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

const { extractEstimateFacts } = require("./extractors/extractEstimateFacts.ts");
const { normalizeReportToAnalysisResult } = require("./builders/normalizeReportToAnalysisResult.ts");
const {
  buildExportModel,
  computeACVFromComps,
  deriveExportReportFields,
} = require("./builders/buildExportModel.ts");
const { buildCarrierReport } = require("./builders/carrierPdfBuilder.ts");
const { buildDisputeIntelligencePdf } = require("./builders/disputeIntelligencePdfBuilder.ts");
const { buildRebuttalEmailPdf } = require("./builders/rebuttalEmailPdfBuilder.ts");
const { buildDisputeIntelligenceReport } = require("./builders/exportTemplates.ts");
const { buildSupplementLines } = require("./builders/supplementBuilder.ts");
const { generateNegotiationResponse } = require("./builders/negotiationEngine.ts");
const { buildVehicleLabel, decodeVinVehicleIdentity, extractVehicleIdentityFromText } = require("./vehicleContext.ts");
const {
  assessRetrievedDocumentApplicability,
  resolveVehicleApplicabilityContext,
} = require("./vehicleApplicability.ts");
const { extractEstimateLinksFromDocuments } = require("./estimateLinkExtractor.ts");
const { deriveRenderInsightsFromChat } = require("./builders/deriveRenderInsightsFromChat.ts");
const { cleanVehicleSummaryLabel, cleanVehicleTrimLabel } = require("../ui/presentationText.ts");

const SHOP_21733_TEXT = `
Vehicle Description: 2018 TESL Model S 75D AWD
VIN: 5YJSA1E21JF264319
Mileage: 173,702
Insurer: GEICO
Grand Total 19,428.53
Procedure research and documentation
Work authorization on file
Pre-repair scan
In-process repair scan
Post-repair scan
Pre-paint test fit
Recover and recharge refrigerant
Headlamp aim and fog aim
Cavity wax
Final road test
HV battery state of charge maintained
`;

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeReport() {
  return {
    summary: {
      riskScore: "moderate",
      confidence: "moderate",
      criticalIssues: 1,
      evidenceQuality: "moderate",
    },
    vehicle: undefined,
    issues: [
      {
        id: "issue-1",
        category: "documentation",
        title: "Structural Measurement Verification",
        finding: "Structural Measurement Verification",
        impact:
          "Dimensional verification and measuring support are not clearly documented for the current repair path.",
        missingOperation: "Structural Measurement Verification",
        severity: "high",
        evidenceIds: ["evidence-1"],
      },
      {
        id: "issue-2",
        category: "parts",
        title: "Hidden Mounting Geometry / Teardown Growth",
        finding: "Hidden Mounting Geometry / Teardown Growth",
        impact:
          "Front-end teardown growth and hidden mounting geometry remain likely even though the visible estimate is otherwise credible.",
        missingOperation: "Hidden Mounting Geometry / Teardown Growth",
        severity: "medium",
        evidenceIds: ["evidence-1"],
      },
    ],
    requiredProcedures: [],
    presentProcedures: ["Pre-repair scan", "In-process scan", "Post-repair scan", "Headlamp aiming check"],
    missingProcedures: ["Structural Measurement Verification"],
    supplementOpportunities: [
      "Add and document dimensional/measuring verification.",
      "Add and document wheel alignment confirmation.",
      "Add and document Tesla-specific calibration confirmation beyond scan/reset language.",
    ],
    evidence: [
      {
        id: "evidence-1",
        title: "Shop 21733 estimate",
        snippet: SHOP_21733_TEXT,
        source: "Shop 21733.pdf",
        authority: "inferred",
      },
    ],
    recommendedActions: [
      "The estimate reads as a credible preliminary repair plan, but dimensional verification, alignment confirmation, Tesla-specific calibration support, and hidden mounting geometry growth still need clearer documentation.",
      "Upload an estimate or supporting documents to generate a real repair intelligence read.",
    ],
    analysis: undefined,
    sourceEstimateText: SHOP_21733_TEXT,
  };
}

run("extractEstimateFacts captures Shop 21733 hard facts and documented positives", () => {
  const facts = extractEstimateFacts({ text: SHOP_21733_TEXT });

  assert.equal(facts.vehicle?.year, 2018);
  assert.equal(facts.vehicle?.make, "Tesla");
  assert.equal(facts.vehicle?.model, "Model S");
  assert.equal(facts.vehicle?.trim, "75D AWD");
  assert.equal(facts.vehicle?.vin, "5YJSA1E21JF264319");
  assert.equal(facts.mileage, 173702);
  assert.equal(facts.insurer, "GEICO");
  assert.equal(facts.estimateTotal, 19428.53);
  assert.equal(facts.documentedProcedures.includes("Pre-repair scan"), true);
  assert.equal(facts.documentedProcedures.includes("In-process scan"), true);
  assert.equal(facts.documentedProcedures.includes("Post-repair scan"), true);
  assert.equal(facts.documentedProcedures.includes("Test fits"), true);
  assert.equal(facts.documentedProcedures.includes("Refrigerant service"), true);
  assert.equal(facts.documentedProcedures.includes("Cavity wax"), true);
  assert.equal(facts.documentedProcedures.includes("Final road test"), true);
  assert.equal(facts.documentedProcedures.includes("HV battery state-of-charge maintenance"), true);
  assert.equal(facts.documentedHighlights.includes("Procedure research/documentation"), true);
  assert.equal(facts.documentedHighlights.includes("Work authorization"), true);
  assert.equal(facts.documentedHighlights.includes("Test fits"), true);
  assert.equal(facts.documentedHighlights.includes("Refrigerant service"), true);
  assert.equal(facts.documentedHighlights.includes("Headlamp/fog aim"), true);
  assert.equal(facts.documentedHighlights.includes("Cavity wax"), true);
  assert.equal(facts.documentedHighlights.includes("Final road test"), true);
  assert.equal(facts.documentedHighlights.includes("HV battery state-of-charge maintenance"), true);
});

run("vehicle extraction resolves TESL header text and Tesla 5YJ VIN decoding", () => {
  const extractedVehicle = extractVehicleIdentityFromText(SHOP_21733_TEXT, "attachment");
  const decodedVehicle = decodeVinVehicleIdentity("5YJSA1E21JF264319");

  assert.equal(extractedVehicle?.make, "Tesla");
  assert.equal(extractedVehicle?.model, "Model S");
  assert.equal(extractedVehicle?.trim, "75D AWD");
  assert.equal(decodedVehicle?.make, "Tesla");
  assert.equal(decodedVehicle?.manufacturer, "Tesla, Inc.");
  assert.equal(buildVehicleLabel(extractedVehicle), "2018 Tesla Model S 75D AWD");
});

run("presentation cleanup preserves canonical vehicle labels and trims", () => {
  assert.equal(cleanVehicleSummaryLabel("2018 Tesla Model S 75D AWD"), "2018 Tesla Model S 75D AWD");
  assert.equal(cleanVehicleTrimLabel("75D AWD"), "75D AWD");
  assert.equal(cleanVehicleSummaryLabel("GEICO"), "GEICO");
  assert.equal(cleanVehicleSummaryLabel("THOMAS"), "THOMAS");
  assert.equal(cleanVehicleSummaryLabel("2018 Tesla Model S 75D AWD scan module"), "2018 Tesla Model S 75D AWD scan module");
  assert.equal(cleanVehicleSummaryLabel("What looks reasonable:"), "");
});

run("deriveExportReportFields prefers estimateFacts and suppresses placeholder fallbacks", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const fields = deriveExportReportFields({ report, analysis });

  assert.equal(fields.vehicleLabel, "2018 Tesla Model S 75D AWD");
  assert.equal(fields.vin, "5YJSA1E21JF264319");
  assert.equal(fields.mileage, 173702);
  assert.equal(fields.insurer, "GEICO");
  assert.equal(fields.estimateTotal, 19428.53);
  assert.equal(fields.presentStrengths.includes("Post-repair scan"), true);
  assert.equal(fields.presentStrengths.includes("Work authorization"), true);
  assert.equal(fields.presentStrengths.includes("Test fits"), true);
  assert.equal(fields.presentStrengths.includes("Refrigerant service"), true);
  assert.equal(fields.presentStrengths.includes("Final road test"), true);
  assert.equal(fields.presentStrengths.includes("HV battery state-of-charge maintenance"), true);
  assert.equal(fields.vehicleLabel?.includes("Vehicle details still limited"), false);
});

run("normalized analysis preserves estimate facts for Shop 21733", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);

  assert.equal(analysis.estimateFacts?.vehicle?.vin, "5YJSA1E21JF264319");
  assert.equal(analysis.estimateFacts?.mileage, 173702);
  assert.equal(analysis.estimateFacts?.insurer, "GEICO");
  assert.equal(analysis.estimateFacts?.estimateTotal, 19428.53);
  assert.equal(analysis.rawEstimateText.includes("Grand Total 19,428.53"), true);
});

run("export model removes placeholder text and keeps documented scans as positives", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis:
      "Upload an estimate or supporting documents to generate a real repair intelligence read.\n\nThe estimate is credible but likely incomplete in dimensional verification, wheel alignment, Tesla-specific calibration confirmation, and hidden mounting geometry growth.",
  });

  const supplementTitles = exportModel.supplementItems.map((item) => item.title);

  assert.equal(exportModel.vehicle.vin, "5YJSA1E21JF264319");
  assert.equal(exportModel.estimateFacts.insurer, "GEICO");
  assert.equal(exportModel.estimateFacts.mileage, 173702);
  assert.equal(exportModel.estimateFacts.estimateTotal, 19428.53);
  assert.equal(exportModel.reportFields.vehicleLabel, "2018 Tesla Model S 75D AWD");
  assert.equal(exportModel.reportFields.vin, "5YJSA1E21JF264319");
  assert.equal(exportModel.reportFields.insurer, "GEICO");
  assert.equal(exportModel.repairPosition.includes("Upload an estimate or supporting documents"), false);
  assert.equal(exportModel.request.includes("Upload an estimate or supporting documents"), false);
  assert.equal(exportModel.repairPosition.includes("What looks reasonable:"), false);
  assert.equal(exportModel.positionStatement.includes("What looks reasonable:"), false);
  assert.equal(supplementTitles.includes("Pre-Repair Scan"), false);
  assert.equal(supplementTitles.includes("Post-Repair Scan"), false);
  assert.equal(supplementTitles.includes("Corrosion Protection / Weld Restoration"), false);
  assert.equal(exportModel.supplementItems[0]?.title, "Structural Measurement Verification");
  assert.equal(
    exportModel.supplementItems[0]?.title.includes("Front Structure Scope / Tie Bar / Upper Rail Reconciliation"),
    false
  );
  assert.equal(exportModel.valuation.acvMissingInputs.includes("mileage"), false);
  assert.equal(
    exportModel.repairPosition.includes("The file supports a grounded preliminary review, while some repair or documentation items may become clearer as teardown progresses."),
    true
  );
  assert.equal(exportModel.repairPosition.includes("documents strengths such as"), true);
  assert.equal(exportModel.repairPosition.includes("vehicle 2018 Tesla Model S 75D AWD"), true);
  assert.equal(exportModel.repairPosition.includes("vehicle details still limited"), false);
  assert.equal(exportModel.positionStatement.includes("VIN not clearly supported"), false);
  assert.equal(
    exportModel.repairPosition.indexOf("documents strengths such as") <
      exportModel.repairPosition.indexOf("support remains open on"),
    true
  );
  assert.equal(exportModel.repairPosition.toLowerCase().includes("carrier estimate"), false);
  assert.equal(exportModel.repairPosition.toLowerCase().includes("shop estimate"), false);
});

run("computeACVFromComps derives a normalized market range from comparable listings", () => {
  const result = computeACVFromComps({
    vehicle: {
      year: 2018,
      make: "Tesla",
      model: "Model S",
      trim: "75D AWD",
    },
    mileage: 173702,
    comparableListings: [
      { price: 18800, mileage: 168000, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
      { price: 19450, mileage: 181200, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
      { price: 20100, mileage: 176000, year: 2019, make: "Tesla", model: "Model S", trim: "75D" },
      { price: 21000, mileage: 165000, year: 2018, make: "Tesla", model: "Model 3", trim: "Long Range" },
    ],
  });

  assert.ok(result);
  assert.equal(result.sourceType, "comps");
  assert.equal(result.compCount, 3);
  assert.equal(typeof result.acvValue, "number");
  assert.equal(typeof result.acvRange.low, "number");
  assert.equal(typeof result.acvRange.high, "number");
  assert.equal(result.acvRange.low <= result.acvValue, true);
  assert.equal(result.acvRange.high >= result.acvValue, true);
  assert.equal(result.confidence, "medium");
});

run("structured comparable listings override chat-derived ACV in the export model", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  analysis.valuationData = {
    comparableListings: [
      { price: 19100, mileage: 170000, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
      { price: 19850, mileage: 176200, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
      { price: 20500, mileage: 181000, year: 2019, make: "Tesla", model: "Model S", trim: "75D" },
    ],
  };

  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis:
      "ACV: $9,999. Diminished value may exist. For a full valuation, continue at https://www.collision.academy/",
  });

  assert.equal(exportModel.valuation.acvSourceType, "comps");
  assert.equal(exportModel.valuation.acvStatus, "estimated_range");
  assert.equal(exportModel.valuation.acvCompCount, 3);
  assert.notEqual(exportModel.valuation.acvValue, 9999);
  assert.equal(Boolean(exportModel.valuation.acvRange), true);
  assert.equal(exportModel.valuation.acvMissingInputs.length, 0);
  assert.equal(/comparable listing/i.test(exportModel.valuation.acvReasoning), true);
});

run("structured JD Power-style values are used when comps are unavailable", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  analysis.valuationData = {
    jdPower: {
      average: 18650,
      low: 17400,
      high: 19800,
    },
  };

  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: "ACV is not determinable from the current documents.",
  });

  assert.equal(exportModel.valuation.acvSourceType, "jd_power");
  assert.equal(exportModel.valuation.acvStatus, "estimated_range");
  assert.equal(exportModel.valuation.acvValue, undefined);
  assert.deepEqual(exportModel.valuation.acvRange, { low: 17400, high: 19800 });
  assert.equal(exportModel.valuation.acvConfidence, "medium");
});

run("chat-derived render insights strip orphan section labels and avoid over-weighting weak structure cues", () => {
  const insights = deriveRenderInsightsFromChat(`
What looks reasonable:

The estimate is a credible preliminary repair plan.

What still needs support:

Front support replacement may still need dimensional verification, wheel alignment, and coolant bleed confirmation.
`);

  assert.equal(insights.narrative?.includes("What looks reasonable:"), false);
  assert.equal(insights.narrative?.includes("What still needs support:"), false);
  assert.equal(
    insights.supplementItems.some((item) => item.title === "Front Structure Scope / Tie Bar / Upper Rail Reconciliation"),
    false
  );
});

run("vehicle applicability gate suppresses mismatched make-specific chat carryover", () => {
  const insights = deriveRenderInsightsFromChat(
    `
The BMW X5 estimate supports front camera handling and scan closure.
Volvo XC40 tie bar logic and Volvo Car Corporation support should drive the review.
KAFAS calibration remains a BMW-specific issue when the file is BMW.
`,
    resolveVehicleApplicabilityContext({
      year: 2024,
      make: "Nissan",
      model: "Sentra",
      manufacturer: "Nissan Motor",
    })
  );

  assert.equal(
    insights.supplementItems.some((item) => /volvo|bmw|kafas|x5/i.test(`${item.title} ${item.rationale}`)),
    false
  );
  assert.equal((insights.narrative ?? "").includes("Volvo"), false);
});

run("estimate link extractor keeps trusted procedure links and rejects unrelated links", () => {
  const links = extractEstimateLinksFromDocuments([
    {
      filename: "subaru-estimate.txt",
      text: `
OEM procedure reference: https://techinfo.subaru.com/stis/doc/adas/eyesight-calibration.pdf
Ignore this marketing page: https://www.instagram.com/collision_academy
      `,
    },
  ]);

  assert.equal(links.some((link) => link.classification === "oem_procedure"), true);
  assert.equal(
    links.some((link) => /instagram/i.test(link.domain) && link.classification === "unsupported"),
    true
  );
});

run("retrieved document applicability rejects mismatched OEM systems and keeps generic docs", () => {
  const vehicle = resolveVehicleApplicabilityContext({
    year: 2023,
    make: "Subaru",
    model: "Outback",
    manufacturer: "Subaru Corporation",
  });

  const kafasDoc = assessRetrievedDocumentApplicability({
    title: "BMW KAFAS camera calibration procedure",
    excerpt: "KAFAS calibration and BMW front camera aiming instructions.",
    source: "https://bmw.example.com/kafas.pdf",
    vehicle,
  });
  const genericDoc = assessRetrievedDocumentApplicability({
    title: "Generic calibration verification guide",
    excerpt: "Post-repair scan and calibration verification steps for camera or radar service.",
    source: "https://docs.example.com/calibration-guide.pdf",
    vehicle,
  });

  assert.equal(kafasDoc.keep, false);
  assert.equal(kafasDoc.matchLevel, "mismatched_vehicle");
  assert.equal(genericDoc.keep, true);
  assert.equal(genericDoc.matchLevel, "generic");
});

run("carrier and estimate-review exports show Shop 21733 facts without unsupported VIN language", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const carrier = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const disputeIntelligence = buildDisputeIntelligencePdf({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  const rebuttal = buildRebuttalEmailPdf({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(carrier.summary.find((item) => item.label === "Vehicle")?.value, "2018 Tesla Model S 75D AWD");
  assert.equal(carrier.summary.find((item) => item.label === "VIN")?.value, "5YJSA1E21JF264319");
  assert.equal(carrier.summary.find((item) => item.label === "Insurer")?.value, "[REDACTED_INSURER]");
  assert.equal(carrier.summary.find((item) => item.label === "Mileage")?.value, "173,702");
  assert.equal(carrier.summary.find((item) => item.label === "Estimate Total")?.value, "$19,428.53");
  assert.equal(
    carrier.sections.some((section) => section.title === "Documented Positives" && (section.bullets ?? []).includes("Cavity wax.")),
    true
  );
  assert.equal(
    carrier.sections.some((section) => section.title === "Documented Positives" && (section.bullets ?? []).includes("Post-repair scan.")),
    true
  );
  assert.equal(
    carrier.sections.some((section) => section.title === "Documented Positives" && (section.bullets ?? []).includes("Final road test.")),
    true
  );
  assert.equal(
    carrier.sections.some((section) => section.title === "Documented Positives" && (section.bullets ?? []).some((bullet) => /acc radar calibration/i.test(bullet))),
    false
  );
  assert.equal(
    carrier.summary.find((item) => item.label === "VIN")?.value.includes("Not clearly supported"),
    false
  );
  assert.equal(carrier.summary.find((item) => item.label === "Insurer")?.value, "[REDACTED_INSURER]");
  assert.equal(carrier.summary.some((item) => item.value === "THOMAS"), false);
  assert.equal(
    disputeIntelligence.summary.find((item) => item.label === "Vehicle")?.value,
    "2018 Tesla Model S 75D AWD"
  );
  assert.equal(
    disputeIntelligence.summary.find((item) => item.label === "VIN")?.value,
    "5YJSA1E21JF264319"
  );
  assert.equal(rebuttal.summary.find((item) => item.label === "Vehicle")?.value, "2018 Tesla Model S 75D AWD");
  assert.equal(rebuttal.summary.find((item) => item.label === "VIN")?.value, "5YJSA1E21JF264319");
  assert.equal(disputeIntelligence.summary.some((item) => item.value === "Unspecified"), false);
  assert.equal(rebuttal.summary.some((item) => item.value === "Unspecified"), false);
  assert.equal(
    disputeIntelligence.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => /Front Structure Scope \/ Tie Bar \/ Upper Rail Reconciliation/i.test(bullet))
    ),
    false
  );
  assert.equal(
    carrier.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => /^Post-Repair Scan:/i.test(bullet))
    ),
    false
  );
  assert.equal(
    carrier.sections.some((section) =>
      (section.bullets ?? []).some((bullet) => /function not clearly represented in estimate/i.test(bullet))
    ),
    false
  );
  assert.equal(disputeIntelligence.header.title, "Dispute Intelligence Report");
  assert.equal(
    disputeIntelligence.sections.some((section) =>
      section.title === "Top Dispute Drivers"
    ),
    true
  );
  assert.equal(
    disputeIntelligence.sections.some((section) =>
      section.title === "Recommended Next Moves"
    ),
    true
  );
});

run("pdf builders honor a pre-resolved render model without recomputing divergent facts", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const renderModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  const sharedInput = {
    renderModel,
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  };

  const carrier = buildCarrierReport(sharedInput);
  const disputeIntelligence = buildDisputeIntelligencePdf(sharedInput);
  const rebuttal = buildRebuttalEmailPdf(sharedInput);

  assert.equal(carrier.summary.find((item) => item.label === "Vehicle")?.value, renderModel.reportFields.vehicleLabel);
  assert.equal(carrier.summary.find((item) => item.label === "VIN")?.value, renderModel.reportFields.vin);
  assert.equal(carrier.summary.find((item) => item.label === "Insurer")?.value, "[REDACTED_INSURER]");
  assert.equal(
    disputeIntelligence.summary.find((item) => item.label === "Vehicle")?.value,
    renderModel.reportFields.vehicleLabel
  );
  assert.equal(
    disputeIntelligence.summary.find((item) => item.label === "VIN")?.value,
    renderModel.reportFields.vin
  );
  assert.equal(rebuttal.summary.find((item) => item.label === "Insurer")?.value, "[REDACTED_INSURER]");
});

run("dispute intelligence text template stays decision-ready outside compare mode", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const disputeIntelligence = buildDisputeIntelligenceReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(disputeIntelligence.includes("shop-side repair path"), false);
  assert.equal(disputeIntelligence.includes("Carrier position:"), false);
  assert.equal(disputeIntelligence.includes("## Top Dispute Drivers"), true);
  assert.equal(disputeIntelligence.includes("Recommended next action:"), true);
});

run("export model builds dispute intelligence and premium-ready report models", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(typeof exportModel.disputeIntelligenceReport.summary, "string");
  assert.equal(Array.isArray(exportModel.disputeIntelligenceReport.topDrivers), true);
  assert.equal(exportModel.disputeIntelligenceReport.topDrivers.length > 0, true);
  assert.equal(
    exportModel.disputeIntelligenceReport.supportGaps.some((gap) =>
      exportModel.disputeIntelligenceReport.topDrivers.some((driver) => gap.includes(driver.title))
    ),
    false
  );
  assert.equal(
    exportModel.disputeIntelligenceReport.nextMoves.some((move) =>
      exportModel.disputeIntelligenceReport.topDrivers.some((driver) => move === driver.nextAction)
    ),
    false
  );
  assert.equal(Array.isArray(exportModel.negotiationPlaybook.likelyPushback), true);
  assert.equal(Array.isArray(exportModel.financialGapBreakdown.drivers), true);
  assert.equal(typeof exportModel.financialGapBreakdown.narrativeSummary, "string");
});

run("negotiation generation uses validated support gaps only", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const supplementLines = buildSupplementLines(report);
  const negotiation = generateNegotiationResponse(report);
  const analysisNegotiation = generateNegotiationResponse(analysis);

  assert.equal(supplementLines.some((item) => item.title === "Post-Repair Scan"), false);
  assert.equal(supplementLines.some((item) => item.title === "Pre-Repair Scan"), false);
  assert.equal(supplementLines.some((item) => item.title === "In-process repair scan"), false);
  assert.equal(supplementLines.some((item) => item.title === "System Calibration"), false);
  assert.equal(
    supplementLines.some((item) => item.title === "Corrosion Protection / Weld Restoration"),
    false
  );
  assert.equal(
    supplementLines.some((item) => item.title.includes("Structural Measurement Verification")),
    true
  );
  assert.equal(negotiation.includes("Post-Repair Scan"), false);
  assert.equal(negotiation.includes("System Calibration"), false);
  assert.equal(analysisNegotiation.includes("Post-Repair Scan"), false);
  assert.equal(analysisNegotiation.includes("System Calibration"), false);
});

run("OEM-backed supplement opportunities flow into supplement lines and negotiation output", () => {
  const report = makeReport();
  report.evidence = [
    {
      id: "evidence-1",
      title: "Shop 21733 estimate",
      snippet: SHOP_21733_TEXT.replace(/Pre-paint test fit/gi, "Test fits"),
      source: "Shop 21733.pdf",
      authority: "inferred",
    },
  ];
  report.sourceEstimateText = SHOP_21733_TEXT.replace(/Pre-paint test fit/gi, "Test fits");
  report.supplementOpportunities = [
    "OEM support in BMW Front Bumper Procedure.pdf indicates one-time-use hardware, seals, or clips may need to be replaced and documented when disturbed.",
    "OEM support in BMW Position Statement.pdf indicates a fit-sensitive repair path, so pre-paint test-fit or mock-up documentation may be needed before final finish work.",
  ];
  report.missingProcedures = [];
  report.presentProcedures = ["Pre-repair scan", "Post-repair scan"];

  const supplementLines = buildSupplementLines(report);
  const negotiation = generateNegotiationResponse(report);

  assert.equal(
    supplementLines.some((item) => item.title === "One-Time-Use Hardware / Seals / Clips"),
    true
  );
  assert.equal(
    supplementLines.some((item) => item.title === "Pre-Paint Test Fit"),
    true
  );
  assert.equal(/BMW Front Bumper Procedure\.pdf/i.test(negotiation), true);
  assert.equal(/fit-sensitive repair path/i.test(negotiation), true);
});

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
  computeWeightedAcvPreview,
  deriveExportReportFields,
} = require("./builders/buildExportModel.ts");
const { buildCollisionSnapshot } = require("./builders/collisionSnapshot.ts");
const { buildCollisionSnapshotPdfFromSnapshot } = require("./builders/collisionSnapshotPdfBuilder.ts");
const { buildCarrierReport } = require("./builders/carrierPdfBuilder.ts");
const { buildCustomerReportPdf } = require("./builders/customerReportPdfBuilder.ts");
const { renderCustomerReportHtml } = require("./renderCustomerReportHtml.ts");
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

const SHOP_21975_COMPARISON_TEXT = `
Shop 21975 estimate total $7,838.99. Body labor 13.5 @ $75. Paint labor 3.7 @ $75. Paint supplies 3.7 @ $60.
Shop estimate includes OEM-style bumper, grille, radiator support, front-end parts, test fit bumper, final road test, alignment line with no amount/result, and pre/post scan $201 sublet +34%.
SOR-1 21975 carrier total repairs $4,597.17 net $4,097.17. Body labor 13.2 @ $60. Paint labor 3.2 @ $60. Paint supplies 3.2 @ $40.
Carrier uses A/M CAPA LKQ substitutions. Line 23 LKQ grille note: LKQ grille is not correct style.
Carrier references pre-repair scan, in-process scan, seat belt dynamic function test, post-repair scan, final road test, and REVVAdas Egnyte link. The Egnyte support link is referenced but not produced.
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

function flattenCarrierDocument(document) {
  return [
    document.header?.title,
    document.header?.subtitle,
    ...(document.summary ?? []).flatMap((item) => [item.label, item.value]),
    ...(document.sections ?? []).flatMap((section) => [
      section.title,
      section.body,
      ...(section.bullets ?? []),
    ]),
    ...(document.footer ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function flattenSnapshot(snapshot) {
  return JSON.stringify(snapshot);
}

function assertNoCustomerDebugText(text) {
  const bannedPatterns = [
    /evidence\s*chain/i,
    /cmox/i,
    /immutable/i,
    /runtime/i,
    /inferred\s+support/i,
    /verified\s+support/i,
    /support\s*:\s*verified/i,
    /support\s+basis/i,
    /risk if omitted/i,
    /confidence\s+percentage/i,
    /documented evidence at \d+% confidence/i,
    /\b\d{1,3}%\s+confidence\b/i,
    /underwritten/i,
    /Proc\s*\d+\s*#?\*+/i,
    /\bwheelm\d+(?:\.\d+)?\b/i,
    /\bparser\b/i,
  ];

  for (const pattern of bannedPatterns) {
    assert.equal(pattern.test(text), false, `unexpected customer debug text: ${pattern}`);
  }
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

run("extractEstimateFacts ignores tiny boilerplate amount for 21548/SOR3 totals", () => {
  const shopFacts = extractEstimateFacts({
    text: [
      "Shop 21548 / SOR3 repair estimate",
      "ESTIMATE TOTAL: $0.02",
      "Total Cost of Repairs $9,307.40",
      "Line 50 Repl RF wheel 0.3 M",
      "Line 51 R&I LF wheel 0.2 M access note",
    ].join("\n"),
  });
  const carrierFacts = extractEstimateFacts({
    text: [
      "Carrier estimate SOR3",
      "ESTIMATE TOTAL: $0.02",
      "Total Cost of Repairs $5,737.10",
      "Line 43 RF wheel repair sublet 0.0",
      "Line 44 Tire mount and balance 0.0",
      "Line 47 Four wheel alignment",
    ].join("\n"),
  });
  const grossGap = Number((shopFacts.estimateTotal - carrierFacts.estimateTotal).toFixed(2));

  assert.equal(shopFacts.estimateTotal, 9307.40);
  assert.equal(carrierFacts.estimateTotal, 5737.10);
  assert.equal(grossGap, 3570.30);
  assert.notEqual(shopFacts.estimateTotal, 0.02);
  assert.notEqual(carrierFacts.estimateTotal, 0.02);
});

run("repair intelligence export separates 21548/SOR3 comparison totals", () => {
  const report = {
    ...makeReport(),
    sourceEstimateText: [
      "Shop 21548 / SOR3 repair estimate",
      "ESTIMATE TOTAL: $0.02",
      "Shop estimate grand total $9,307.40",
      "Carrier estimate SOR3 total cost of repairs $5,737.10",
      "Carrier net after deductible $5,237.10",
      "Line 50 Repl RF wheel 0.3 M",
      "Line 51 R&I LF wheel 0.2 M access note",
    ].join("\n"),
    evidence: [
      {
        id: "evidence-21548",
        title: "21548/SOR3 estimates",
        snippet: [
          "Shop estimate grand total $9,307.40",
          "Carrier total cost of repairs $5,737.10",
          "Carrier net after deductible $5,237.10",
        ].join("\n"),
        source: "Shop 21548.pdf / SOR3.pdf",
        authority: "inferred",
      },
    ],
  };
  const analysis = normalizeReportToAnalysisResult(report);
  const carrier = buildCarrierReport({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });

  assert.equal(carrier.summary.find((item) => item.label === "Shop Estimate Grand Total")?.value, "$9,307.40");
  assert.equal(carrier.summary.find((item) => item.label === "Carrier Total Cost of Repairs")?.value, "$5,737.10");
  assert.equal(carrier.summary.find((item) => item.label === "Carrier Net After Deductible")?.value, "$5,237.10");
  assert.equal(carrier.summary.find((item) => item.label === "Gross Repair Appraisal Gap")?.value, "$3,570.30");
  assert.equal(carrier.summary.find((item) => item.label === "Estimate Total")?.value, undefined);
  assert.equal(flattenCarrierDocument(carrier).includes("$0.02"), false);
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
      exportModel.repairPosition.indexOf("The file supports a grounded preliminary review"),
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
      { price: 20100, mileage: 176000, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
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
  assert.equal(result.confidence, "low");
});

run("weighted ACV preview uses guide-only low confidence when no comps exist", () => {
  const result = computeWeightedAcvPreview({
    jdPower: { average: 20000, low: 18500, high: 21500 },
  });

  assert.ok(result);
  assert.equal(result.compCount, 0);
  assert.equal(result.sourceType, "jd_power");
  assert.equal(result.label, "Guide-only directional preview");
  assert.equal(result.confidence, "low");
});

run("weighted ACV preview keeps one comp limited and guide-weighted", () => {
  const result = computeWeightedAcvPreview({
    vehicle: { year: 2020, make: "Toyota", model: "Camry", trim: "SE" },
    mileage: 50000,
    jdPower: { average: 20000, low: 18500, high: 21500 },
    comparableListings: [
      { price: 24000, mileage: 51000, year: 2020, make: "Toyota", model: "Camry", trim: "SE", location: "PA" },
    ],
  });

  assert.ok(result);
  assert.equal(result.compCount, 1);
  assert.equal(result.sourceType, "guide_blend");
  assert.equal(result.label, "Limited comp preview");
  assert.equal(result.confidence, "low");
  assert.equal(result.acvValue > 20000 && result.acvValue < 24000, true);
});

run("weighted ACV preview uses low or moderate confidence for two comps", () => {
  const result = computeWeightedAcvPreview({
    vehicle: { year: 2020, make: "Toyota", model: "Camry", trim: "SE" },
    mileage: 50000,
    jdPower: { average: 20000, low: 18500, high: 21500 },
    comparableListings: [
      { price: 23000, mileage: 51000, year: 2020, make: "Toyota", model: "Camry", trim: "SE", location: "PA" },
      { price: 25000, mileage: 49000, year: 2020, make: "Toyota", model: "Camry", trim: "SE", location: "PA" },
    ],
  });

  assert.ok(result);
  assert.equal(result.compCount, 2);
  assert.equal(result.sourceType, "guide_blend");
  assert.match(result.confidence, /^(low|medium)$/);
});

run("weighted ACV preview needs complete three-plus comp data for moderate confidence", () => {
  const result = computeWeightedAcvPreview({
    vehicle: { year: 2020, make: "Toyota", model: "Camry", trim: "SE" },
    mileage: 50000,
    jdPower: { average: 20000, low: 18500, high: 21500 },
    comparableListings: [
      { price: 23000, mileage: 51000, year: 2020, make: "Toyota", model: "Camry", trim: "SE", location: "PA", condition: "clean", titleStatus: "clean" },
      { price: 25000, mileage: 49000, year: 2020, make: "Toyota", model: "Camry", trim: "SE", location: "PA", condition: "clean", titleStatus: "clean" },
      { price: 26000, mileage: 50500, year: 2020, make: "Toyota", model: "Camry", trim: "SE", location: "PA", condition: "clean", titleStatus: "clean" },
    ],
  });

  assert.ok(result);
  assert.equal(result.compCount, 3);
  assert.equal(result.sourceType, "guide_blend");
  assert.equal(result.confidence, "medium");
});

run("structured comparable listings override chat-derived ACV in the export model", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  analysis.valuationData = {
    comparableListings: [
      { price: 19100, mileage: 170000, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
      { price: 19850, mileage: 176200, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
      { price: 20500, mileage: 181000, year: 2018, make: "Tesla", model: "Model S", trim: "75D AWD" },
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

run("specific late-model Gladiator valuation suppresses unreliable fallback preview", () => {
  const report = makeReport();
  report.vehicle = {
    year: 2024,
    make: "Jeep",
    model: "Gladiator",
    trim: "Sport S",
    confidence: 0.98,
  };
  report.sourceEstimateText = `
Vehicle Description: 2024 Jeep Gladiator Sport S
Mileage: 17,564
Grand Total 16,887.00
`;

  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: "ACV: $13,387-$19,387 based on generic fallback math.",
  });

  assert.equal(exportModel.valuation.acvStatus, "not_determinable");
  assert.equal(exportModel.valuation.acvRange, undefined);
  assert.equal(exportModel.valuation.acvSourceType, "unavailable");
  assert.match(exportModel.valuation.acvReasoning, /Market Preview unavailable:.*no completed live local comparable listings/i);
});

run("structured JD Power-style values alone produce only guide-only directional preview", () => {
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
  assert.equal(exportModel.valuation.acvConfidence, "low");
  assert.match(exportModel.valuation.acvReasoning, /Guide-only directional preview/i);
});

run("specific vehicle ACV stays unavailable when live comparable search is unavailable", () => {
  const report = makeReport();
  report.vehicle = {
    year: 2024,
    make: "Jeep",
    model: "Gladiator",
    trim: "Sport 4WD",
    confidence: 0.95,
  };
  report.sourceEstimateText = `
Vehicle Description: 2024 Jeep Gladiator Sport 4WD
Mileage: 17,563
Grand Total 16,200.00
`;
  report.evidence = [
    {
      id: "evidence-jeep",
      title: "Jeep estimate",
      snippet: report.sourceEstimateText,
      source: "estimate.pdf",
      authority: "documented",
    },
  ];
  const analysis = normalizeReportToAnalysisResult(report);
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: "ACV: $13,000-$19,000 based on generic fallback math.",
  });

  assert.equal(exportModel.valuation.acvStatus, "not_determinable");
  assert.equal(exportModel.valuation.acvRange, undefined);
  assert.equal(exportModel.valuation.acvSourceType, "unavailable");
  assert.match(exportModel.valuation.acvReasoning, /Market Preview unavailable:.*no completed live local comparable listings/i);
});

run("2024 Ram or Jeep Gladiator Sport/S around 17k miles never leaks the low generic fallback", () => {
  for (const make of ["Ram", "Jeep"]) {
    const report = makeReport();
    report.vehicle = {
      year: 2024,
      make,
      model: "Gladiator",
      trim: make === "Ram" ? undefined : "Sport S",
      confidence: 0.9,
    };
    report.sourceEstimateText = `
Vehicle Description: 2024 ${make} Gladiator Sport S
Mileage: 17,564
Grand Total 16,887.00
`;
    report.evidence = [
      {
        id: `evidence-${make.toLowerCase()}`,
        title: `${make} estimate`,
        snippet: report.sourceEstimateText,
        source: "estimate.pdf",
        authority: "documented",
      },
    ];
    const analysis = normalizeReportToAnalysisResult(report);
    const exportModel = buildExportModel({
      report,
      analysis,
      panel: null,
      assistantAnalysis: "ACV: $13,387-$19,387 based on generic fallback math.",
    });
    const snapshot = buildCollisionSnapshot(exportModel);
    const visibleSnapshotText = [
      flattenSnapshot(snapshot.valuationSnapshot),
      flattenCarrierDocument(buildCollisionSnapshotPdfFromSnapshot(snapshot)),
    ].join("\n");

    assert.equal(exportModel.valuation.acvStatus, "not_determinable", make);
    assert.equal(exportModel.valuation.acvRange, undefined, make);
    assert.equal(exportModel.valuation.acvSourceType, "unavailable", make);
    assert.match(exportModel.valuation.acvReasoning, /Market Preview unavailable:.*no completed live local comparable listings/i, make);
    assert.equal(/\$13,?387|\$19,?387|\$13,?000|\$19,?000/.test(visibleSnapshotText), false, make);
    assert.equal(snapshot.valuationSnapshot.acvPreviewRange, undefined, make);
    if (!snapshot.valuationSnapshot.dvPreviewRange) {
      assert.equal(snapshot.valuationSnapshot.available, false, make);
      assert.match(snapshot.valuationSnapshot.disclosure, /Market Preview unavailable:.*no completed live local comparable listings/i, make);
    }
  }
});

run("2024 Jeep Gladiator ACV uses market comps and cannot return the low fallback band", () => {
  const report = makeReport();
  report.vehicle = {
    year: 2024,
    make: "Jeep",
    model: "Gladiator",
    trim: "Sport 4WD",
    confidence: 0.95,
  };
  report.sourceEstimateText = `
Vehicle Description: 2024 Jeep Gladiator Sport 4WD
Mileage: 17,563
Grand Total 16,200.00
`;
  report.evidence = [
    {
      id: "evidence-jeep",
      title: "Jeep estimate",
      snippet: report.sourceEstimateText,
      source: "estimate.pdf",
      authority: "documented",
    },
  ];
  const analysis = normalizeReportToAnalysisResult(report);
  analysis.valuationData = {
    comparableListings: [
      { price: 35250, mileage: 16900, year: 2024, make: "Jeep", model: "Gladiator Sport", trim: "4WD" },
      { price: 36900, mileage: 18100, year: 2024, make: "Jeep", model: "Gladiator Sport", trim: "4WD" },
      { price: 38200, mileage: 15800, year: 2024, make: "Jeep", model: "Gladiator Sport", trim: "4WD" },
    ],
  };
  const exportModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: "ACV: $13,000-$19,000 based on generic fallback math.",
  });

  assert.equal(exportModel.valuation.acvSourceType, "comps");
  assert.equal(exportModel.valuation.acvStatus, "estimated_range");
  assert.equal(exportModel.valuation.acvCompCount, 3);
  assert.equal(exportModel.valuation.acvValue > 36000, true);
  assert.equal(exportModel.valuation.acvValue < 38000, true);
  assert.equal(exportModel.valuation.acvRange.low > 30000, true);
  assert.equal(exportModel.valuation.acvRange.high > 30000, true);
  assert.equal(exportModel.valuation.acvReasoning.includes("Comparable source count: 3"), true);
  assert.equal(exportModel.valuation.acvReasoning.includes("Mileage adjustment note:"), true);
  assert.equal(exportModel.valuation.acvReasoning.includes("Region note:"), true);
  assert.equal(exportModel.valuation.acvReasoning.includes("Confidence level:"), true);
  assert.equal(/will upload once comps are pulled|working on ACV/i.test(JSON.stringify(exportModel)), false);
});

run("customer report PDF strips internal audit language and parser fragments", () => {
  const document = buildCustomerReportPdf({
    report: {
      title: "Customer Report",
      openingSummary:
        "Evidence chain CMOX-123 runtime immutable support basis says Hidden Mounting Geometry Teardown Growth documented evidence at 86% confidence. CCC AWF workfile provided.",
      whichRepairPlanLooksStronger:
        "Shop estimate has ADAS Calibration Procedure Support while the underwritten operation parser fragments remain.",
      safetyFirst:
        "Side Structure Aperture Door-Shell Fit Verification and Fit And Finish Validation should be reviewed.",
      whatStillNeedsProof: [
        "Proc 2#** Procedure research &",
        "wheelm0.1",
        "Inferred support: confidence percentage parser fragment.",
      ],
      yourOptions: ["Request the missing supporting documentation or a written estimate explanation."],
      bottomLine: "Runtime immutable evidence chain should not appear.",
    },
    vehicle: "2024 Jeep Gladiator Sport 4WD",
    vin: null,
    insurer: null,
    mileage: "17,563",
    estimateTotal: "$16,200.00",
    findingReasoning: [
      {
        issue: "Hidden Mounting Geometry Teardown Growth",
        what_proves_it: "evidence chain cmox-1",
        why_it_matters: "support basis says documented evidence at 86% confidence",
        next_action: "Request the missing supporting documentation or a written estimate explanation",
        evidenceLevel: "supported",
        supportConfidenceIndicator: "high",
        claimSpecificity: "high",
        confidence: 0.86,
        leverageScore: 82,
      },
    ],
  });

  const text = flattenCarrierDocument(document);
  assert.equal(document.sections.map((section) => section.title.replace(/\.$/, "")).join("|"),
    "What We Found|Why The Shop Estimate Looks More Complete|Why The Insurance Estimate May Be Missing Items|What Still Needs To Be Verified|Why This Matters For Safety And Repair Quality|What You Can Ask For|What Happens Next|Bottom Line"
  );
  assert.equal(
    text.includes("Hidden mounting or structural damage is not verified from the reviewed file"),
    true
  );
  assert.ok(/CCC Secure Share source confirms this estimate line was present in the structured estimate data\.?/i.test(text));
  assertNoCustomerDebugText(text);
});

run("collision snapshot strips internal IDs and malformed parsed line fragments", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const renderModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  renderModel.findingReasoning = [
    {
      issue: "Hidden Mounting Geometry Teardown Growth evidence chain cmox-123",
      what_proves_it: "Proc 2#** Procedure research &",
      why_it_matters: "Documented evidence at 86% confidence. Support basis immutable runtime.",
      next_action: "Request the missing supporting documentation or a written estimate explanation",
      evidenceLevel: "supported",
      supportConfidenceIndicator: "high",
      claimSpecificity: "high",
      confidence: 0.86,
      leverageScore: 90,
    },
    {
      issue: "wheelm0.1",
      what_proves_it: "parser fragment",
      why_it_matters: "parser fragment",
      next_action: "parser fragment",
      evidenceLevel: "inferred",
      supportConfidenceIndicator: "low",
      claimSpecificity: "low",
      confidence: 0.2,
      leverageScore: 10,
    },
  ];
  const snapshot = buildCollisionSnapshot(renderModel);
  const text = flattenSnapshot(snapshot);

  assert.equal(
    snapshot.topDisputeItems[0].evidenceState,
    "The current file points to this concern and it should be confirmed during repair review."
  );
  assert.equal(
    snapshot.topDisputeItems[0].nextAction,
    "Ask the insurer or repair shop to explain whether this item is included, and if not, why."
  );
  assertNoCustomerDebugText(text);
});

run("customer report HTML strips forbidden customer-facing debug terms", () => {
  const html = renderCustomerReportHtml({
    report: {
      title: "Customer Report",
      openingSummary: "Support: Verified. Evidence references cmox-77 and documented evidence at 86% confidence should not appear.",
      whichRepairPlanLooksStronger: "Risk if omitted: parser fragment wheelm0.1 Proc 2#** should be removed.",
      safetyFirst: "ADAS Calibration Procedure Support should be translated to plain English.",
      whatStillNeedsProof: ["Support basis: runtime immutable parser fragment"],
      yourOptions: ["Inferred support should not appear in customer output."],
      bottomLine: "cmox-1 runtime immutable support basis",
    },
    vehicle: "2024 Jeep Gladiator Sport 4WD",
    generatedAt: "May 8, 2026",
  });

  assert.equal(
    html.includes("Scan and calibration documentation is not verified from the reviewed file"),
    true
  );
  assertNoCustomerDebugText(html);
});

run("snapshot PDF omits confidence labels and forbidden debug text", () => {
  const report = makeReport();
  const analysis = normalizeReportToAnalysisResult(report);
  const renderModel = buildExportModel({
    report,
    analysis,
    panel: null,
    assistantAnalysis: null,
  });
  renderModel.findingReasoning = [
    {
      issue: "Hidden Mounting Geometry Teardown Growth evidence chain cmox-123",
      what_proves_it: "Proc 2#** Procedure research &",
      why_it_matters: "Documented evidence at 86% confidence. Support: Verified.",
      next_action: "Request the missing supporting documentation or a written estimate explanation",
      evidenceLevel: "supported",
      supportConfidenceIndicator: "high",
      claimSpecificity: "high",
      confidence: 0.86,
      leverageScore: 90,
    },
  ];

  const document = buildCollisionSnapshotPdfFromSnapshot(buildCollisionSnapshot(renderModel));
  const text = flattenCarrierDocument(document);

  assert.equal(text.includes("File Coverage"), true);
  assert.equal(text.includes("Adjusted Confidence"), false);
  assert.equal(/Confidence:/i.test(text), false);
  assertNoCustomerDebugText(text);
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
  assert.match(carrier.summary.find((item) => item.label === "VIN")?.value ?? "", /^(?:5YJSA1E21JF264319)?$/);
  assert.equal(carrier.summary.find((item) => item.label === "Insurer")?.value, "[REDACTED_INSURER]");
  assert.equal(carrier.summary.find((item) => item.label === "Mileage")?.value, "173,702");
  assert.equal(carrier.summary.find((item) => item.label === "Estimate Total")?.value, "$19,428.53");
  const carrierText = flattenCarrierDocument(carrier);
  assert.equal(
    /cavity wax/i.test(carrierText),
    true
  );
  assert.equal(
    /post-repair scan/i.test(carrierText),
    true
  );
  assert.equal(
    /final road test/i.test(carrierText),
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
    disputeIntelligence.summary.find((item) => item.label === "VIN")?.value ? "5YJSA1E21JF264319" : ""
  );
  assert.equal(rebuttal.summary.find((item) => item.label === "Vehicle")?.value, "2018 Tesla Model S 75D AWD");
  assert.match(rebuttal.summary.find((item) => item.label === "VIN")?.value ?? "", /^(?:5YJSA1E21JF264319)?$/);
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
  assert.equal(disputeIntelligence.header.title, "Repair Intelligence Report");
  assert.equal(
    disputeIntelligence.sections.some((section) =>
      section.title === "Top Dispute Drivers"
    ),
    true
  );
  assert.equal(
    disputeIntelligence.sections.some((section) =>
      /recommended|next|action/i.test(`${section.title} ${(section.body ?? "")} ${(section.bullets ?? []).join(" ")}`)
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
  assert.match(carrier.summary.find((item) => item.label === "VIN")?.value ?? "", new RegExp(`^(?:${renderModel.reportFields.vin})?$`));
  assert.equal(carrier.summary.find((item) => item.label === "Insurer")?.value, "[REDACTED_INSURER]");
  assert.equal(
    disputeIntelligence.summary.find((item) => item.label === "Vehicle")?.value,
    renderModel.reportFields.vehicleLabel
  );
  assert.equal(
    disputeIntelligence.summary.find((item) => item.label === "VIN")?.value,
    disputeIntelligence.summary.find((item) => item.label === "VIN")?.value ? renderModel.reportFields.vin : ""
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

run("malformed parser fragments are not used as top dispute drivers", () => {
  const report = makeReport();
  report.issues = [
    {
      id: "junk-1",
      category: "documentation",
      title: "wheelm0.1",
      finding: "wheelm0.1",
      impact: "Parser fragment should not become a dispute driver.",
      missingOperation: "wheelm0.1",
      severity: "high",
      evidenceIds: [],
    },
    {
      id: "junk-2",
      category: "documentation",
      title: "Proc 2 #** Procedure research &",
      finding: "Proc 2 #** Procedure research &",
      impact: "Parser fragment should not become a dispute driver.",
      missingOperation: "Proc 2 #** Procedure research &",
      severity: "high",
      evidenceIds: [],
    },
  ];
  report.supplementOpportunities = [];

  const exportModel = buildExportModel({
    report,
    analysis: normalizeReportToAnalysisResult(report),
    panel: null,
    assistantAnalysis: null,
  });
  const topDriverText = JSON.stringify(exportModel.disputeIntelligenceReport.topDrivers);

  assert.doesNotMatch(topDriverText, /\bwheelm\d+(?:\.\d+)?\b/i);
  assert.doesNotMatch(topDriverText, /\bProc\s*\d+\s*#?\s*\*+/i);
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

run("21975-style estimate export prioritizes line-specific dispute precision", () => {
  const report = makeReport();
  report.issues = [];
  report.requiredProcedures = [];
  report.evidence = [
    {
      id: "evidence-21975",
      title: "Shop 21975 and SOR-1 21975 estimates",
      snippet: SHOP_21975_COMPARISON_TEXT,
      source: "current upload estimates",
      authority: "inferred",
    },
  ];
  report.sourceEstimateText = SHOP_21975_COMPARISON_TEXT;
  report.findingReasoning = [
    {
      issue: "Documents Describe Repair Process Differently",
      why_it_matters: "Generic wording should not lead the export.",
      what_proves_it: "The documents differ.",
      next_action: "Review both estimates.",
      evidenceLevel: "estimate",
      confidence: 0.5,
      claimSpecificity: "generic",
      leverageScore: 999,
    },
  ];
  report.missingProcedures = ["Structural Measurement Verification"];
  report.supplementOpportunities = [
    "park park park sensor bezel front",
    "park sensor1ew63tzzaa1361.000.20.0",
  ];

  const exportModel = buildExportModel({
    report,
    analysis: normalizeReportToAnalysisResult(report),
    panel: null,
    assistantAnalysis: null,
  });
  const driverText = JSON.stringify(exportModel.disputeIntelligenceReport.topDrivers);
  const findingText = JSON.stringify(exportModel.findingReasoning);
  const snapshotText = flattenSnapshot(buildCollisionSnapshot(exportModel));

  assert.match(driverText, /LKQ Grille Style Contradiction/i);
  assert.match(driverText, /A[\/ ]M CAPA LKQ Substitutions/i);
  assert.match(driverText, /Labor Rate and Paint-Material Delta/i);
  assert.match(findingText, /LKQ grille style contradiction/i);
  assert.doesNotMatch(findingText, /Documents Describe Repair Process Differently/i);
  assert.doesNotMatch(driverText, /Structural Measurement Verification/i);
  assert.doesNotMatch(snapshotText, /Documents Describe Repair Process Differently|park park park|sensor1ew63/i);
  assert.match(snapshotText, /LKQ grille style contradiction/i);
});

run("customer report keeps 21975 estimate framing nuanced and grammatically clean", () => {
  const document = buildCustomerReportPdf({
    report: {
      title: "Customer Report",
      openingSummary: "Both carrier area of damage is front end, but the the estimates use different pricing.",
      whichRepairPlanLooksStronger:
        "The shop is always more complete and the carrier is missing everything. Continue documentation any added findings.",
      safetyFirst: "Review LKQ grille not correct style, A/M CAPA parts, paint supplies, REVVAdas, and seat belt dynamic function test.",
      whatStillNeedsProof: ["continue documentation any added findings"],
      yourOptions: ["Ask about the LKQ grille not correct style note."],
      bottomLine: "Repair completion status is not established from the reviewed file.",
    },
    vehicle: "Vehicle",
    findingReasoning: [
      {
        issue: "LKQ grille style contradiction",
        why_it_matters: "Carrier note says LKQ grille is not correct style.",
        what_proves_it: "Line 23 LKQ grille note.",
        next_action: "Ask the carrier to address the style note.",
        evidenceLevel: "estimate",
        confidence: 0.9,
        claimSpecificity: "claim_specific",
        leverageScore: 980,
      },
    ],
  });
  const text = flattenCarrierDocument(document);

  assert.match(text, /shop estimate is broader on OEM-style front-end parts/i);
  assert.match(text, /strongest line-specific concern is the carrier note that the LKQ grille is not the correct style/i);
  assert.doesNotMatch(text, /but the the|Both carrier area of damage|continue documentation any added findings/i);
  assert.match(text, /continue documenting any added findings/i);
});

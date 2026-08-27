"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const vehicleIdentityFixture_json_1 = __importDefault(require("./fixtures/vehicleIdentityFixture.json"));
const teslaCccNoteRegressionFixture_json_1 = __importDefault(require("./fixtures/teslaCccNoteRegressionFixture.json"));
const vinFooterTimestampRegressionFixture_json_1 = __importDefault(require("./fixtures/vinFooterTimestampRegressionFixture.json"));
const vinHeaderNoiseFixture_json_1 = __importDefault(require("./fixtures/vinHeaderNoiseFixture.json"));
const vehicleNoVinFallbackFixture_json_1 = __importDefault(require("./fixtures/vehicleNoVinFallbackFixture.json"));
const buildExportModel_1 = require("../builders/buildExportModel");
const carrierPdfBuilder_1 = require("../builders/carrierPdfBuilder");
const driveRetrievalContract_1 = require("../contracts/driveRetrievalContract");
const normalizeReportToAnalysisResult_1 = require("../builders/normalizeReportToAnalysisResult");
const vehicleContext_1 = require("../vehicleContext");
const structuredFixtureVehicle = vehicleIdentityFixture_json_1.default.structuredVehicle;
function runTest(name, fn) {
    try {
        fn();
        console.info(`PASS ${name}`);
    }
    catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}
function assertIncludesAll(actual, expected) {
    for (const value of expected) {
        strict_1.default.equal(actual?.includes(value), true, `Expected sourceSummary to include ${value}`);
    }
}
function makeReport(overrides) {
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
    const validated = {
        ...structuredFixtureVehicle,
        fieldSources: {
            vin: "vin_decoded",
            year: "attachment",
            make: "attachment",
            model: "attachment",
        },
    };
    const noisyOcr = {
        vin: "3MW89FF07R8E75553",
        source: "attachment",
        confidence: 0.99,
    };
    strict_1.default.equal((0, vehicleContext_1.normalizeVin)(vehicleIdentityFixture_json_1.default.vin), vehicleIdentityFixture_json_1.default.vin);
    strict_1.default.equal((0, vehicleContext_1.validateVinChecksum)(vehicleIdentityFixture_json_1.default.vin), true);
    strict_1.default.equal((0, vehicleContext_1.validateVinChecksum)(noisyOcr.vin), false);
    strict_1.default.equal((0, vehicleContext_1.isBetterVinCandidate)(noisyOcr, validated), false);
    const resolved = (0, vehicleContext_1.resolveVehicleIdentity)(validated, noisyOcr);
    strict_1.default.equal(resolved.vin, vehicleIdentityFixture_json_1.default.vin);
    assertIncludesAll(resolved.sourceSummary, ["vin_backed_decode"]);
});
runTest("labeled VIN outranks nearby 17-char header identifiers", () => {
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)(vinHeaderNoiseFixture_json_1.default.text, "attachment");
    strict_1.default.equal(extracted?.vin, vinHeaderNoiseFixture_json_1.default.vin);
    strict_1.default.equal(extracted?.year, 2024);
    strict_1.default.equal(extracted?.make, "BMW");
});
runTest("footer timestamp furniture cannot become canonical VIN", () => {
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)(vinFooterTimestampRegressionFixture_json_1.default.text, "attachment");
    strict_1.default.equal((0, vehicleContext_1.normalizeVin)(vinFooterTimestampRegressionFixture_json_1.default.falseVin), undefined);
    strict_1.default.equal(extracted?.vin, vinFooterTimestampRegressionFixture_json_1.default.vin);
});
runTest("explicit labeled VIN beats synthetic PANEL mashup", () => {
    const bmwCaseText = [
        "Vehicle Description: 2024 BMW X5 xDrive40i Sports Activity Vehicle",
        "VIN: WB523CF05RCN81298",
        "PANEL517179320720",
        "Part Number 517179320720",
        "Qty 0.2 Labor 1.0 Paint 0.5",
    ].join("\n");
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)(bmwCaseText, "attachment");
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
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    strict_1.default.equal(extracted?.vin, "WB523CF05RCN81298");
    strict_1.default.equal(extracted?.year, 2024);
    strict_1.default.equal(extracted?.make, "BMW");
    strict_1.default.equal(exportModel.vehicle.vin, "WB523CF05RCN81298");
    strict_1.default.notEqual(exportModel.vehicle.vin, "PANEL517179320720");
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "WB523CF05RCN81298");
});
runTest("fake PANEL517179320720 is rejected", () => {
    strict_1.default.equal((0, vehicleContext_1.normalizeVin)("PANEL517179320720"), undefined);
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)([
        "Part Number PANEL517179320720",
        "Panel 517179320720",
        "Qty 0.2 Labor 1.0 Paint 0.5",
    ].join("\n"), "attachment");
    strict_1.default.equal(extracted?.vin, undefined);
});
runTest("if only noisy OCR-shaped candidate exists VIN resolves to null", () => {
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)([
        "Vehicle Description: 2022 BMW X7 xDrive40i Sports Activity Vehicle",
        "PANEL517179320720",
        "Part Number 517179320720",
        "Qty 0.2 Labor 1.0 Paint 0.5",
    ].join("\n"), "attachment");
    strict_1.default.equal(extracted?.vin, undefined);
    strict_1.default.equal(extracted?.make, "BMW");
    strict_1.default.equal(extracted?.model, "X7 xDrive40i");
});
runTest("blacklisted header labels cannot become VIN candidates", () => {
    const headerOnly = (0, vehicleContext_1.extractVehicleIdentityFromText)([
        "Workfile ID: WRKF1LE1D12345678",
        "Federal ID: FEDRL12345678901",
        "Claim #: CLM123456789ABCDE",
        "RO #: RR123456789ABCDEF",
    ].join("\n"), "attachment");
    strict_1.default.equal(headerOnly?.vin, undefined);
});
runTest("invalid OCR VIN cannot replace a validated VIN", () => {
    const current = {
        vin: vehicleIdentityFixture_json_1.default.vin,
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
    const invalidOcr = {
        vin: "VIN UNSPECIFIED",
        source: "attachment",
        confidence: 1,
    };
    strict_1.default.equal((0, vehicleContext_1.normalizeVin)(invalidOcr.vin), undefined);
    strict_1.default.equal((0, vehicleContext_1.isBetterVinCandidate)(invalidOcr, current), false);
    strict_1.default.equal((0, vehicleContext_1.resolveVehicleIdentity)(current, invalidOcr).vin, vehicleIdentityFixture_json_1.default.vin);
});
runTest("structured year/make/model beats raw vehicle text", () => {
    const structured = {
        year: 2024,
        make: "BMW",
        model: "330i",
        source: "attachment",
        confidence: 0.92,
    };
    const rawTextLike = {
        make: "Vehicle Description Unspecified",
        model: "OCR Label",
        source: "attachment",
        confidence: 0.95,
    };
    strict_1.default.equal((0, vehicleContext_1.isBetterVehicleCandidate)(structured, rawTextLike), true);
    strict_1.default.equal((0, vehicleContext_1.resolveVehicleIdentity)(rawTextLike, structured).display, vehicleIdentityFixture_json_1.default.expectedDisplay);
});
runTest("explicit header beats later CCC closest-like-kind-quality note", () => {
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)(teslaCccNoteRegressionFixture_json_1.default.combinedText, "attachment");
    strict_1.default.equal(extracted?.vin, teslaCccNoteRegressionFixture_json_1.default.vin);
    strict_1.default.equal(extracted?.year, 2025);
    strict_1.default.equal(extracted?.make, "Tesla");
    strict_1.default.equal(extracted?.model, "Model 3");
    strict_1.default.equal(extracted?.trim, teslaCccNoteRegressionFixture_json_1.default.expectedTrim);
    strict_1.default.equal(extracted?.sourceQuality, "explicit_header");
});
runTest("final resolved vehicle stays on explicit Tesla header across export and PDF", () => {
    const headerVehicle = (0, vehicleContext_1.extractVehicleIdentityFromText)(teslaCccNoteRegressionFixture_json_1.default.headerText, "attachment");
    const noteVehicle = (0, vehicleContext_1.extractVehicleIdentityFromText)(teslaCccNoteRegressionFixture_json_1.default.noteText, "attachment");
    const report = makeReport({
        vehicle: (0, vehicleContext_1.resolveVehicleIdentity)(headerVehicle, noteVehicle).identity,
        evidence: [
            {
                id: "tesla-evidence-1",
                title: "Estimate Page 1",
                snippet: teslaCccNoteRegressionFixture_json_1.default.combinedText,
                source: "estimate-page-1.pdf",
                authority: "inferred",
            },
        ],
    });
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const chatVehicle = (0, driveRetrievalContract_1.inferDriveVehicleContext)({
        estimateText: teslaCccNoteRegressionFixture_json_1.default.combinedText,
        analysisVehicle: {
            ...headerVehicle,
            source: "attachment",
            confidence: headerVehicle?.confidence ?? 0.98,
        },
        userQuery: `Review this 2025 Tesla Model 3 Standard RWD. VIN: ${teslaCccNoteRegressionFixture_json_1.default.vin}`,
    });
    strict_1.default.equal(exportModel.vehicle.vin, teslaCccNoteRegressionFixture_json_1.default.vin);
    strict_1.default.equal(exportModel.vehicle.display, teslaCccNoteRegressionFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(exportModel.vehicle.vehicleDisplay, teslaCccNoteRegressionFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(exportModel.vehicle.trim, teslaCccNoteRegressionFixture_json_1.default.expectedTrim);
    assertIncludesAll(exportModel.vehicle.sourceSummary, ["explicit_vehicle_block", "vin_backed_decode"]);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, teslaCccNoteRegressionFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, teslaCccNoteRegressionFixture_json_1.default.vin);
    strict_1.default.equal(chatVehicle.year, 2025);
    strict_1.default.equal(chatVehicle.model, "Model 3");
    strict_1.default.equal(chatVehicle.trim, teslaCccNoteRegressionFixture_json_1.default.expectedTrim);
});
runTest("decoded vehicle survives export builder and report render path", () => {
    const report = makeReport({
        vehicle: structuredFixtureVehicle,
        evidence: [
            {
                id: "evidence-1",
                title: "Estimate OCR",
                snippet: vehicleIdentityFixture_json_1.default.estimateText,
                source: "estimate.pdf",
                authority: "inferred",
            },
        ],
        recommendedActions: ["Repair plan remains supportable."],
    });
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: "Vehicle identity confirmed from estimate support.",
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: "Vehicle identity confirmed from estimate support.",
    });
    strict_1.default.equal(exportModel.vehicle.display, vehicleIdentityFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(exportModel.vehicle.vehicleDisplay, vehicleIdentityFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(exportModel.vehicle.vin, vehicleIdentityFixture_json_1.default.vin);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, vehicleIdentityFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, vehicleIdentityFixture_json_1.default.vin);
});
runTest("footer false VIN never propagates into export or PDF", () => {
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)(vinFooterTimestampRegressionFixture_json_1.default.text, "attachment");
    const report = makeReport({
        vehicle: extracted ?? undefined,
        evidence: [
            {
                id: "footer-vin-evidence-1",
                title: "Estimate Page 1",
                snippet: vinFooterTimestampRegressionFixture_json_1.default.text,
                source: "estimate-page-1.pdf",
                authority: "inferred",
            },
        ],
    });
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const chatVehicle = (0, driveRetrievalContract_1.inferDriveVehicleContext)({
        estimateText: vinFooterTimestampRegressionFixture_json_1.default.text,
        userQuery: `VIN: ${vinFooterTimestampRegressionFixture_json_1.default.vin}`,
        analysisVehicle: extracted
            ? {
                ...extracted,
                source: "attachment",
                confidence: extracted.confidence ?? 0.98,
            }
            : null,
    });
    strict_1.default.equal(exportModel.vehicle.vin, vinFooterTimestampRegressionFixture_json_1.default.vin);
    strict_1.default.notEqual(exportModel.vehicle.vin, vinFooterTimestampRegressionFixture_json_1.default.falseVin);
    assertIncludesAll(exportModel.vehicle.sourceSummary, ["vin_backed_decode"]);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, vinFooterTimestampRegressionFixture_json_1.default.vin);
    strict_1.default.equal(chatVehicle.vin, vinFooterTimestampRegressionFixture_json_1.default.vin);
});
runTest("chat, right rail, and export stay aligned on the same resolved identity", () => {
    const report = makeReport({
        vehicle: structuredFixtureVehicle,
        evidence: [
            {
                id: "evidence-1",
                title: "Estimate OCR",
                snippet: vehicleIdentityFixture_json_1.default.estimateText,
                source: "estimate.pdf",
                authority: "inferred",
            },
        ],
    });
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const chatVehicle = (0, driveRetrievalContract_1.inferDriveVehicleContext)({
        estimateText: vehicleIdentityFixture_json_1.default.estimateText,
        userQuery: `Need help on this ${vehicleIdentityFixture_json_1.default.expectedDisplay}. VIN: ${vehicleIdentityFixture_json_1.default.vin}`,
        analysisVehicle: {
            ...structuredFixtureVehicle,
            source: "attachment",
            confidence: structuredFixtureVehicle.confidence ?? 0.98,
        },
    });
    strict_1.default.equal(exportModel.vehicle.display, vehicleIdentityFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(exportModel.vehicle.label, vehicleIdentityFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(chatVehicle.vin, exportModel.vehicle.vin);
    strict_1.default.equal(chatVehicle.year, exportModel.vehicle.year);
    strict_1.default.equal(chatVehicle.make, exportModel.vehicle.make);
    strict_1.default.equal(chatVehicle.model, exportModel.vehicle.model);
});
runTest("export and PDF preserve canonical structured vehicle against noisy evidence text", () => {
    const canonicalVehicle = {
        vin: vehicleIdentityFixture_json_1.default.vin,
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
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    strict_1.default.equal(exportModel.vehicle.display, vehicleIdentityFixture_json_1.default.expectedDisplay);
    strict_1.default.notEqual(exportModel.vehicle.display, "Unspecified");
    strict_1.default.equal(exportModel.vehicle.vin, vehicleIdentityFixture_json_1.default.vin);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, vehicleIdentityFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, vehicleIdentityFixture_json_1.default.vin);
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
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    strict_1.default.equal(analysis.vehicle?.vin, "WB523CF05RCN81298");
    strict_1.default.equal(analysis.vehicle?.trim, "50 Sports Activity");
    strict_1.default.equal(exportModel.vehicle.vin, "WB523CF05RCN81298");
    strict_1.default.equal(exportModel.vehicle.display, "2024 BMW iX xDrive");
    strict_1.default.equal(exportModel.vehicle.trim, "50 Sports Activity");
    strict_1.default.equal(exportModel.vehicle.confidence, "supported");
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "WB523CF05RCN81298");
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
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    strict_1.default.equal(analysis.vehicle?.vin, "WB523CF05RCN81298");
    strict_1.default.equal(report.analysis?.vehicle?.vin, "WB523CF05RCN81298");
    strict_1.default.equal(exportModel.vehicle.vin, "WB523CF05RCN81298");
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "WB523CF05RCN81298");
    strict_1.default.equal(exportModel.vehicle.display, "2024 BMW iX xDrive");
    strict_1.default.equal(exportModel.vehicle.trim, "50 Sports Activity");
});
runTest("export and PDF do not downgrade supported canonical vehicle when evidence is noisy", () => {
    const canonicalVehicle = {
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
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const expectedDisplay = (0, vehicleContext_1.resolveVehicleIdentity)(canonicalVehicle).display;
    strict_1.default.notEqual(expectedDisplay, "Unspecified");
    strict_1.default.equal(exportModel.vehicle.display, expectedDisplay);
    strict_1.default.equal(exportModel.vehicle.vin, canonicalVehicle.vin);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, expectedDisplay);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, canonicalVehicle.vin);
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
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    strict_1.default.equal(exportModel.vehicle.vin, undefined);
});
runTest("safe fallback keeps vehicle when VIN is not clearly supported", () => {
    const extracted = (0, vehicleContext_1.extractVehicleIdentityFromText)(vehicleNoVinFallbackFixture_json_1.default.text, "attachment");
    const report = makeReport({
        vehicle: extracted ?? undefined,
        evidence: [
            {
                id: "fallback-evidence-1",
                title: "Estimate Page 1",
                snippet: vehicleNoVinFallbackFixture_json_1.default.text,
                source: "estimate-page-1.pdf",
                authority: "inferred",
            },
        ],
    });
    const analysis = (0, normalizeReportToAnalysisResult_1.normalizeReportToAnalysisResult)(report);
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report,
        analysis,
        panel: null,
        assistantAnalysis: null,
    });
    const chatVehicle = (0, driveRetrievalContract_1.inferDriveVehicleContext)({
        estimateText: vehicleNoVinFallbackFixture_json_1.default.text,
        userQuery: "Review this 2024 Honda Civic LX estimate",
        analysisVehicle: extracted
            ? {
                ...extracted,
                source: "attachment",
                confidence: extracted.confidence ?? 0.8,
            }
            : null,
    });
    strict_1.default.equal(exportModel.vehicle.vin, undefined);
    strict_1.default.equal(exportModel.vehicle.display, vehicleNoVinFallbackFixture_json_1.default.expectedDisplay);
    strict_1.default.notEqual(exportModel.vehicle.display, "Unspecified");
    strict_1.default.equal(exportModel.vehicle.trim, vehicleNoVinFallbackFixture_json_1.default.expectedTrim);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, vehicleNoVinFallbackFixture_json_1.default.expectedDisplay);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "Unspecified");
    strict_1.default.equal(chatVehicle.make, "BMW");
    strict_1.default.equal(chatVehicle.model, "X7 xDrive40i");
    strict_1.default.equal(chatVehicle.trim, vehicleNoVinFallbackFixture_json_1.default.expectedTrim);
});
runTest("no-data case still falls back safely to Unspecified", () => {
    const exportModel = (0, buildExportModel_1.buildExportModel)({
        report: makeReport(),
        analysis: null,
        panel: null,
        assistantAnalysis: null,
    });
    const pdf = (0, carrierPdfBuilder_1.buildCarrierReport)({
        report: makeReport(),
        analysis: null,
        panel: null,
        assistantAnalysis: null,
    });
    strict_1.default.equal(exportModel.vehicle.display, "Unspecified");
    strict_1.default.equal(exportModel.vehicle.vin, undefined);
    strict_1.default.equal(pdf.summary.find((item) => item.label === "Vehicle")?.value, "Unspecified");
    strict_1.default.equal(pdf.summary.find((item) => item.label === "VIN")?.value, "Unspecified");
});

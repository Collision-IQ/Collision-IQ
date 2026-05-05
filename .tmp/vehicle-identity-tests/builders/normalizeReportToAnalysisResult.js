"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeReportToAnalysisResult = normalizeReportToAnalysisResult;
const extractEstimateFacts_1 = require("../extractors/extractEstimateFacts");
const vehicleContext_1 = require("../vehicleContext");
const safeVehicleLog_1 = require("../safeVehicleLog");
function normalizeReportToAnalysisResult(report) {
    const estimateEvidenceText = collectHighSignalVehicleEvidenceText(report);
    const structuredVehicle = (0, vehicleContext_1.mergeVehicleIdentity)((0, vehicleContext_1.normalizeVehicleIdentity)(report.analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(report.vehicle));
    const inferredVehicle = (0, vehicleContext_1.extractVehicleIdentityFromText)([
        estimateEvidenceText,
        report.vehicle?.vin,
        report.analysis?.vehicle?.vin,
    ]
        .filter(Boolean)
        .join("\n\n"), "attachment");
    const guardedInferredVehicle = preserveStructuredDescriptors(structuredVehicle, inferredVehicle);
    const normalizedVehicle = (0, vehicleContext_1.mergeVehicleIdentity)(structuredVehicle, guardedInferredVehicle);
    const estimateFacts = mergeEstimateFacts(report.estimateFacts, report.analysis?.estimateFacts, (0, extractEstimateFacts_1.extractEstimateFacts)({
        text: estimateEvidenceText,
        vehicle: normalizedVehicle,
    }));
    console.info("[vehicle-label-trace:raw-extraction]", {
        reportVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)((0, vehicleContext_1.normalizeVehicleIdentity)(report.vehicle)),
        analysisVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)((0, vehicleContext_1.normalizeVehicleIdentity)(report.analysis?.vehicle)),
        extractedFromEstimateText: (0, safeVehicleLog_1.summarizeVehicleForLog)((0, vehicleContext_1.normalizeVehicleIdentity)(inferredVehicle)),
        estimateEvidenceText: (0, safeVehicleLog_1.summarizeTextMetadataForLog)(estimateEvidenceText),
    });
    console.info("[vehicle-label-trace:normalized-analysis]", {
        structuredVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(structuredVehicle),
        guardedInferredVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(guardedInferredVehicle),
        normalizedVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(normalizedVehicle),
    });
    if (report.analysis) {
        return {
            ...report.analysis,
            vehicle: normalizedVehicle,
            rawEstimateText: report.analysis.rawEstimateText || estimateEvidenceText,
            estimateFacts: {
                ...estimateFacts,
                vehicle: estimateFacts.vehicle ?? normalizedVehicle,
            },
        };
    }
    const findings = [
        ...report.issues.map((issue, index) => {
            const bucket = issue.category === "parts"
                ? "parts"
                : issue.category === "calibration" || issue.category === "scan"
                    ? "adas"
                    : issue.category === "safety"
                        ? "critical"
                        : "compliance";
            const status = issue.missingOperation
                ? "not_detected"
                : "unclear";
            return {
                id: issue.id || `report-issue-${index + 1}`,
                bucket,
                category: issue.category,
                title: issue.title,
                detail: issue.impact || issue.finding,
                severity: issue.severity,
                status,
                evidence: [],
            };
        }),
        ...report.missingProcedures.map((procedure, index) => ({
            id: `report-missing-${index + 1}`,
            bucket: "supplement",
            category: "missing_procedure",
            title: procedure,
            detail: "This function is not clearly represented in the current file and remains open to further documentation.",
            severity: "medium",
            status: "not_detected",
            evidence: [],
        })),
    ];
    return {
        mode: "single-document-review",
        parserStatus: "ok",
        summary: {
            riskScore: report.summary.riskScore,
            confidence: report.summary.confidence,
            criticalIssues: report.summary.criticalIssues,
            evidenceQuality: report.summary.evidenceQuality,
        },
        findings,
        supplements: findings.filter((finding) => finding.bucket === "supplement"),
        evidence: report.evidence.map((entry) => ({
            source: entry.source,
            quote: entry.snippet,
        })),
        operations: [],
        rawEstimateText: estimateEvidenceText,
        narrative: report.recommendedActions[0] ||
            "The estimate needs clearer repair support before it can be treated as fully defended.",
        vehicle: normalizedVehicle,
        estimateFacts: {
            ...estimateFacts,
            vehicle: estimateFacts.vehicle ?? normalizedVehicle,
        },
    };
}
function preserveStructuredDescriptors(structuredVehicle, inferredVehicle) {
    const normalizedInferred = (0, vehicleContext_1.normalizeVehicleIdentity)(inferredVehicle);
    if (!normalizedInferred) {
        return normalizedInferred;
    }
    const structuredHasProtectedVinFields = Boolean(structuredVehicle?.vin &&
        (structuredVehicle.fieldSources?.vin === "vin_decoded" ||
            structuredVehicle.fieldSources?.year === "vin_decoded" ||
            structuredVehicle.fieldSources?.make === "vin_decoded" ||
            structuredVehicle.fieldSources?.manufacturer === "vin_decoded" ||
            structuredVehicle.source === "vin_decoded"));
    const structuredHasValidatedDescriptors = Boolean((structuredVehicle?.model || structuredVehicle?.trim) &&
        (structuredHasProtectedVinFields ||
            structuredVehicle?.fieldSources?.model === "attachment" ||
            structuredVehicle?.fieldSources?.model === "user" ||
            structuredVehicle?.fieldSources?.model === "session" ||
            structuredVehicle?.fieldSources?.trim === "attachment" ||
            structuredVehicle?.fieldSources?.trim === "user" ||
            structuredVehicle?.fieldSources?.trim === "session"));
    if (!structuredHasProtectedVinFields && !structuredHasValidatedDescriptors) {
        return normalizedInferred;
    }
    // Structured descriptors that are already supported should win; inference only fills gaps.
    return {
        ...normalizedInferred,
        model: structuredVehicle?.model ?? normalizedInferred.model,
        trim: structuredVehicle?.trim ?? normalizedInferred.trim,
    };
}
function collectHighSignalVehicleEvidenceText(report) {
    return [
        report.sourceEstimateText,
        report.estimateFacts?.documentedProcedures?.join("\n"),
        report.estimateFacts?.documentedHighlights?.join("\n"),
        report.estimateFacts?.vehicle?.vin,
        report.estimateFacts?.insurer,
        extractEstimateEvidenceText(report.evidence),
        report.analysis?.rawEstimateText,
        report.vehicle?.vin,
        report.analysis?.vehicle?.vin,
    ]
        .filter(Boolean)
        .join("\n\n");
}
function mergeEstimateFacts(...candidates) {
    const normalized = candidates.filter(Boolean);
    if (normalized.length === 0) {
        return {
            documentedProcedures: [],
            documentedHighlights: [],
        };
    }
    return normalized.reduce((merged, current) => ({
        vehicle: (0, vehicleContext_1.mergeVehicleIdentity)(merged.vehicle, current?.vehicle),
        mileage: merged.mileage ?? current?.mileage,
        insurer: (0, extractEstimateFacts_1.resolveCanonicalInsurerCandidate)({ value: merged.insurer, source: "prior" }, { value: current?.insurer, source: "prior" }),
        estimateTotal: merged.estimateTotal ?? current?.estimateTotal,
        documentedProcedures: [
            ...new Set([...(merged.documentedProcedures ?? []), ...(current?.documentedProcedures ?? [])]),
        ],
        documentedHighlights: [
            ...new Set([...(merged.documentedHighlights ?? []), ...(current?.documentedHighlights ?? [])]),
        ],
    }), {
        documentedProcedures: [],
        documentedHighlights: [],
    });
}
function extractEstimateEvidenceText(evidence) {
    return evidence
        .filter((entry) => entry.authority !== "oem")
        .filter((entry) => !/^(OEM Procedures|OEM Position Statements|PA Law)\s*\//i.test(entry.source))
        .map((entry) => `${entry.title ?? ""}\n${entry.snippet ?? ""}`)
        .join("\n");
}

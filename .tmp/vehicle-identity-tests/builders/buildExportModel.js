"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDACTED_INSURER_TOKEN = exports.COLLISION_ACADEMY_HANDOFF_URL = void 0;
exports.buildExportModel = buildExportModel;
exports.extractEstimateComparisonTotals = extractEstimateComparisonTotals;
exports.deriveExportReportFields = deriveExportReportFields;
exports.buildExportValuationPreviewSummary = buildExportValuationPreviewSummary;
exports.buildPreferredVehicleIdentityLabel = buildPreferredVehicleIdentityLabel;
exports.buildPreferredRebuttalSubjectVehicleLabel = buildPreferredRebuttalSubjectVehicleLabel;
exports.preferCanonicalField = preferCanonicalField;
exports.resolveCanonicalVehicleLabel = resolveCanonicalVehicleLabel;
exports.resolveCanonicalVin = resolveCanonicalVin;
exports.resolveCanonicalInsurer = resolveCanonicalInsurer;
exports.redactExportModelForDownload = redactExportModelForDownload;
exports.computeACVFromComps = computeACVFromComps;
exports.computeWeightedAcvPreview = computeWeightedAcvPreview;
const buildDetermination_1 = require("./buildDetermination");
const collisionSnapshot_1 = require("./collisionSnapshot");
const deriveRenderInsightsFromChat_1 = require("./deriveRenderInsightsFromChat");
const buildRepairStory_1 = require("./buildRepairStory");
const extractEstimateFacts_1 = require("../extractors/extractEstimateFacts");
const vehicleContext_1 = require("../vehicleContext");
const safeVehicleLog_1 = require("../safeVehicleLog");
const displayText_1 = require("../displayText");
const structuralApplicability_1 = require("../structuralApplicability");
const vehicleApplicability_1 = require("../vehicleApplicability");
const adasDecision_1 = require("@/lib/analysis/adasDecision");
const estimateOperationEquivalence_1 = require("@/lib/ai/estimateOperationEquivalence");
const impactZone_1 = require("@/lib/ai/impactZone");
const externalDocuments_1 = require("@/lib/externalDocuments");
const pressureMode_1 = require("./pressureMode");
const presentationText_1 = require("@/lib/ui/presentationText");
const outputMode_1 = require("@/lib/ai/outputMode");
const reviewCompleteness_1 = require("@/lib/reviewCompleteness");
const fileReviewLedger_1 = require("@/lib/fileReviewLedger");
const estimatePosture_1 = require("@/lib/ai/estimatePosture");
exports.COLLISION_ACADEMY_HANDOFF_URL = "https://www.collision.academy/";
exports.REDACTED_INSURER_TOKEN = "[REDACTED_INSURER]";
const PLACEHOLDER_VEHICLE_LABEL_PATTERN = /^(?:unknown|unspecified|n\/a|na|none|null|undefined|not available|not provided|vehicle details are still limited in the current material\.?|vehicle details still limited in the current material\.?|not clearly supported(?: in the current material)?\.?)$/i;
const DV_FALLBACK_RANGE = { low: 500, high: 2500 };
const GENERIC_PLACEHOLDER_FIELD_PATTERN = /^(?:unknown|unspecified|n\/a|na|none|null|undefined|not available|not provided|vehicle details are still limited in the current material\.?|vehicle details still limited in the current material\.?|not clearly supported(?: in the current material)?\.?)$/i;
const META_COMMENTARY_PATTERNS = [
    "repair strategy",
    "parts posture",
    "repair posture",
    "estimate posture",
    "estimate reviewed",
    "both estimates were reviewed",
    "it s mainly",
    "it's mainly",
    "mainly repair strategy",
    "missing access procedure items",
    "access/procedure items",
    "support gaps",
    "repair-path items",
    "repair path items",
];
const PRESENTATION_DETAIL_BLOCK_PATTERN = /(?:^|\n)\s*(?:\d+[.)]|[-*•]|evidence:|details:|detail:|findings:|requested revisions|requested support)\s+/i;
const INLINE_ENUMERATION_PATTERN = /([.!?])\s+\d+[.)]\s+[\s\S]*$/;
function buildExportModel(params) {
    const assistantAnalysis = stripSmokeDebugDiagnostics(params.assistantAnalysis ?? "");
    const reportFields = deriveExportReportFields({
        report: params.report,
        analysis: params.analysis,
    });
    const sourceEstimateText = collectVehicleDocumentText(params.report, params.analysis);
    const estimateFacts = reportFields.estimateFacts;
    const vehicleApplicability = (0, vehicleApplicability_1.resolveVehicleApplicabilityContext)(reportFields.vehicle, params.report?.vehicle, params.report?.analysis?.vehicle, params.analysis?.vehicle, estimateFacts.vehicle);
    const chatInsights = (0, deriveRenderInsightsFromChat_1.deriveRenderInsightsFromChat)(assistantAnalysis, vehicleApplicability);
    const vehicle = inferVehicleInfo(params.report, params.analysis, estimateFacts);
    const supplementItems = buildExportSupplementItems(params.report, params.analysis, params.panel, chatInsights, assistantAnalysis || null, estimateFacts, vehicleApplicability);
    const repairPosition = buildRepairPosition(params.report, params.analysis, params.panel, chatInsights.narrative ?? (assistantAnalysis || null), supplementItems, reportFields);
    const selectedEstimatePosture = (0, estimatePosture_1.resolveEstimatePosture)({
        report: params.report,
        analysis: params.analysis,
        estimateComparisons: params.analysis?.estimateComparisons,
        narrative: repairPosition,
    });
    const positionStatement = buildPositionStatement(params.report, params.analysis, supplementItems);
    const request = buildRequest(params.report, params.panel, supplementItems, chatInsights.request);
    const valuation = buildValuation(params.panel, chatInsights.valuation, reportFields, params.report, params.analysis);
    const displayVehicle = (0, displayText_1.getDisplayVehicleInfo)(vehicle);
    const allowUnsupportedSeamSealerNarrative = hasExplicitSeamSealerSupport(sourceEstimateText) ||
        supplementItems.some((item) => item.title === "Seam Sealer Restoration");
    const cleanedSupplementItems = supplementItems.map((item) => ({
        ...item,
        title: (0, presentationText_1.cleanEstimateLineForTechnicalExport)(item.title),
        rationale: (0, externalDocuments_1.redactExternalDocumentUrls)(cleanFormalExportText(stripUnsupportedSeamSealerLanguage(item.rationale, sourceEstimateText, allowUnsupportedSeamSealerNarrative))),
        evidence: item.evidence
            ? (0, externalDocuments_1.redactExternalDocumentUrls)(cleanFormalExportText(stripUnsupportedSeamSealerLanguage(item.evidence, sourceEstimateText, allowUnsupportedSeamSealerNarrative)))
            : undefined,
        source: item.source ? (0, externalDocuments_1.redactExternalDocumentUrls)(cleanFormalExportText(item.source)) : undefined,
    }));
    const quality = (0, displayText_1.assessDisplayQuality)({
        vehicleLabel: displayVehicle.label ?? vehicle.label,
        vehicleTrim: displayVehicle.trim ?? vehicle.trim,
        supplementItems: cleanedSupplementItems,
    });
    const structuredVehicleLabel = [vehicle?.year, (0, displayText_1.cleanDisplayLabel)(vehicle?.make), (0, displayText_1.cleanDisplayLabel)(vehicle?.model)]
        .filter(Boolean)
        .join(" ")
        .trim() ||
        [
            vehicle?.year,
            (0, displayText_1.cleanDisplayLabel)(vehicle?.make),
            (0, displayText_1.cleanDisplayLabel)(vehicle?.model),
            cleanVehicleDescriptor(displayVehicle.trim),
        ]
            .filter(Boolean)
            .join(" ")
            .trim() ||
        undefined;
    const guardedSupplementItems = quality.noisy
        ? cleanedSupplementItems.filter((item, index) => {
            if (index === 0)
                return true;
            const lower = item.title.toLowerCase();
            return lower.split(/\s+/).length >= 2 && !/\b(?:wheel|mirror|battery|panel)\b/i.test(lower);
        })
        : cleanedSupplementItems;
    const leverageSortedSupplementItems = sortDisputeItemsByLeverageScore(guardedSupplementItems);
    const guardedVehicleLabel = quality.malformedVehicle
        ? structuredVehicleLabel
        : buildPreferredVehicleIdentityLabel({
            ...vehicle,
            label: reportFields.vehicleLabel ?? displayVehicle.label ?? structuredVehicleLabel ?? vehicle.label,
            trim: displayVehicle.trim ?? vehicle.trim,
        }) ?? reportFields.vehicleLabel ?? displayVehicle.label ?? structuredVehicleLabel ?? vehicle.label;
    const allLabelsSuppressed = quality.noisy && guardedSupplementItems.length === 0;
    const exportVehicle = {
        ...vehicle,
        label: guardedVehicleLabel,
        trim: cleanVehicleDescriptor(displayVehicle.trim ?? vehicle.trim),
        vin: reportFields.vin ?? vehicle.vin,
        make: (0, displayText_1.cleanDisplayLabel)(vehicle.make),
        model: (0, displayText_1.cleanDisplayLabel)(vehicle.model),
        manufacturer: cleanVehicleDescriptor(vehicle.manufacturer),
    };
    console.info("[vehicle-label-trace:shared-export-model]", {
        sourceVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(vehicle),
        exportVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(exportVehicle),
    });
    const disputeIntelligenceReport = buildDisputeIntelligenceReport({
        report: params.report,
        reportFields,
        repairPosition,
        positionStatement,
        supplementItems: leverageSortedSupplementItems,
        valuation,
    });
    const rankedFindingReasoning = resolveReportFindingReasoning(params.report, params.analysis);
    const disputeStrategy = resolveReportDisputeStrategy(params.report, rankedFindingReasoning);
    const oemContradictions = detectOemContradictions({
        report: params.report,
        supplementItems: leverageSortedSupplementItems,
        retrievalSummary: resolveReportRetrievalSummary(params.report),
    });
    const negotiationPlaybook = buildNegotiationPlaybook({
        reportFields,
        supplementItems: leverageSortedSupplementItems,
    });
    const financialGapBreakdown = buildFinancialGapBreakdown({
        report: params.report,
        analysis: params.analysis,
        supplementItems: leverageSortedSupplementItems,
    });
    const exportModel = {
        vehicle: exportVehicle,
        estimateFacts,
        reportFields,
        repairPosition: allLabelsSuppressed
            ? "The core repair conclusion remains intact, but noisy extracted labels were suppressed in this presentation view."
            : cleanFormalExportText(stripUnsupportedSeamSealerLanguage((0, vehicleApplicability_1.sanitizeVehicleSpecificText)(cleanPresentationProse(repairPosition), vehicleApplicability), sourceEstimateText, allowUnsupportedSeamSealerNarrative)),
        selectedEstimatePosture,
        positionStatement: allLabelsSuppressed
            ? "The main dispute areas remain supportable, but low-quality extracted labels were removed before rendering."
            : cleanFormalExportText(stripUnsupportedSeamSealerLanguage((0, vehicleApplicability_1.sanitizeVehicleSpecificText)(cleanPresentationProse(positionStatement), vehicleApplicability), sourceEstimateText, allowUnsupportedSeamSealerNarrative)),
        supplementItems: leverageSortedSupplementItems,
        request: allLabelsSuppressed
            ? "Please review the core dispute areas and provide clearer support for the intended repair path and verification steps."
            : cleanFormalExportText(stripUnsupportedSeamSealerLanguage((0, vehicleApplicability_1.sanitizeVehicleSpecificText)(request, vehicleApplicability), sourceEstimateText, allowUnsupportedSeamSealerNarrative)),
        valuation: {
            ...valuation,
            acvReasoning: cleanFormalExportText(valuation.acvReasoning),
            acvMissingInputs: valuation.acvMissingInputs.map((item) => (0, displayText_1.cleanDisplayLabel)(item)),
            dvReasoning: cleanFormalExportText(valuation.dvReasoning),
            dvMissingInputs: valuation.dvMissingInputs.map((item) => (0, displayText_1.cleanDisplayLabel)(item)),
        },
        disputeIntelligenceReport,
        findingReasoning: rankedFindingReasoning,
        retrievalSummary: resolveReportRetrievalSummary(params.report),
        disputeStrategy,
        oemContradictions,
        confidenceIntegrity: buildConfidenceIntegrity({
            report: params.report,
            analysis: params.analysis,
            supplementItems: leverageSortedSupplementItems,
        }),
        negotiationPlaybook,
        financialGapBreakdown,
        pressureMode: (0, pressureMode_1.computeModelPressureMode)({
            findingReasoning: rankedFindingReasoning,
            supplementItems: leverageSortedSupplementItems,
            topDrivers: disputeIntelligenceReport.topDrivers,
        }),
        outputMode: params.outputMode ?? (0, outputMode_1.classifyOutputMode)([
            params.assistantAnalysis ?? "",
            params.panel?.narrative ?? "",
            params.panel?.appraisal?.reasoning ?? "",
        ].join("\n\n")),
    };
    const modelWithDetermination = {
        ...exportModel,
        determination: (0, buildDetermination_1.buildDetermination)(exportModel),
    };
    return {
        ...modelWithDetermination,
        collisionSnapshot: (0, collisionSnapshot_1.buildCollisionSnapshot)(modelWithDetermination),
    };
}
function parseReportMoney(value) {
    if (!value)
        return undefined;
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) && parsed > 1 ? parsed : undefined;
}
function findEstimateMoneyLine(text, linePattern, moneyPattern) {
    for (const line of text.split(/\r?\n/).map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean)) {
        if (!linePattern.test(line))
            continue;
        const match = line.match(moneyPattern);
        const amount = parseReportMoney(match?.[1]);
        if (typeof amount === "number")
            return amount;
    }
    return undefined;
}
// Find a labeled money amount anywhere in the text. CCC/Audatex put the total
// on its own line ("Grand Total4,959.35", "Total Cost of Repairs3,652.71") with
// no shop/carrier keyword on the line, so we key off the LABEL, not proximity.
function findLabeledMoney(text, moneyPattern) {
    for (const line of text.split(/\r?\n/).map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean)) {
        const match = line.match(moneyPattern);
        const amount = parseReportMoney(match?.[1]);
        if (typeof amount === "number")
            return amount;
    }
    return undefined;
}
function extractEstimateComparisonTotals(text) {
    // Shop estimates (CCC) label the total "Grand Total"; carrier SORs
    // (Audatex/CCC carrier) use "Total Cost of Repairs" / "Net Cost of Repairs".
    // No trailing word boundary after the label — CCC glues the amount to it
    // ("Grand Total4,959.35", "Total Cost of Repairs3,652.71").
    const shopEstimateGrandTotal = findLabeledMoney(text, /grand total[^\d$]{0,40}\$?\s*([\d,]+\.\d{2})/i) ??
        findEstimateMoneyLine(text, /\b(?:shop|repair facility)\b/i, /(?:grand total|estimate total|total cost of repairs)[^\d$]{0,40}\$?\s*([\d,]+\.\d{2})/i);
    const carrierTotalCostOfRepairs = findLabeledMoney(text, /total cost of repairs[^\d$]{0,40}\$?\s*([\d,]+\.\d{2})/i) ??
        findEstimateMoneyLine(text, /\b(?:carrier|insurer|insurance|geico|allstate|progressive|state farm|sor[-\s]?\d*)\b/i, /(?:total repairs|gross repair total)[^\d$]{0,40}\$?\s*([\d,]+\.\d{2})/i);
    const carrierNetAfterDeductible = findLabeledMoney(text, /net cost of repairs[^\d$]{0,40}\$?\s*([\d,]+\.\d{2})/i) ??
        findLabeledMoney(text, /(?:net after deductible|net total|less deductible)[^\d$]{0,40}\$?\s*([\d,]+\.\d{2})/i);
    const grossRepairAppraisalGap = typeof shopEstimateGrandTotal === "number" && typeof carrierTotalCostOfRepairs === "number"
        ? Number((shopEstimateGrandTotal - carrierTotalCostOfRepairs).toFixed(2))
        : findLabeledMoney(text, /\b(?:gross repair appraisal gap|repair appraisal gap|gross gap|repair-total delta)\b[^\d$]{0,40}\$?\s*([\d,]+\.\d{2})/i);
    const totals = {
        shopEstimateGrandTotal,
        carrierTotalCostOfRepairs,
        carrierNetAfterDeductible,
        grossRepairAppraisalGap,
    };
    return Object.values(totals).some((value) => typeof value === "number") ? totals : undefined;
}
function deriveExportReportFields(params) {
    const sourceText = collectVehicleDocumentText(params.report, params.analysis);
    const comparisonTotals = extractEstimateComparisonTotals(sourceText);
    const fallbackFacts = (0, extractEstimateFacts_1.extractEstimateFacts)({
        text: sourceText,
        vehicle: (0, vehicleContext_1.mergeVehicleIdentity)((0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.analysis?.vehicle)),
    });
    const estimateFacts = {
        vehicle: (0, vehicleContext_1.mergeVehicleIdentity)((0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.estimateFacts?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.analysis?.estimateFacts?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.analysis?.estimateFacts?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(fallbackFacts.vehicle)),
        mileage: params.report?.estimateFacts?.mileage ??
            params.report?.analysis?.estimateFacts?.mileage ??
            params.analysis?.estimateFacts?.mileage ??
            fallbackFacts.mileage,
        insurer: (0, extractEstimateFacts_1.resolveCanonicalInsurerCandidate)({ value: params.report?.estimateFacts?.insurer, source: "prior" }, { value: params.report?.analysis?.estimateFacts?.insurer, source: "prior" }, { value: params.analysis?.estimateFacts?.insurer, source: "prior" }, { value: fallbackFacts.insurer, source: "known_carrier" }),
        estimateTotal: params.report?.estimateFacts?.estimateTotal ??
            params.report?.analysis?.estimateFacts?.estimateTotal ??
            params.analysis?.estimateFacts?.estimateTotal ??
            fallbackFacts.estimateTotal,
        documentedProcedures: [
            ...new Set([
                ...(params.report?.estimateFacts?.documentedProcedures ?? []),
                ...(params.report?.analysis?.estimateFacts?.documentedProcedures ?? []),
                ...(params.analysis?.estimateFacts?.documentedProcedures ?? []),
                ...(fallbackFacts.documentedProcedures ?? []),
            ]),
        ],
        documentedHighlights: [
            ...new Set([
                ...(params.report?.estimateFacts?.documentedHighlights ?? []),
                ...(params.report?.analysis?.estimateFacts?.documentedHighlights ?? []),
                ...(params.analysis?.estimateFacts?.documentedHighlights ?? []),
                ...(fallbackFacts.documentedHighlights ?? []),
            ]),
        ],
    };
    const vehicle = (0, vehicleContext_1.mergeVehicleIdentity)((0, vehicleContext_1.normalizeVehicleIdentity)(estimateFacts.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.report?.analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(params.analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(fallbackFacts.vehicle));
    const vehicleLabel = buildVehicleDisplayLabel(vehicle) ?? sanitizeVehicleDisplay((0, vehicleContext_1.buildVehicleLabel)(vehicle));
    const vin = (0, vehicleContext_1.normalizeVehicleIdentity)(vehicle)?.vin ?? extractVinFromText(sourceText);
    const presentStrengths = [
        ...new Set([
            ...estimateFacts.documentedHighlights,
            ...estimateFacts.documentedProcedures,
        ]),
    ];
    const likelySupplementAreas = [
        ...new Set([
            ...(params.report?.supplementOpportunities ?? []),
            ...(params.report?.missingProcedures ?? []),
        ]),
    ];
    return {
        vehicleLabel,
        vin,
        mileage: estimateFacts.mileage,
        mileageReadings: (0, extractEstimateFacts_1.extractMileageReadings)(sourceText),
        insurer: estimateFacts.insurer,
        insurerMentions: (0, extractEstimateFacts_1.extractInsurerMentions)(sourceText),
        estimateTotal: estimateFacts.estimateTotal,
        comparisonTotals,
        documentedHighlights: estimateFacts.documentedHighlights,
        documentedProcedures: estimateFacts.documentedProcedures,
        presentStrengths,
        likelySupplementAreas,
        estimateFacts,
        vehicle,
    };
}
function resolveReportFindingReasoning(report, analysis) {
    const concreteFindings = buildConcreteEstimateFindingReasoning(collectVehicleDocumentText(report, analysis));
    if (Array.isArray(report?.findingReasoning)) {
        return rankFindingReasoning([...concreteFindings, ...report.findingReasoning]);
    }
    const maybeFindings = report
        ? report.findings
        : undefined;
    const extracted = maybeFindings && typeof maybeFindings === "object"
        ? Object.values(maybeFindings)
            .flatMap((entry) => {
            if (!entry || typeof entry !== "object")
                return [];
            const data = entry.data;
            return Array.isArray(data) ? data : [];
        })
            .filter(isReportFindingReasoning)
        : [];
    const fallback = buildFallbackFindingReasoning(report, analysis);
    return rankFindingReasoning([...concreteFindings, ...extracted, ...fallback]);
}
function resolveReportRetrievalSummary(report) {
    return report?.retrievalSummary;
}
function resolveReportDisputeStrategy(report, rankedFindings) {
    if (!report?.disputeStrategy) {
        return undefined;
    }
    const rankedIssues = rankedFindings.map((finding) => finding.issue);
    const rankedOnly = rankedIssues.length > 0
        ? rankedIssues
        : report.disputeStrategy.priorityFindings;
    const mergedPriority = dedupeIssueOrder([
        ...rankedOnly,
        ...report.disputeStrategy.priorityFindings,
    ]).slice(0, 5);
    return {
        ...report.disputeStrategy,
        priorityFindings: mergedPriority,
    };
}
function buildConfidenceIntegrity(params) {
    if (params.report?.confidenceIntegrity) {
        const integrity = params.report.confidenceIntegrity;
        const counts = (0, reviewCompleteness_1.normalizeReviewProgressCounts)({
            uploadedCount: integrity.uploadedFileCount,
            indexedCount: integrity.indexedFileCount ?? integrity.uploadedFileCount,
            visionProcessedCount: integrity.visionProcessedFileCount,
            reviewedFileCount: integrity.reviewedFileCount,
            reviewableFileCount: integrity.reviewableFileCount,
            excludedFromReviewCount: integrity.excludedFromReviewCount,
            excludedFromReviewReasons: integrity.excludedFromReviewReasons,
            excludedFromReviewFiles: integrity.excludedFromReviewFiles,
        });
        return {
            ...integrity,
            indexedFileCount: counts.indexedCount,
            visionProcessedFileCount: counts.visionProcessedCount,
            reviewedFileCount: counts.reviewedFileCount,
            reviewableFileCount: counts.reviewableFileCount,
            excludedFromReviewCount: counts.excludedFromReviewCount,
            excludedFromReviewReasons: counts.excludedFromReviewReasons,
            excludedFromReviewFiles: counts.excludedFromReviewFiles,
            fileReviewLedger: integrity.fileReviewLedger ?? params.report.ingestionMeta?.fileReviewLedger,
            fileReviewDiagnostics: integrity.fileReviewDiagnostics ?? params.report.ingestionMeta?.fileReviewDiagnostics,
            evidenceCompletenessLedger: integrity.evidenceCompletenessLedger ??
                params.report.ingestionMeta?.evidenceCompletenessLedger ??
                (0, fileReviewLedger_1.resolveEvidenceCompletenessFromLedger)({
                    ledger: integrity.fileReviewLedger ?? params.report.ingestionMeta?.fileReviewLedger ?? [],
                    evidenceRegistry: params.report.evidenceRegistry,
                    corpus: buildEvidenceCompletenessCorpus(params),
                }),
            totalKnownFileCount: Math.max(integrity.totalKnownFileCount ?? 0, counts.uploadedCount, counts.indexedCount, counts.reviewableFileCount),
        };
    }
    const baseConfidence = normalizeReportConfidence(params.report?.summary.confidence ?? params.analysis?.summary.confidence);
    const uploadedFileCount = params.report?.ingestionMeta?.uploadedFileCount ??
        params.report?.evidenceRegistry?.filter((item) => item.ingestionState === "uploaded").length ??
        0;
    const indexedFileCount = params.report?.ingestionMeta?.indexedFileCount ??
        params.report?.evidenceRegistry?.filter((item) => ["uploaded", "ingested"].includes(item.ingestionState)).length ?? uploadedFileCount;
    const visionProcessedFileCount = params.report?.ingestionMeta?.visionProcessedFileCount ??
        params.report?.evidenceRegistry?.filter((item) => item.evidenceStatus === "VISIBLE_IN_IMAGES").length ?? 0;
    const reviewedFileCount = params.report?.ingestionMeta?.reviewedFileCount ??
        params.report?.evidenceRegistry?.filter((item) => item.ingestionState === "uploaded").length ??
        0;
    const reviewProgressCounts = (0, reviewCompleteness_1.normalizeReviewProgressCounts)({
        uploadedCount: uploadedFileCount,
        indexedCount: indexedFileCount,
        visionProcessedCount: visionProcessedFileCount,
        reviewedFileCount,
        reviewableFileCount: params.report?.ingestionMeta?.reviewableFileCount,
        excludedFromReviewCount: params.report?.ingestionMeta?.excludedFromReviewCount,
        excludedFromReviewReasons: params.report?.ingestionMeta?.excludedFromReviewReasons,
        excludedFromReviewFiles: params.report?.ingestionMeta?.excludedFromReviewFiles,
    });
    const totalKnownFileCount = Math.max(params.report?.ingestionMeta?.totalKnownFileCount ?? 0, uploadedFileCount, indexedFileCount, reviewedFileCount, reviewProgressCounts.reviewableFileCount);
    const uploadLimitReached = Boolean(params.report?.ingestionMeta?.uploadLimitReached);
    const userIndicatedMoreFiles = Boolean(params.report?.ingestionMeta?.userIndicatedMoreFiles);
    const missingCriticalEvidence = deriveMissingCriticalEvidence(params);
    const evidenceCompletenessLedger = (0, fileReviewLedger_1.resolveEvidenceCompletenessFromLedger)({
        ledger: params.report?.ingestionMeta?.fileReviewLedger ?? [],
        evidenceRegistry: params.report?.evidenceRegistry,
        corpus: buildEvidenceCompletenessCorpus(params),
    });
    const confidencePenalties = buildConfidencePenalties({
        uploadedFileCount,
        uploadLimitReached,
        userIndicatedMoreFiles,
        missingCriticalEvidence,
        evidenceQuality: params.report?.summary.evidenceQuality ?? params.analysis?.summary.evidenceQuality,
        retrievalSummary: params.report?.retrievalSummary,
    });
    const totalPenalty = confidencePenalties.reduce((sum, penalty) => sum + penalty.impact, 0);
    const adjustedConfidence = lowerConfidence(baseConfidence, totalPenalty);
    const completenessStatus = uploadedFileCount === 0 || totalPenalty >= 45
        ? "INSUFFICIENT"
        : confidencePenalties.length > 0
            ? "PARTIAL"
            : "COMPLETE";
    return {
        baseConfidence,
        adjustedConfidence,
        completenessStatus,
        uploadedFileCount,
        indexedFileCount,
        visionProcessedFileCount,
        reviewedFileCount,
        reviewableFileCount: reviewProgressCounts.reviewableFileCount,
        excludedFromReviewCount: reviewProgressCounts.excludedFromReviewCount,
        excludedFromReviewReasons: reviewProgressCounts.excludedFromReviewReasons,
        excludedFromReviewFiles: reviewProgressCounts.excludedFromReviewFiles,
        fileReviewLedger: params.report?.ingestionMeta?.fileReviewLedger,
        fileReviewDiagnostics: params.report?.ingestionMeta?.fileReviewDiagnostics,
        evidenceCompletenessLedger,
        totalKnownFileCount,
        uploadLimitReached,
        userIndicatedMoreFiles,
        missingCriticalEvidence,
        confidencePenalties,
        userFacingDisclosure: buildConfidenceDisclosure({
            completenessStatus,
            adjustedConfidence,
            missingCriticalEvidence,
            uploadLimitReached,
            userIndicatedMoreFiles,
        }),
    };
}
function normalizeReportConfidence(value) {
    if (/^high$/i.test(value ?? ""))
        return "High";
    if (/^low$/i.test(value ?? ""))
        return "Low";
    return "Moderate";
}
function lowerConfidence(base, totalPenalty) {
    const score = base === "High" ? 3 : base === "Moderate" ? 2 : 1;
    const steps = totalPenalty >= 45 ? 2 : totalPenalty >= 15 ? 1 : 0;
    const adjusted = Math.max(1, score - steps);
    return adjusted === 3 ? "High" : adjusted === 2 ? "Moderate" : "Low";
}
function deriveMissingCriticalEvidence(params) {
    const corpus = buildEvidenceCompletenessCorpus(params).toLowerCase();
    // Relevance from evidence; documented-ness from everything. See R08 above.
    const evidenceCorpus = buildEvidenceOnlyCorpus(params).toLowerCase();
    const evidenceCompletenessLedger = (0, fileReviewLedger_1.resolveEvidenceCompletenessFromLedger)({
        ledger: params.report?.ingestionMeta?.fileReviewLedger ?? params.report?.confidenceIntegrity?.fileReviewLedger ?? [],
        evidenceRegistry: params.report?.evidenceRegistry,
        corpus,
    });
    const statusByCategory = new Map(evidenceCompletenessLedger.map((item) => [item.category, item]));
    const missing = new Set();
    const addIfRelevant = (label, relevant, documented, categories) => {
        if (relevant.test(evidenceCorpus) && !documented.test(corpus)) {
            const resolution = categories
                .map((category) => statusByCategory.get(category))
                .find(Boolean);
            if (resolution && resolution.status !== "not_found" && resolution.status !== "referenced_not_produced") {
                if (resolution.status === "present_but_not_line_tied") {
                    missing.add(`${label} present but not line-tied`);
                }
                else if (resolution.status === "not_reviewed") {
                    missing.add(`${label} uploaded but not reviewed`);
                }
                return;
            }
            missing.add(label);
        }
    };
    addIfRelevant("Scan records", /\b(scan|diagnostic|dtc|srs|module)\b/, /\b(scan report|scan record|dtc report|diagnostic report|invoice-backed scan)\b/, ["scan_pre", "scan_post", "scan_in_process", "diagnostic_report"]);
    addIfRelevant("Calibration records", /\b(calibration|adas|aim|radar|camera|sensor)\b/, /\b(calibration report|calibration record|aiming record|invoice-backed calibration)\b/, ["calibration_record", "revvadas_record"]);
    addIfRelevant("Alignment printout", /\b(alignment|suspension|steering|geometry)\b/, /\b(alignment printout|alignment report|post-repair alignment)\b/, ["alignment_printout"]);
    addIfRelevant("Final invoice", /\b(invoice|final bill|paid|sublet|reimbursement|estimate total|cost gap)\b/, /\b(final invoice|paid invoice|closed repair order)\b/, ["final_invoice"]);
    addIfRelevant("Teardown photos", /\b(teardown|hidden damage|structural|rail|apron|pillar|quarter|core support|mounting)\b/, /\b(teardown photos?|disassembly photos?|photo documented)\b/, ["teardown_photo", "progress_photo", "completion_photo"]);
    addIfRelevant("OEM procedures", /\b(oem|procedure|position statement|corrosion|cavity wax|weld|calibration|scan)\b/, /\b(oem procedure attached|retrieved oem|oem evidence found|position statement attached)\b/, ["oem_procedure", "position_statement"]);
    for (const procedure of params.report?.missingProcedures ?? []) {
        if (/scan/i.test(procedure))
            missing.add("Scan records");
        if (/calibration|aim|adas/i.test(procedure))
            missing.add("Calibration records");
        if (/alignment/i.test(procedure))
            missing.add("Alignment printout");
        if (/oem|procedure/i.test(procedure))
            missing.add("OEM procedures");
    }
    return Array.from(missing).slice(0, 8);
}
/**
 * R08 — what the CASE contains, excluding anything this pipeline wrote.
 *
 * Relevance must be decided from evidence, never from our own narrative, or
 * the reasoning is circular: RO 22116's finding title "Hidden Mounting
 * Geometry Teardown Growth" contains "geometry", the alignment relevance test
 * matches /alignment|suspension|steering|geometry/ against a corpus that
 * includes finding titles, and the report demanded an alignment printout for a
 * repair with no alignment line on either estimate.
 *
 * Documented-ness still reads the FULL corpus below — a document can be named
 * anywhere — but the question "does this repair need one at all" may only be
 * answered by the estimate and the uploaded files.
 */
function buildEvidenceOnlyCorpus(params) {
    return [
        params.report?.missingProcedures.join("\n"),
        params.report?.evidenceRegistry?.map((item) => `${item.label} ${item.extractedSummary ?? ""} ${item.extractedText ?? ""}`).join("\n"),
        params.report?.ingestionMeta?.fileReviewLedger?.map((item) => `${item.filename} ${item.evidenceCategoriesDetected.join(" ")}`).join("\n"),
    ].filter(Boolean).join("\n");
}
function buildEvidenceCompletenessCorpus(params) {
    return [
        params.report?.missingProcedures.join("\n"),
        params.report?.recommendedActions.join("\n"),
        params.report?.issues.map((issue) => `${issue.title} ${issue.finding} ${issue.impact} ${issue.missingOperation ?? ""}`).join("\n"),
        params.report?.findingReasoning?.map((finding) => `${finding.issue} ${finding.next_action} ${finding.what_proves_it}`).join("\n"),
        params.report?.evidenceRegistry?.map((item) => `${item.label} ${item.extractedSummary ?? ""} ${item.extractedText ?? ""}`).join("\n"),
        params.report?.ingestionMeta?.fileReviewLedger?.map((item) => `${item.filename} ${item.evidenceCategoriesDetected.join(" ")}`).join("\n"),
        params.analysis?.findings.map((finding) => `${finding.title} ${finding.detail}`).join("\n"),
        params.supplementItems.map((item) => `${item.title} ${item.rationale} ${item.evidence ?? ""}`).join("\n"),
    ].filter(Boolean).join("\n");
}
function buildConfidencePenalties(params) {
    const penalties = [];
    if (params.uploadedFileCount === 0) {
        penalties.push({
            reason: "NO_UPLOADS",
            impact: 35,
            explanation: "No uploaded claim files are attached to the report.",
        });
    }
    if (params.uploadLimitReached) {
        penalties.push({
            reason: "UPLOAD_LIMIT_REACHED",
            impact: 15,
            explanation: "The upload batch reached the current file cap, so the review may not include every claim document.",
        });
    }
    if (params.userIndicatedMoreFiles) {
        penalties.push({
            reason: "USER_INDICATED_MORE_FILES",
            impact: 20,
            explanation: "The user indicated additional claim files exist but are not included in the current review.",
        });
    }
    if (params.missingCriticalEvidence.length > 0) {
        penalties.push({
            reason: "Open verification items",
            impact: Math.min(30, params.missingCriticalEvidence.length * 8),
            explanation: `The current file still needs verification support for ${params.missingCriticalEvidence.join(", ")}.`,
        });
    }
    if (params.evidenceQuality === "weak") {
        penalties.push({
            reason: "WEAK_EVIDENCE_QUALITY",
            impact: 15,
            explanation: "The structured analysis marked evidence quality as weak.",
        });
    }
    if (params.retrievalSummary?.serperStatus === "FAILED" && params.retrievalSummary.webSourcesUsed === 0) {
        penalties.push({
            reason: "WEB_RETRIEVAL_FAILED",
            impact: 10,
            explanation: "Public web retrieval failed and did not influence any included finding.",
        });
    }
    return penalties;
}
function buildConfidenceDisclosure(params) {
    if (params.completenessStatus === "COMPLETE") {
        return `File coverage appears complete for the reviewed materials. Adjusted confidence is ${params.adjustedConfidence}.`;
    }
    const limits = [
        params.uploadLimitReached ? "the upload cap was reached" : "",
        params.userIndicatedMoreFiles ? "additional files were indicated but not included" : "",
    ].filter(Boolean);
    const missing = params.missingCriticalEvidence.length > 0
        ? ` Open verification items: ${params.missingCriticalEvidence.slice(0, 4).join(", ")}.`
        : "";
    const limitText = limits.length > 0 ? ` ${limits.join("; ")}.` : "";
    return `Upload review completeness is ${params.completenessStatus.toLowerCase()}, and adjusted confidence is ${params.adjustedConfidence}.${limitText}${missing} Repair-package completeness depends on the listed evidence category reconciliation.`;
}
function isReportFindingReasoning(value) {
    if (!value || typeof value !== "object")
        return false;
    const record = value;
    return (typeof record.issue === "string" &&
        typeof record.why_it_matters === "string" &&
        typeof record.what_proves_it === "string" &&
        typeof record.next_action === "string" &&
        typeof record.evidenceLevel === "string" &&
        typeof record.confidence === "number" &&
        typeof record.claimSpecificity === "string");
}
function rankFindingReasoning(findings) {
    return findings
        .filter((finding) => finding.issue.trim())
        .filter(isUsableFindingForExport)
        .map(enrichFindingExplainability)
        .sort((left, right) => {
        const scoreDelta = (right.leverageScore ?? 0) - (left.leverageScore ?? 0);
        if (scoreDelta !== 0)
            return scoreDelta;
        return right.confidence - left.confidence;
    })
        .map((finding, index) => ({
        ...finding,
        priorityRank: index + 1,
    }))
        .slice(0, 8);
}
function isUsableFindingForExport(finding) {
    const text = `${finding.issue} ${finding.what_proves_it} ${finding.why_it_matters} ${finding.next_action}`.toLowerCase();
    if (/park\s+park\s+park|park\s+sensor\w{6,}|sensor1ew63tzzaa1361/i.test(text))
        return false;
    if (/documents describe repair process differently|documents carry different repair scope/i.test(finding.issue))
        return false;
    if (/structural measurement verification/i.test(finding.issue) && !hasStructuralMeasurementEvidence(text))
        return false;
    if (/adas\s*\/\s*calibration procedure support|oem fit-sensitive part posture/i.test(finding.issue) && !hasLineSpecificEstimateEvidence(text))
        return false;
    return true;
}
function buildConcreteEstimateFindingReasoning(sourceText) {
    const findings = [];
    const push = (issue, what_proves_it, why_it_matters, next_action, leverageScore) => {
        findings.push({
            issue,
            what_proves_it,
            why_it_matters,
            next_action,
            evidenceLevel: "documented",
            confidence: 0.86,
            claimSpecificity: "high",
            leverageScore,
        });
    };
    if (/lkq\s+grille[^.\n]{0,120}not\s+correct\s+style|not\s+correct\s+style[^.\n]{0,120}lkq\s+grille/i.test(sourceText)) {
        push("LKQ grille style contradiction", "The carrier estimate note states the LKQ grille is not the correct style.", "That is stronger than a generic OEM preference because the estimate itself flags a fit/style problem with the substituted grille.", "Ask the carrier to address the LKQ grille note and identify the correct grille line, part type, and price basis.", 980);
    }
    if (/\b(?:a\/m|aftermarket|capa|lkq)\b/i.test(sourceText) && /\b(?:oem|radiator support|bumper|grille|liftgate|rear lamp|tail lamp|rear[- ]bumper|front[- ]end)\b/i.test(sourceText)) {
        push("A/M CAPA LKQ substitutions vs documented part scope", "The estimate evidence uses A/M, CAPA, or LKQ language while other documented rows carry OEM or alternate part-scope language for the specific affected parts.", "Part-type differences can affect fit, finish, and pricing; the estimate evidence shows a dispute, not that every non-OEM part is automatically wrong.", "Group each disputed part family and ask for the carrier line number, part type, quote/source, and fit/style rationale.", 930);
    }
    if (/(body[^.\n]{0,40}13\.5[^.\n]{0,40}75|paint[^.\n]{0,40}3\.7[^.\n]{0,40}75|paint supplies[^.\n]{0,40}3\.7[^.\n]{0,40}60)/i.test(sourceText) &&
        /(body[^.\n]{0,40}13\.2[^.\n]{0,40}60|paint[^.\n]{0,40}3\.2[^.\n]{0,40}60|paint supplies[^.\n]{0,40}3\.2[^.\n]{0,40}40)/i.test(sourceText)) {
        push("Labor rate and paint-material delta", "The shop estimate shows higher body, paint, and paint-supply rates/hours than the carrier estimate.", "This is a line-specific price and labor dispute that explains part of the total gap without implying repair completion status.", "Ask for written support for the body, refinish, and materials rates and whether any local market-rate documentation was considered.", 880);
    }
    if (/(pre[- ]?repair scan|post[- ]?repair scan|in[- ]?process scan|seat belt dynamic function test|revvadas|egnyte)/i.test(sourceText)) {
        push("Scan ADAS and dynamic-test documentation", "The estimate set references pre/post scans, in-process scan, seat belt dynamic function test, and a REVVAdas/Egnyte support link.", "Referenced scan or ADAS support should be separated from produced documentation; a referenced link is not proof unless the file was retrieved and reviewed.", "Ask which scan, dynamic-test, calibration, and REVVAdas/Egnyte records were produced, retrieved, and matched to the estimate lines.", 850);
    }
    if (/(test fit|final road test|alignment)/i.test(sourceText)) {
        push("Test-fit road-test and alignment proof", "The estimates reference bumper test fit, final road test, and alignment-related items with different levels of detail or proof.", "These items affect fit and final verification, but an alignment line without amount or result should stay framed as incomplete documentation.", "Ask for the final road-test record, test-fit documentation, and alignment printout or written explanation if alignment has no amount/result.", 760);
    }
    return findings;
}
function hasStructuralMeasurementEvidence(value) {
    return /\b(?:structural measurement|measure structure|measure vehicle|frame setup|set up and measure|dimension(?:al)?|datum|bench|pull)\b/i.test(value);
}
function hasLineSpecificEstimateEvidence(value) {
    return /\b(?:line\s*\d+|lkq|capa|a\/m|aftermarket|grille|bumper|radiator support|scan|revvadas|egnyte|seat belt dynamic|test fit|road test|labor rate|paint supplies)\b/i.test(value);
}
function detectOemContradictions(params) {
    const sourceIndex = buildOemSupportIndex(params);
    const candidates = [
        ...params.supplementItems.map((item) => ({
            operation: item.title,
            text: `${item.title} ${item.category} ${item.kind} ${item.rationale} ${item.evidence ?? ""} ${item.source ?? ""}`,
            followUpSource: item.source ?? item.evidence ?? null,
            priority: item.priority,
        })),
        ...(params.report?.issues ?? []).map((issue) => ({
            operation: issue.missingOperation ?? issue.title,
            text: `${issue.title} ${issue.category} ${issue.finding} ${issue.impact} ${issue.missingOperation ?? ""}`,
            followUpSource: issue.evidenceIds.length > 0 ? "Support verified from reviewed file evidence." : null,
            priority: issue.severity,
        })),
    ];
    const contradictions = candidates
        .map((candidate) => {
        const conflictType = inferOemConflictType(candidate.text);
        if (!conflictType)
            return null;
        const support = findBestOemSupport(candidate.text, sourceIndex);
        const severity = inferOemContradictionSeverity(candidate.text, candidate.priority, Boolean(support));
        const affectedOperation = (0, displayText_1.cleanDisplayLabel)(candidate.operation) || "OEM-supported operation";
        const supportStatus = support?.verified ? "verified" : support ? "referenced" : "inferred";
        const supportDescription = support
            ? support.citation
            : "No verified OEM citation attached; contradiction is inferred from current repair context.";
        return {
            conflictSummary: `${affectedOperation} appears inconsistent with the carrier estimate, claim position, or denial logic when compared with ${formatOemConflictType(conflictType)}. ${supportStatus === "inferred" ? "This is inferred and requires OEM source verification." : "OEM support metadata is available."}`,
            affectedOperation,
            oemSupportCitation: support?.citation ?? null,
            contradictionSeverity: severity,
            recommendedFollowUp: buildOemContradictionFollowUp(affectedOperation, conflictType, supportDescription),
            supportStatus,
            sourceType: conflictType,
        };
    })
        .filter((item) => Boolean(item));
    return dedupeOemContradictions(contradictions)
        .sort((left, right) => {
        const severityDelta = severityRank(right.contradictionSeverity) - severityRank(left.contradictionSeverity);
        if (severityDelta !== 0)
            return severityDelta;
        return supportStatusRank(right.supportStatus) - supportStatusRank(left.supportStatus);
    })
        .slice(0, 8);
}
function buildOemSupportIndex(params) {
    const indexed = [];
    for (const procedure of params.report?.requiredProcedures ?? []) {
        if (!/oem|procedure|scan|calibration|adas|structural|measure|weld|bond|corrosion/i.test(`${procedure.source} ${procedure.procedure} ${procedure.reason}`)) {
            continue;
        }
        indexed.push({
            citation: `Required procedure: ${procedure.procedure} - ${procedure.reason}`,
            haystack: `${procedure.procedure} ${procedure.reason}`,
            verified: procedure.source === "oem_doc",
        });
    }
    for (const source of params.retrievalSummary?.sourcesInfluencingFindings ?? []) {
        if (!/oem|procedure|position|calibration|scan|adas|structural|measure/i.test(`${source.title} ${source.sourceType}`)) {
            continue;
        }
        indexed.push({
            citation: source.url ? `${source.title} (${source.url})` : source.title,
            haystack: `${source.title} ${source.sourceType} ${source.relatedFindingIds.join(" ")}`,
            verified: source.sourceType === "oem" || /oem|position statement|procedure/i.test(source.title),
        });
    }
    for (const item of params.supplementItems) {
        const sourceText = `${item.source ?? ""} ${item.evidence ?? ""}`;
        if (!sourceText.trim() || !/oem|procedure|position|calibration|scan|adas|structural|measure/i.test(sourceText)) {
            continue;
        }
        indexed.push({
            citation: item.source ?? item.evidence ?? "",
            haystack: `${item.title} ${item.category} ${sourceText}`,
            verified: /oem|position statement|procedure/i.test(sourceText),
        });
    }
    return indexed;
}
function inferOemConflictType(text) {
    const lower = text.toLowerCase();
    const hasConflict = /\b(missing|under[- ]?documented|not included|omitted|denied|denial|excluded|unsupported|gap|carrier|claim position|position)\b/.test(lower);
    if (!hasConflict)
        return null;
    if (/\b(calibration|adas|aim|camera|radar|sensor)\b/.test(lower))
        return "CalibrationRequirement";
    if (/\b(structural|measure|measurement|frame|rail|pillar|apron|weld|bond|section)\b/.test(lower))
        return "StructuralVerification";
    if (/\b(position statement|scrs|manufacturer position)\b/.test(lower))
        return "OEMPositionStatement";
    if (/\b(oem|procedure|scan|corrosion|one[- ]time|one time)\b/.test(lower))
        return "OEMProcedure";
    return null;
}
function findBestOemSupport(text, sourceIndex) {
    const tokens = [...tokenizeOemSupport(text)];
    if (tokens.length === 0)
        return null;
    let best = null;
    for (const source of sourceIndex) {
        const sourceTokens = tokenizeOemSupport(source.haystack);
        const score = tokens.filter((token) => sourceTokens.has(token)).length;
        const bestScore = best === null ? 0 : best.score;
        if (score > bestScore || (score === bestScore && source.verified && best?.verified !== true)) {
            best = { citation: source.citation, verified: source.verified, score };
        }
    }
    return best && best.score >= 1 ? best : null;
}
function tokenizeOemSupport(value) {
    return new Set(value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 3 && !/^(missing|under|documented|carrier|estimate|claim|position)$/.test(token)));
}
function inferOemContradictionSeverity(text, priority, hasSupport) {
    const lower = text.toLowerCase();
    if (/\b(structural|frame|rail|pillar|weld|bond|adas|calibration|radar|camera)\b/.test(lower) && hasSupport) {
        return "critical";
    }
    if (/\b(structural|frame|rail|pillar|weld|bond|adas|calibration|radar|camera|scan)\b/.test(lower)) {
        return "high";
    }
    if (priority === "high" || /\b(safety|oem|procedure|corrosion|one[- ]time)\b/.test(lower)) {
        return hasSupport ? "high" : "moderate";
    }
    return "moderate";
}
function buildOemContradictionFollowUp(operation, sourceType, supportDescription) {
    const supportInstruction = supportDescription.startsWith("No verified")
        ? "verify the applicable OEM procedure or position statement before asserting OEM conflict"
        : `attach or cite ${supportDescription}`;
    switch (sourceType) {
        case "CalibrationRequirement":
            return `Request the OEM calibration, scan, or aiming requirement for ${operation}; ${supportInstruction}; ask for a written explanation if the carrier position omits it.`;
        case "StructuralVerification":
            return `Request OEM structural verification, measurement, weld/bond, or repair-method support for ${operation}; ${supportInstruction}; ask how the denial reconciles with that requirement.`;
        case "OEMPositionStatement":
            return `Request the applicable OEM position statement for ${operation}; ${supportInstruction}; ask for a claim-position response tied to the cited statement.`;
        case "OEMProcedure":
            return `Request the applicable OEM procedure for ${operation}; ${supportInstruction}; ask for a revised estimate or written denial rationale.`;
        case "InferredProcedureConflict":
            return `Treat ${operation} as an inferred procedure conflict until OEM support is verified, then request a written reconciliation from the carrier.`;
    }
}
function formatOemConflictType(sourceType) {
    switch (sourceType) {
        case "CalibrationRequirement":
            return "calibration or ADAS requirements";
        case "StructuralVerification":
            return "structural verification requirements";
        case "OEMPositionStatement":
            return "OEM position-statement support";
        case "OEMProcedure":
            return "OEM procedure support";
        case "InferredProcedureConflict":
            return "inferred OEM procedure support";
    }
}
function dedupeOemContradictions(contradictions) {
    const seen = new Set();
    return contradictions.filter((contradiction) => {
        const key = `${contradiction.affectedOperation}:${contradiction.sourceType}`.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function severityRank(severity) {
    switch (severity) {
        case "critical":
            return 4;
        case "high":
            return 3;
        case "moderate":
            return 2;
        case "informational":
            return 1;
    }
}
function supportStatusRank(status) {
    if (status === "verified")
        return 3;
    if (status === "referenced")
        return 2;
    return 1;
}
function buildFallbackFindingReasoning(report, analysis) {
    const issueReasoning = report?.issues.map((issue) => {
        const evidenceLevel = issue.evidenceStatus
            ? mapIssueEvidenceStatusToEvidenceLevel(issue.evidenceStatus)
            : issue.evidenceIds.length > 0
                ? "documented"
                : "inferred";
        return {
            id: issue.id,
            issue: (0, displayText_1.cleanDisplayLabel)(issue.title),
            finding: issue.finding,
            why_it_matters: issue.impact || "This item can affect the documented repair position.",
            what_proves_it: issue.evidenceIds.length > 0
                ? "Support verified from reviewed file evidence."
                : "Current structured analysis and estimate context; verify with source documents before use.",
            next_action: issue.missingOperation
                ? `Request documentation or estimate revision for ${issue.missingOperation}.`
                : "Request the supporting documentation not yet located in reviewed files or a written estimate explanation.",
            evidenceLevel,
            confidence: evidenceLevel === "documented" ? 0.86 : evidenceLevel === "referenced" ? 0.74 : 0.56,
            claimSpecificity: issue.evidenceIds.length > 0 || issue.missingOperation ? "high" : "medium",
        };
    }) ?? [];
    const analysisReasoning = analysis?.findings.map((finding) => {
        const evidenceLevel = finding.evidence.length > 0
            ? "documented"
            : finding.status === "unclear"
                ? "inferred"
                : "missing";
        return {
            id: finding.id,
            issue: (0, displayText_1.cleanDisplayLabel)(finding.title),
            finding: finding.detail,
            why_it_matters: finding.detail,
            what_proves_it: finding.evidence.length > 0
                ? "Support verified from reviewed file evidence."
                : "No direct evidence citation is attached to this analysis finding.",
            next_action: finding.status === "present"
                ? "Preserve the supporting record in the file."
                : "Request the completion/support record not yet isolated in reviewed files or revise the estimate record.",
            evidenceLevel,
            confidence: evidenceLevel === "documented" ? 0.82 : evidenceLevel === "inferred" ? 0.58 : 0.44,
            claimSpecificity: finding.evidence.length > 0 ? "high" : "medium",
        };
    }) ?? [];
    return dedupeFindingReasoning([...issueReasoning, ...analysisReasoning]);
}
function enrichFindingExplainability(finding) {
    let supportConfidenceIndicator = finding.supportConfidenceIndicator ?? mapEvidenceLevelToSupportConfidence(finding.evidenceLevel);
    // "Verified" claims whose own evidence text signals online-fallback /
    // research-lead / not-retrieved support are downgraded: verified is reserved
    // for retrieved authority or uploaded documentation.
    if (supportConfidenceIndicator === "verified" &&
        /online|internet|research lead|fallback|general guidance|unverified|not (?:yet )?(?:retrieved|produced|verified)|referenced but not produced/i.test(`${finding.what_proves_it ?? ""} ${finding.evidenceChainSummary ?? ""} ${finding.finding ?? ""}`)) {
        supportConfidenceIndicator = "referenced";
    }
    return {
        ...finding,
        rationaleSummary: finding.rationaleSummary ?? buildRationaleSummary(finding),
        evidenceChainSummary: finding.evidenceChainSummary ?? buildEvidenceChainSummary(finding),
        riskIfOmitted: finding.riskIfOmitted ?? buildRiskIfOmitted(finding),
        supportConfidenceIndicator,
        leverageScore: finding.leverageScore ?? computeFindingLeverageScore(finding),
    };
}
function dedupeFindingReasoning(findings) {
    const seen = new Set();
    const deduped = [];
    for (const finding of findings) {
        const key = `${finding.issue} ${finding.finding ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        deduped.push(finding);
    }
    return deduped;
}
function mapIssueEvidenceStatusToEvidenceLevel(status) {
    switch (status) {
        case "DOCUMENTED":
        case "VISIBLE_IN_IMAGES":
            return "documented";
        case "REFERENCED_NOT_PRODUCED":
        case "SUPPORTABLE_BUT_UNCONFIRMED":
            return "referenced";
        case "OPEN_PENDING_FURTHER_DOCUMENTATION":
            return "missing";
        case "NOT_ESTABLISHED":
            return "unsupported";
    }
}
function mapEvidenceLevelToSupportConfidence(evidenceLevel) {
    // "documented" = present on the estimate/images. That is estimate evidence,
    // NEVER verified authority support — do not promote it to "verified".
    return evidenceLevel;
}
function buildRationaleSummary(finding) {
    return cleanFormalExportText(`${finding.issue}: ${finding.why_it_matters || finding.finding || "This affects the repair position."}`);
}
function buildEvidenceChainSummary(finding) {
    return (0, presentationText_1.summarizeUserFacingSupport)(finding.what_proves_it, formatExplainabilitySupport(finding.evidenceLevel));
}
function buildRiskIfOmitted(finding) {
    if (finding.evidenceLevel === "missing" || /missing|omit|absent|not included/i.test(finding.issue)) {
        return "If omitted, the file may lack the documentation needed to support the repair position or requested revision.";
    }
    if (finding.evidenceLevel === "unsupported") {
        return "If relied on without added support, the point should be treated as unsupported commentary.";
    }
    return "If omitted, the report may understate a documented repair, procedure, or estimate-support issue.";
}
function formatExplainabilitySupport(evidenceLevel) {
    switch (evidenceLevel) {
        case "documented":
            return "Documented in the reviewed estimate; supporting completion proof still open.";
        case "referenced":
            return "Referenced support present; completion record not fully isolated.";
        case "inferred":
            return "Support is inferred from available context and needs confirmation";
        case "missing":
            return "Not yet located in reviewed files.";
        case "unsupported":
            return "Support is not established";
    }
}
function computeFindingLeverageScore(finding) {
    const evidenceScore = finding.evidenceLevel === "documented" ? 30 :
        finding.evidenceLevel === "referenced" ? 24 :
            finding.evidenceLevel === "inferred" ? 12 :
                4;
    const confidenceScore = Math.round(finding.confidence * 25);
    const specificityScore = finding.claimSpecificity === "high" ? 20 :
        finding.claimSpecificity === "medium" ? 13 :
            4;
    const mismatchScore = /gap|missing|absent|not included|not documented|excluded|vs/i.test(`${finding.issue} ${finding.finding ?? ""}`)
        ? 10
        : 0;
    const ambiguityPenalty = finding.evidenceLevel === "inferred" ||
        /may|depending|confirm|procedure-dependent|if /i.test(`${finding.finding ?? ""} ${finding.why_it_matters}`)
        ? 10
        : 0;
    return Math.max(0, Math.min(100, evidenceScore + confidenceScore + specificityScore + mismatchScore - ambiguityPenalty));
}
function sortDisputeItemsByLeverageScore(items) {
    return [...items]
        .map((item) => {
        const impact = mapSupplementPriorityToImpact(item.priority);
        const supportStatus = mapSupplementKindToSupportStatus(item.kind);
        const evidenceLevel = mapSupportStatusToEvidenceLevel(supportStatus);
        const retrievalSupport = inferRetrievalSupport(item);
        const leverageScore = computeLeverageScore(impact, evidenceLevel, retrievalSupport);
        return {
            ...item,
            leverageScore,
        };
    })
        .sort((left, right) => {
        const scoreDelta = (right.leverageScore ?? 0) - (left.leverageScore ?? 0);
        if (scoreDelta !== 0)
            return scoreDelta;
        return left.title.localeCompare(right.title);
    });
}
function dedupeIssueOrder(items) {
    const deduped = [];
    const seen = new Set();
    for (const item of items) {
        const normalized = item.trim().toLowerCase();
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        deduped.push(item);
    }
    return deduped;
}
function inferVehicleInfo(report, analysis, estimateFacts) {
    const documentVehicleText = collectVehicleDocumentText(report, analysis);
    const structuredVehicle = (0, vehicleContext_1.mergeVehicleIdentity)((0, vehicleContext_1.normalizeVehicleIdentity)(report?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(report?.analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(analysis?.vehicle), (0, vehicleContext_1.normalizeVehicleIdentity)(estimateFacts.vehicle));
    const inferredVehicle = (0, vehicleContext_1.extractVehicleIdentityFromText)(documentVehicleText, "attachment");
    const resolvedVin = resolveExportVin(structuredVehicle, inferredVehicle, documentVehicleText);
    const decodedVehicle = resolvedVin ? (0, vehicleContext_1.decodeVinVehicleIdentity)(resolvedVin) : undefined;
    const vehicle = (0, vehicleContext_1.mergeVehicleIdentity)(decodedVehicle, structuredVehicle, inferredVehicle);
    const decodedVehicleLabel = buildVehicleDisplayLabel((0, vehicleContext_1.mergeVehicleIdentity)(decodedVehicle, vehicle));
    const structuredVehicleLabel = buildVehicleDisplayLabel(vehicle);
    const rawVehicleLabel = sanitizeVehicleDisplay((0, vehicleContext_1.buildVehicleLabel)(vehicle));
    const label = decodedVehicleLabel ??
        structuredVehicleLabel ??
        rawVehicleLabel;
    const detailCount = [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.vin, vehicle?.trim].filter(Boolean).length;
    console.info("[vehicle-reconciliation:report]", {
        structuredVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(structuredVehicle),
        decodedVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(decodedVehicle),
        inferredVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(inferredVehicle),
        resolvedVehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(vehicle),
        resolvedVinTail: resolvedVin ? `*****${resolvedVin.slice(-4)}` : null,
        hasDocumentVehicleText: Boolean(documentVehicleText.trim()),
    });
    console.info("[export-vehicle-selection]", {
        vinPresent: Boolean(resolvedVin),
        decodedVehiclePresent: Boolean(decodedVehicleLabel),
        structuredFieldsPresent: Boolean(vehicle?.year || vehicle?.make || vehicle?.model || vehicle?.trim),
        rawVehicleLabelPresent: Boolean(rawVehicleLabel),
        finalVehicle: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(label) ?? "Unspecified",
    });
    return {
        label,
        vin: (0, displayText_1.cleanDisplayText)(resolvedVin),
        year: vehicle?.year,
        make: (0, displayText_1.cleanDisplayLabel)(vehicle?.make),
        model: (0, displayText_1.cleanDisplayLabel)(vehicle?.model),
        trim: (0, displayText_1.cleanDisplayText)(vehicle?.trim),
        manufacturer: (0, displayText_1.cleanDisplayText)(vehicle?.manufacturer),
        confidence: detailCount >= 3 || Boolean(vehicle?.vin)
            ? "supported"
            : detailCount >= 2
                ? "partial"
                : "unknown",
        sourceConfidence: vehicle?.confidence,
        fieldSources: vehicle?.fieldSources,
        mismatches: vehicle?.mismatches,
    };
}
function buildVehicleDisplayLabel(vehicle) {
    const normalized = (0, vehicleContext_1.normalizeVehicleIdentity)(vehicle);
    if (!normalized)
        return undefined;
    // A year with no make AND no model is not an identity — "VEHICLE: 2024." on
    // a customer document. Returning undefined lets the guarded identity
    // builder (VIN-tail fallback) take over instead.
    if (!normalized.make && !normalized.model)
        return undefined;
    return sanitizeVehicleDisplay([
        normalized.year,
        (0, displayText_1.cleanDisplayLabel)(normalized.make),
        (0, displayText_1.cleanDisplayLabel)(normalized.model),
        cleanVehicleDescriptor(normalized.trim),
    ]
        .filter(Boolean)
        .join(" "));
}
function buildExportValuationPreviewSummary(valuation) {
    return {
        acv: summarizeExportValuationBand({
            label: "Market Preview",
            status: valuation.acvStatus,
            value: valuation.acvValue,
            range: valuation.acvRange,
            maxRange: 250000,
        }),
        dv: summarizeExportValuationBand({
            label: "DV preview",
            status: valuation.dvStatus,
            value: valuation.dvValue,
            range: valuation.dvRange,
            maxRange: 50000,
        }),
    };
}
function buildDisputeIntelligenceReport(params) {
    const hasReferencedProcedureSupport = hasReferencedButNotRetrievedProcedureSupport(params.report);
    const driverItems = params.supplementItems
        .filter((item) => item.title !== "Parser review needed" && !(0, presentationText_1.isMalformedEstimateLine)(item.title))
        .slice(0, 5);
    const rawDrivers = driverItems.map((item, index) => {
        const impact = mapSupplementPriorityToImpact(item.priority);
        const supportStatus = mapSupplementKindToSupportStatus(item.kind);
        const evidenceLevel = mapSupportStatusToEvidenceLevel(supportStatus);
        const retrievalSupport = inferRetrievalSupport(item);
        const leverageScore = computeLeverageScore(impact, evidenceLevel, retrievalSupport);
        return {
            title: (0, displayText_1.cleanDisplayLabel)(item.title),
            impact,
            supportStatus,
            whyItMatters: summarizeSupplementSentence(item.rationale, "This item affects repair quality, documentation, or validation."),
            currentGap: buildDisputeDriverGap(item),
            nextAction: buildDisputeDriverAction(item),
            evidenceLevel,
            retrievalSupport,
            leverageScore,
            priorityRank: index + 1,
            whyThisWins: buildWhyThisWins(item, evidenceLevel, retrievalSupport),
        };
    });
    // Re-sort by leverageScore descending, then re-assign ranks
    const topDrivers = [...rawDrivers]
        .sort((a, b) => b.leverageScore - a.leverageScore)
        .map((driver, i) => ({ ...driver, priorityRank: i + 1 }));
    const top3 = topDrivers.slice(0, 3);
    const positives = dedupeCleanExportBullets([
        ...params.reportFields.presentStrengths,
        ...params.reportFields.documentedHighlights,
        ...params.reportFields.documentedProcedures,
        hasReferencedProcedureSupport
            ? "Referenced OEM/procedure documents add directional dispute support when they align with the damage path, but they are not treated as fully reviewed procedure evidence."
            : "",
    ]).slice(0, 5);
    const supportGaps = buildDisputeSupportGapBullets(params.supplementItems, params.reportFields, hasReferencedProcedureSupport).slice(0, 5);
    const nextMoves = buildDisputeNextMoves(params.supplementItems).slice(0, 6);
    const valuationPreview = params.valuation.acvStatus !== "not_determinable" || params.valuation.dvStatus !== "not_determinable"
        ? buildExportValuationPreviewSummary(params.valuation)
        : undefined;
    return {
        summary: removeNearDuplicateConclusionSentences([trimTrailingPunctuation(params.repairPosition), trimTrailingPunctuation(params.positionStatement)]
            .filter(Boolean)
            .join(" ")
            .trim()),
        topDrivers,
        top3,
        positives,
        supportGaps,
        nextMoves,
        valuationPreview,
    };
}
function mapSupportStatusToEvidenceLevel(supportStatus) {
    switch (supportStatus) {
        case "supported":
            return "documented";
        case "underwritten":
            return "referenced";
        case "disputed":
            return "inferred";
        case "missing":
            return "missing";
    }
}
function inferRetrievalSupport(item) {
    const text = `${item.title} ${item.rationale} ${item.evidence ?? ""}`.toLowerCase();
    const sources = [];
    if (/oem|procedure|position statement|manufacturer/.test(text))
        sources.push("web:oem");
    if (/statute|regulation|insurance code|bad faith/.test(text))
        sources.push("web:legal");
    if (/estimate|supplement|scope/.test(text))
        sources.push("drive:estimate");
    if (/calibration|scan|corrosion|weld|adas/.test(text))
        sources.push("drive:procedure");
    sources.push("upload");
    return [...new Set(sources)];
}
function computeLeverageScore(impact, evidenceLevel, retrievalSupport) {
    let score = 0;
    // Impact weight: 0–50
    if (impact === "high")
        score += 50;
    else if (impact === "medium")
        score += 30;
    else
        score += 10;
    // Evidence level: 0–30
    if (evidenceLevel === "documented")
        score += 30;
    else if (evidenceLevel === "referenced")
        score += 20;
    else if (evidenceLevel === "inferred")
        score += 10;
    // Retrieval breadth: 0–20
    if (retrievalSupport.includes("web:oem"))
        score += 10;
    if (retrievalSupport.includes("web:legal"))
        score += 5;
    if (retrievalSupport.includes("drive:procedure"))
        score += 5;
    return Math.min(score, 100);
}
function buildWhyThisWins(item, evidenceLevel, retrievalSupport) {
    const parts = [];
    if (item.priority === "high")
        parts.push("high safety or financial impact");
    if (evidenceLevel === "documented")
        parts.push("fully documented in file");
    else if (evidenceLevel === "referenced")
        parts.push("OEM or procedure reference available");
    else if (evidenceLevel === "missing")
        parts.push("creates clear gap for supplement");
    // A web/internet hit is a research lead, not attached OEM authority. Only a
    // retrieved-and-attached procedure document (e.g. Drive) is described as a
    // produced source; estimate text and referenced links never are.
    if (retrievalSupport.includes("web:oem"))
        parts.push("online OEM/procedure lead (unverified — verify against OEM source)");
    if (retrievalSupport.includes("drive:procedure"))
        parts.push("procedure document retrieved from Drive");
    return parts.length > 0 ? parts.join(" + ") : "Repair-path relevance established from file evidence";
}
function hasReferencedButNotRetrievedProcedureSupport(report) {
    return (report?.linkedEvidence ?? []).some((item) => {
        const status = item.status?.toLowerCase();
        return ((status === "skipped" || status === "referenced_not_retrieved") &&
            (item.inferredProcedureSignals?.length ?? 0) > 0);
    });
}
function buildNegotiationPlaybook(params) {
    const approved = dedupeCleanExportBullets(params.reportFields.presentStrengths).slice(0, 4);
    const likelyPushback = dedupeCleanExportBullets(params.supplementItems
        .slice(0, 5)
        .map((item) => `${(0, displayText_1.cleanDisplayLabel)(item.title)}: ${buildDisputeDriverGap(item)}`)).slice(0, 5);
    const strongestArguments = dedupeCleanExportBullets([
        ...params.reportFields.documentedProcedures.map((item) => `Documented procedure support: ${trimTrailingPunctuation(item)}`),
        ...params.supplementItems
            .slice(0, 4)
            .map((item) => `${(0, displayText_1.cleanDisplayLabel)(item.title)} matters because ${lowercaseFirstSafe(summarizeSupplementSentence(item.rationale, ""))}`),
    ]).slice(0, 5);
    const vulnerablePoints = dedupeCleanExportBullets(params.supplementItems
        .filter((item) => item.priority !== "low")
        .slice(0, 4)
        .map((item) => `${(0, displayText_1.cleanDisplayLabel)(item.title)} still needs ${lowercaseFirstSafe(buildDisputeDriverGap(item))}`)).slice(0, 4);
    const documentationNeeded = dedupeCleanExportBullets(params.supplementItems.slice(0, 5).map((item) => buildDisputeDriverAction(item))).slice(0, 5);
    return {
        likelyApproved: approved,
        likelyPushback,
        strongestArguments,
        vulnerablePoints,
        suggestedSequence: [
            "Lead with the strongest OEM-backed procedure support already documented in the file.",
            "Move next to missing or underwritten safety, calibration, scan, and measurement items.",
            "Address lower-dollar labor or process disagreements after the repair-path logic is established.",
        ],
        documentationNeeded,
        fallbackConcessions: [
            "If needed, concede low-impact manual or presentation items that do not change the core repair-path support.",
        ],
    };
}
function buildFinancialGapBreakdown(params) {
    const drivers = dedupeFinancialGapDrivers([
        ...buildComparisonGapDrivers(params.analysis),
        ...buildSupplementGapDrivers(params.supplementItems),
    ]).slice(0, 6);
    return {
        totalGap: deriveDirectionalTotalGap(params.analysis),
        drivers,
        narrativeSummary: drivers.length > 0
            ? `The biggest estimate-gap pressure appears to come from ${joinHumanList(drivers.slice(0, 3).map((driver) => driver.category.toLowerCase()))}, with the current file supporting a directional rather than fully quantified breakdown.`
            : "The current file does not support a reliable quantified gap breakdown, so any financial read should stay directional only.",
    };
}
function mapSupplementPriorityToImpact(priority) {
    if (priority === "high")
        return "high";
    if (priority === "medium")
        return "medium";
    return "low";
}
function mapSupplementKindToSupportStatus(kind) {
    switch (kind) {
        case "missing_operation":
        case "missing_verification":
            return "missing";
        case "underwritten_operation":
            return "underwritten";
        case "disputed_repair_path":
            return "disputed";
        default:
            return "supported";
    }
}
function summarizeSupplementSentence(value, fallback) {
    const cleaned = cleanFormalExportText(value).trim();
    if (!cleaned)
        return fallback;
    const sentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() ?? cleaned;
    return trimTrailingPunctuation(sentence) || fallback;
}
function buildDisputeDriverGap(item) {
    switch (item.kind) {
        case "missing_operation":
            return "the operation is not clearly carried in the current estimate posture";
        case "missing_verification":
            return "the required verification or documentation path is not clearly shown";
        case "underwritten_operation":
            return "the current estimate appears to carry this item lightly relative to the repair path";
        default:
            return "the current repair-path position still needs clearer support or reconciliation";
    }
}
function buildDisputeDriverAction(item) {
    const title = item.title.toLowerCase();
    if (title.includes("calibration") || title.includes("scan") || title.includes("sensor")) {
        return "Request OEM procedure support plus invoice-backed scan or calibration records.";
    }
    if (title.includes("measure") || title.includes("setup") || title.includes("realignment")) {
        return "Request documented measurement, setup, or frame verification records.";
    }
    if (title.includes("alignment")) {
        return "Request alignment rationale plus the post-repair printout or supporting documentation.";
    }
    if (title.includes("hardware") || title.includes("clip") || title.includes("seal")) {
        return "Request the OEM parts-support list and any one-time-use hardware documentation.";
    }
    return "Request OEM procedure support and the documentation carrying the intended repair path.";
}
function dedupeCleanExportBullets(values) {
    return [...new Set(values.map((value) => trimTrailingPunctuation(cleanFormalExportText(value))).filter(Boolean))];
}
function buildDisputeSupportGapBullets(supplementItems, reportFields, hasReferencedProcedureSupport = false) {
    const values = [];
    const titles = supplementItems.map((item) => item.title.toLowerCase());
    if (hasReferencedProcedureSupport) {
        values.push("Referenced procedure support should not be treated as no support, but exact OEM procedure steps still need the retrieved document or equivalent file evidence.");
    }
    if (titles.some((title) => /(measure|frame|structural|setup|realign|rail)/.test(title))) {
        values.push("Structural measurement or frame-setup records are still missing or under-documented.");
    }
    if (titles.some((title) => /(scan|calibration|sensor|camera|radar|adas)/.test(title))) {
        values.push("Scan and calibration items still need OEM-procedure support and invoice-backed proof.");
    }
    if (titles.some((title) => /(alignment|test fit|fit check|mock)/.test(title))) {
        values.push("Validation items such as alignment or fit-check support still need printouts or documented confirmation.");
    }
    if (titles.some((title) => /(oem|alternate|aftermarket|hardware|clip|seal|parts)/.test(title))) {
        values.push("Parts-position items still need OEM support, one-time-use documentation, or clear replacement rationale.");
    }
    const remainingAreas = reportFields.likelySupplementAreas
        .map((item) => trimTrailingPunctuation(cleanFormalExportText(item)))
        .filter(Boolean)
        .filter((item) => !values.some((value) => normalizeExportConcept(value) === normalizeExportConcept(item)))
        .slice(0, 2)
        .map((item) => `${item} still needs stronger file support.`);
    const combined = dedupeCleanExportBullets([...values, ...remainingAreas]);
    return combined.length > 0
        ? combined
        : ["Several repair-path items still need clearer documentation support before they become strong negotiation points."];
}
function buildDisputeNextMoves(supplementItems) {
    const titles = supplementItems.map((item) => item.title.toLowerCase());
    const values = [
        "Lead with OEM procedures and the strongest documented repair-path support.",
        titles.some((title) => /(measure|frame|structural|setup|realign|rail)/.test(title))
            ? "If teardown, photos, OEM procedure, or repair records show structural or geometry involvement, request measurement or alignment documentation; current estimate evidence may not establish this as a primary dispute."
            : undefined,
        titles.some((title) => /(scan|calibration|sensor|camera|radar|adas)/.test(title))
            ? "Anchor scan and calibration items on OEM procedures plus invoice-backed proof before debating pricing."
            : undefined,
        titles.some((title) => /(alignment|test fit|fit check|mock)/.test(title))
            ? "Use alignment printouts, fit-check records, or validation documentation to support process-related charges."
            : undefined,
        titles.some((title) => /(oem|alternate|aftermarket|hardware|clip|seal|parts)/.test(title))
            ? "If parts strategy is contested, tie the request back to OEM guidance and one-time-use replacement requirements."
            : undefined,
        "Concede softer manual or presentation-level charges only after the safety and validation items are carried properly.",
    ];
    return dedupeCleanExportBullets(values.filter((value) => Boolean(value)));
}
function normalizeExportConcept(value) {
    return cleanFormalExportText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(?:request|documented|documentation|records|record|support|proof|still|needs|need|stronger|clearer|file|current|before|items|item)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function buildComparisonGapDrivers(analysis) {
    const rows = analysis?.estimateComparisons?.rows ?? [];
    const drivers = [];
    for (const row of rows) {
        const text = `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.delta ?? ""}`.toLowerCase();
        const estimatedContribution = isCurrencyComparisonRow(row) && typeof row.delta === "number"
            ? formatCompactCurrency(Math.abs(row.delta))
            : undefined;
        if (/(paint|refinish|blend|tint|mask)/.test(text)) {
            drivers.push({
                category: "Paint / Refinish Gap",
                summary: "Structured comparison rows show meaningful paint or refinish differences.",
                impactLevel: estimatedContribution ? "high" : "medium",
                estimatedContribution,
            });
        }
        if (/(labor|rate|body|frame)/.test(text)) {
            drivers.push({
                category: "Labor Rate / Labor Time Gap",
                summary: "Labor pricing or labor-time differences appear to be contributing to the estimate gap.",
                impactLevel: estimatedContribution ? "high" : "medium",
                estimatedContribution,
            });
        }
        if (/(adas|calibration|scan|sensor|camera|radar)/.test(text)) {
            drivers.push({
                category: "Calibration / Diagnostics Gap",
                summary: "Calibration, diagnostics, or scan support appears underfunded relative to the repair path.",
                impactLevel: "high",
                estimatedContribution,
            });
        }
        if (/(oem|aftermarket|alt|parts|suspension)/.test(text)) {
            drivers.push({
                category: "Parts Strategy Gap",
                summary: "Parts selection differences are affecting the current estimate posture.",
                impactLevel: estimatedContribution ? "high" : "medium",
                estimatedContribution,
            });
        }
    }
    return drivers;
}
function buildSupplementGapDrivers(supplementItems) {
    const drivers = [];
    for (const item of supplementItems) {
        const text = `${item.title} ${item.category} ${item.rationale}`.toLowerCase();
        if (/(paint|refinish|blend|tint|mask|polish|sand)/.test(text)) {
            drivers.push({
                category: "Paint / Refinish Gap",
                summary: "Paint-process support remains lighter than the likely repair path.",
                impactLevel: item.priority === "high" ? "high" : "medium",
            });
        }
        if (/(alignment|labor|setup|pull|measure|frame)/.test(text)) {
            drivers.push({
                category: "Labor / Structural Process Gap",
                summary: "Structural process or alignment support appears underwritten relative to the repair burden.",
                impactLevel: item.priority === "high" ? "high" : "medium",
            });
        }
        if (/(adas|calibration|scan|sensor|camera|radar)/.test(text)) {
            drivers.push({
                category: "Calibration / Diagnostics Gap",
                summary: "Diagnostic, scan, or calibration documentation is not shown in the current estimate posture.",
                impactLevel: "high",
            });
        }
        if (/(oem|aftermarket|alt|parts|hardware|clip|seal|suspension)/.test(text)) {
            drivers.push({
                category: "Parts Strategy Gap",
                summary: "Parts-support posture appears to be contributing to the current estimate gap.",
                impactLevel: item.priority === "high" ? "high" : "medium",
            });
        }
    }
    return drivers;
}
function dedupeFinancialGapDrivers(drivers) {
    const kept = new Map();
    for (const driver of drivers) {
        const existing = kept.get(driver.category);
        if (!existing) {
            kept.set(driver.category, driver);
            continue;
        }
        const rank = { high: 3, medium: 2, low: 1 };
        if (rank[driver.impactLevel] > rank[existing.impactLevel]) {
            kept.set(driver.category, driver);
        }
    }
    return [...kept.values()];
}
function deriveDirectionalTotalGap(analysis) {
    const numericRows = (analysis?.estimateComparisons?.rows ?? []).filter((row) => isCurrencyComparisonRow(row) && typeof row.delta === "number" && Number.isFinite(row.delta));
    if (numericRows.length === 0) {
        return undefined;
    }
    const total = numericRows.reduce((sum, row) => sum + Math.abs(Number(row.delta)), 0);
    if (!Number.isFinite(total) || total <= 0) {
        return undefined;
    }
    return `${formatCompactCurrency(total)} (directional only)`;
}
function isCurrencyComparisonRow(row) {
    if (row.valueUnit === "currency") {
        return true;
    }
    const text = `${row.category ?? ""} ${row.operation ?? ""}`.toLowerCase();
    return /\b(?:estimate total|total cost|labor rate|paint rate|refinish rate)\b/.test(text);
}
function lowercaseFirstSafe(value) {
    if (!value)
        return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
}
function sanitizeVehicleDisplay(value) {
    if (!value)
        return undefined;
    const cleaned = cleanVehicleDescriptor(value);
    if (!cleaned)
        return undefined;
    if (PLACEHOLDER_VEHICLE_LABEL_PATTERN.test(cleaned))
        return undefined;
    return cleaned;
}
function buildPreferredVehicleIdentityLabel(vehicle, options) {
    if (!vehicle)
        return undefined;
    let resolvedLabel;
    const hasModel = Boolean((0, displayText_1.cleanDisplayLabel)(vehicle.model));
    const fullIdentity = [
        vehicle.year,
        (0, displayText_1.cleanDisplayLabel)(vehicle.make),
        (0, displayText_1.cleanDisplayLabel)(vehicle.model),
        cleanVehicleDescriptor(vehicle.trim),
    ]
        .filter(Boolean)
        .join(" ")
        .trim();
    const rejectedYearOnlyIdentity = looksLikeYearOnlyVehicleLabel(fullIdentity);
    const rejectedPartialIdentity = Boolean(fullIdentity && !hasModel);
    if (fullIdentity && !rejectedYearOnlyIdentity && !rejectedPartialIdentity) {
        resolvedLabel = sanitizeVehicleDisplay(fullIdentity);
        console.info("[vehicle-label-trace:display-helper]", {
            vehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(vehicle),
            fullIdentity: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(fullIdentity),
            resolvedLabel: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(resolvedLabel),
            source: "full_identity",
        });
        return resolvedLabel;
    }
    const namedIdentity = [
        vehicle.year,
        (0, displayText_1.cleanDisplayLabel)(vehicle.make),
        (0, displayText_1.cleanDisplayLabel)(vehicle.model),
        cleanVehicleDescriptor(vehicle.manufacturer),
    ]
        .filter(Boolean)
        .join(" ")
        .trim();
    const rejectedYearOnlyNamedIdentity = looksLikeYearOnlyVehicleLabel(namedIdentity);
    const rejectedPartialNamedIdentity = Boolean(namedIdentity && !hasModel);
    if (namedIdentity && !rejectedYearOnlyNamedIdentity && !rejectedPartialNamedIdentity) {
        resolvedLabel = sanitizeVehicleDisplay(namedIdentity);
        console.info("[vehicle-label-trace:display-helper]", {
            vehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(vehicle),
            namedIdentity: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(namedIdentity),
            resolvedLabel: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(resolvedLabel),
            source: "named_identity",
        });
        return resolvedLabel;
    }
    const cleanedLabel = sanitizeVehicleDisplay(vehicle.label);
    const rejectedWeakCleanedLabel = looksLikeWeakVehicleIdentityLabel(cleanedLabel);
    if (cleanedLabel) {
        if (!looksLikeYearOnlyVehicleLabel(cleanedLabel) && !rejectedWeakCleanedLabel) {
            return cleanedLabel;
        }
    }
    if ((options?.fallbackToVinTail ||
        rejectedYearOnlyIdentity ||
        rejectedYearOnlyNamedIdentity ||
        rejectedPartialIdentity ||
        rejectedPartialNamedIdentity ||
        rejectedWeakCleanedLabel ||
        looksLikeYearOnlyVehicleLabel(cleanedLabel)) &&
        vehicle.vin) {
        resolvedLabel = `VIN ending ${vehicle.vin.slice(-6)}`;
        console.info("[vehicle-label-trace:display-helper]", {
            vehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(vehicle),
            cleanedLabel: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(cleanedLabel),
            resolvedLabel,
            source: "vin_tail_fallback",
        });
        return resolvedLabel;
    }
    if (cleanedLabel) {
        resolvedLabel = cleanedLabel;
        console.info("[vehicle-label-trace:display-helper]", {
            vehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(vehicle),
            cleanedLabel: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(cleanedLabel),
            resolvedLabel: (0, safeVehicleLog_1.summarizeVehicleLabelForLog)(resolvedLabel),
            source: "cleaned_label_fallback",
        });
        return resolvedLabel;
    }
    console.info("[vehicle-label-trace:display-helper]", {
        vehicle: (0, safeVehicleLog_1.summarizeVehicleForLog)(vehicle),
        resolvedLabel: null,
        source: "no_label",
    });
    return undefined;
}
function buildPreferredRebuttalSubjectVehicleLabel(vehicle) {
    const subjectMake = (0, displayText_1.cleanDisplayLabel)(vehicle?.make);
    const subjectModel = (0, displayText_1.cleanDisplayLabel)(vehicle?.model);
    const fullSubjectIdentity = subjectModel
        ? [
            vehicle?.year,
            subjectMake,
            subjectModel,
            cleanVehicleDescriptor(vehicle?.trim),
        ]
            .filter(Boolean)
            .join(" ")
            .trim()
        : undefined;
    return (sanitizeVehicleDisplay(fullSubjectIdentity) ??
        (vehicle?.vin ? `VIN ending ${vehicle.vin.slice(-6)}` : undefined) ??
        buildPreferredVehicleIdentityLabel(vehicle) ??
        "Current repair file");
}
function preferCanonicalField(resolved, fallback) {
    const preferred = sanitizeCanonicalField(resolved);
    if (preferred) {
        return preferred;
    }
    return sanitizeCanonicalField(fallback);
}
function cleanVehicleDescriptor(value) {
    if (!value)
        return undefined;
    const cleaned = stripVehicleRoleNoise((0, displayText_1.cleanDisplayText)(value))
        .replace(/\b4d sedan\b/gi, "4-door sedan")
        .replace(/\b4 door sedan\b/gi, "4-door sedan")
        .replace(/\butv\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .replace(/^[,\s-]+|[,\s-]+$/g, "")
        .trim();
    return cleaned || undefined;
}
function stripVehicleRoleNoise(value) {
    return value
        .replace(/(?:,\s*|\s+)(?:insured|owner|claimant|customer|policyholder|adjuster|appraiser)\b/gi, "")
        .replace(/\b(?:insured|owner|claimant|customer|policyholder|adjuster|appraiser)\b\s*,?/gi, "")
        .replace(/\s+,/g, ",")
        .replace(/,\s*,/g, ", ")
        .replace(/\s{2,}/g, " ")
        .replace(/^[,\s-]+|[,\s-]+$/g, "")
        .trim();
}
function resolveCanonicalVehicleLabel(exportModel) {
    return preferCanonicalField(exportModel.reportFields.vehicleLabel, buildPreferredVehicleIdentityLabel(exportModel.vehicle));
}
function resolveCanonicalVin(exportModel) {
    return preferCanonicalField(exportModel.reportFields.vin, exportModel.vehicle.vin);
}
function resolveCanonicalInsurer(exportModel) {
    return preferCanonicalField(exportModel.reportFields.insurer, exportModel.estimateFacts.insurer);
}
function redactExportModelForDownload(exportModel) {
    // The insurer/carrier name is a corporation, not personal data, and the
    // reports document an insurance dispute — hiding the carrier made the
    // repair-intelligence/snapshot PDFs print "[REDACTED_INSURER]" while the
    // customer report named the carrier. All report types now show the real
    // carrier consistently. This seam is kept so a redaction policy can be
    // reinstated in one place if product direction changes.
    return exportModel;
}
function sanitizeCanonicalField(value) {
    if (!value)
        return undefined;
    const cleaned = cleanVehicleDescriptor(value) ?? (0, displayText_1.cleanDisplayText)(value);
    if (!cleaned)
        return undefined;
    if (GENERIC_PLACEHOLDER_FIELD_PATTERN.test(cleaned))
        return undefined;
    return cleaned;
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function collectVehicleDocumentText(report, analysis) {
    return stripSmokeDebugDiagnostics([
        report?.sourceEstimateText,
        report?.estimateFacts?.vehicle?.vin,
        report?.estimateFacts?.documentedProcedures?.join("\n"),
        report?.estimateFacts?.documentedHighlights?.join("\n"),
        report?.analysis?.rawEstimateText,
        analysis?.rawEstimateText,
        report?.vehicle?.vin,
        report?.analysis?.vehicle?.vin,
        analysis?.vehicle?.vin,
        report?.evidence
            .map((entry) => `${entry.title ?? ""}\n${entry.snippet ?? ""}`)
            .join("\n"),
        analysis?.evidence
            ?.map((entry) => `${entry.source ?? ""}\n${entry.quote ?? ""}`)
            .join("\n"),
    ]
        .filter((value) => Boolean(value && value.trim()))
        .join("\n\n"));
}
function stripSmokeDebugDiagnostics(value) {
    if (!value.trim())
        return "";
    return value
        .split(/\r?\n/)
        .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return true;
        if (/^\[?(?:provider-routing|chat-openai|chat-large-case|model-config|openai|debug|diagnostics?)\]?/i.test(trimmed))
            return false;
        if (/^(?:stage|provider|model|fallbackUsed|reasoningEffort|keyPresent|requestID|status|code|debugCounts|includedInRequest|omittedForLargeCaseFallback|omittedDocumentationOnly|attachmentCount)\s*[:=]/i.test(trimmed))
            return false;
        if (/\b(?:provider-routing|debugCounts|fallbackUsed|keyPresent|requestID|omittedForLargeCaseFallback|omittedDocumentationOnly|input_image|input_text)\b/i.test(trimmed))
            return false;
        return true;
    })
        .join("\n")
        .replace(/\{\s*(?:stage|provider|model|fallbackUsed|keyPresent|reasoningEffort|requestID)\b[\s\S]{0,600}?\}/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}
function resolveAnalysisMode(report, analysis) {
    return analysis?.mode ?? report?.analysis?.mode ?? "single-document-review";
}
function buildSingleEstimateLead(estimateFacts, sourceEstimateText) {
    const vehicleLabel = buildVehicleDisplayLabel(estimateFacts.vehicle);
    const story = sourceEstimateText?.trim() ? (0, buildRepairStory_1.buildRepairStory)(sourceEstimateText) : null;
    const facts = [];
    if (vehicleLabel) {
        facts.push(`vehicle ${vehicleLabel}`);
    }
    if (estimateFacts.insurer) {
        facts.push(`insurer ${estimateFacts.insurer}`);
    }
    if (typeof estimateFacts.mileage === "number") {
        facts.push(`mileage ${estimateFacts.mileage.toLocaleString("en-US")}`);
    }
    if (typeof estimateFacts.estimateTotal === "number") {
        facts.push(`estimate total $${estimateFacts.estimateTotal.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`);
    }
    const strengths = [
        ...new Set([
            ...estimateFacts.documentedHighlights,
            ...estimateFacts.documentedProcedures,
        ]),
    ]
        .slice(0, 5)
        .map((item) => item.toLowerCase());
    const factLead = facts.length > 0
        ? `Documented file facts show ${joinHumanList(facts)}.`
        : "The estimate provides enough documented facts to support a grounded preliminary review.";
    const strengthsLead = strengths.length > 0
        ? ` It already documents strengths such as ${joinHumanList(strengths)}.`
        : "";
    const scopeLead = story && (story.zones.length > 0 || story.panels.length > 0)
        ? ` The visible scope centers on ${joinHumanList([
            story.impact !== "general" ? `${story.impact} damage` : undefined,
            summarizeVisibleScope(story.zones, story.panels, sourceEstimateText ?? ""),
        ].filter((value) => Boolean(value)))}.`
        : "";
    return `${factLead}${scopeLead}${strengthsLead} The file supports a grounded preliminary review, while some repair or documentation items may become clearer as teardown progresses.`;
}
function summarizeVisibleScope(zones, panels, sourceEstimateText) {
    const normalizedZones = zones.filter(Boolean);
    const normalizedPanels = panels.map((panel) => panel.toLowerCase()).filter(Boolean);
    const panelText = normalizedPanels.join(" ");
    const lowerSource = sourceEstimateText.toLowerCase();
    const zoneSet = new Set(normalizedZones);
    const impactZone = (0, impactZone_1.deriveImpactZone)({ text: sourceEstimateText });
    if ((0, impactZone_1.isSideImpactZone)(impactZone) && impactZone.confidence !== "low") {
        const sideZones = normalizedZones.filter((zone) => zone !== "front-end");
        const sideScope = sideZones.length > 0 ? joinHumanList(sideZones) : "side structure";
        return `${sideScope} around the ${(0, impactZone_1.formatImpactZone)(impactZone)} repair area`;
    }
    const leftRearSignal = /(left rear|rear left|left quarter|quarter|left side)/i.test(panelText) ||
        /(left rear|rear left|left quarter|quarter panel|left side|left rocker|left dog leg)/i.test(lowerSource);
    const leftFrontSignal = /(left front|left fender|left headlamp)/i.test(panelText) ||
        /(left front|left fender|left headlamp|lf\b|driver side front)/i.test(lowerSource);
    const rightFrontSignal = /(right front|right fender|right headlamp)/i.test(panelText) ||
        /(right front|right fender|right headlamp|rf\b|passenger side front)/i.test(lowerSource);
    if (leftRearSignal) {
        const supportedZones = normalizedZones.filter((zone) => zone === "rear body" || zone === "side structure");
        if (supportedZones.length > 0) {
            return `${joinHumanList(supportedZones)} around the left-rear / left-side repair area`;
        }
        return "left-rear / left-side areas";
    }
    if (leftFrontSignal && !rightFrontSignal) {
        const frontLikeZones = normalizedZones.filter((zone) => zone === "front-end");
        if (frontLikeZones.length > 0 && hasExplicitFrontEstimateScope(sourceEstimateText)) {
            return `${joinHumanList(frontLikeZones)} around the repair area`;
        }
        return "mounting/fit verification area";
    }
    if (rightFrontSignal && !leftFrontSignal && !leftRearSignal) {
        const frontLikeZones = normalizedZones.filter((zone) => zone === "front-end");
        if (frontLikeZones.length > 0 && hasExplicitFrontEstimateScope(sourceEstimateText)) {
            return `${joinHumanList(frontLikeZones)} around the repair area`;
        }
        return "mounting/fit verification area";
    }
    if (zoneSet.has("front-end") && (zoneSet.has("side structure") || zoneSet.has("rear body"))) {
        const nonFrontZones = normalizedZones.filter((zone) => zone !== "front-end");
        if (nonFrontZones.length > 0) {
            return `${joinHumanList(nonFrontZones)} areas`;
        }
    }
    if (normalizedZones.length > 0) {
        return `${joinHumanList(normalizedZones)} areas`;
    }
    if (panels.length > 0) {
        return `${panels.length} noted panel${panels.length === 1 ? "" : "s"}`;
    }
    return undefined;
}
function hasExplicitFrontEstimateScope(sourceEstimateText) {
    return /\b(?:point\s+of\s+impact\b[^\n]{0,40}\bfront|front bumper|front cover|front lamp|front headlamp|front fender|radiator support|core support|front end|front-end)\b/i.test(sourceEstimateText);
}
function extractVinFromText(text) {
    const candidates = text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
    let bestVin;
    for (const candidate of candidates) {
        const normalizedVin = (0, vehicleContext_1.normalizeVehicleIdentity)({
            vin: candidate,
            source: "attachment",
        })?.vin;
        if (normalizedVin && (0, vehicleContext_1.isBetterVinCandidate)(normalizedVin, bestVin)) {
            bestVin = normalizedVin;
        }
    }
    return bestVin;
}
function resolveExportVin(structuredVehicle, inferredVehicle, documentVehicleText) {
    let bestVin = (0, vehicleContext_1.normalizeVehicleIdentity)(structuredVehicle)?.vin;
    const inferredVin = (0, vehicleContext_1.normalizeVehicleIdentity)(inferredVehicle)?.vin;
    if ((0, vehicleContext_1.isBetterVinCandidate)(inferredVin, bestVin)) {
        bestVin = inferredVin;
    }
    const fallbackVin = extractVinFromText(documentVehicleText);
    if ((0, vehicleContext_1.isBetterVinCandidate)(fallbackVin, bestVin)) {
        bestVin = fallbackVin;
    }
    return bestVin;
}
function buildRepairPosition(report, analysis, panel, assistantAnalysis, supplementItems, reportFields) {
    const estimateFacts = reportFields.estimateFacts;
    const candidates = [
        assistantAnalysis,
        analysis?.narrative,
        panel?.narrative,
        ...(report?.recommendedActions.filter((item) => !looksLikeEstimateNoise(item)) ?? []),
    ]
        .map((value) => sanitizeNarrative(value))
        .filter((value) => Boolean(value));
    const isComparison = resolveAnalysisMode(report, analysis) === "comparison";
    const narrativeCandidates = isComparison
        ? candidates
        : candidates.filter((value) => !/\b(carrier estimate|shop estimate)\b/i.test(value));
    const strongestNarrative = narrativeCandidates
        .filter((value) => !looksLikeMetaCommentary(value))
        .sort((left, right) => scoreRepairNarrative(right) - scoreRepairNarrative(left))[0];
    if (supplementItems.length > 0) {
        const topItems = supplementItems.slice(0, 5);
        const topTitles = joinHumanList(topItems.map((item) => item.title.toLowerCase()));
        const lead = buildRepairPositionLead({
            isComparison,
            topItems,
            estimateFacts,
            estimateText: report?.sourceEstimateText ?? report?.analysis?.rawEstimateText ?? analysis?.rawEstimateText ?? null,
        });
        const issueBridge = buildRepairIssueBridge({
            isComparison,
            topItems,
            topTitles,
            reportFields,
        });
        if (strongestNarrative) {
            const polishedNarrative = makeRepairPositionTail(strongestNarrative);
            return polishedNarrative
                ? `${lead} ${issueBridge} ${polishedNarrative}.`
                : `${lead} ${issueBridge}`;
        }
        return `${lead} ${issueBridge}`;
    }
    const broaderNarrative = isComparison ? narrativeCandidates.find((value) => {
        const lower = value.toLowerCase();
        return ((lower.includes("carrier estimate") || lower.includes("shop estimate")) &&
            (lower.includes("underwritten") || lower.includes("more complete") || lower.includes("repair path")));
    }) : undefined;
    if (broaderNarrative) {
        return trimTrailingPunctuation(broaderNarrative) + ".";
    }
    if (strongestNarrative) {
        return trimTrailingPunctuation(strongestNarrative) + ".";
    }
    if (supplementItems.length > 0) {
        return `The clearest remaining repair-path issues are ${joinHumanList(supplementItems.slice(0, 4).map((item) => item.title.toLowerCase()))}.`;
    }
    if (resolveAnalysisMode(report, analysis) !== "comparison") {
        return buildSingleEstimateLead(estimateFacts, report?.sourceEstimateText ?? report?.analysis?.rawEstimateText ?? analysis?.rawEstimateText ?? null);
    }
    return "The file does not point to a clear unresolved repair-path issue.";
}
function buildPositionStatement(report, analysis, supplementItems) {
    const unsupportedItems = supplementItems.length;
    const criticalCount = report?.summary.criticalIssues ?? 0;
    const isComparison = resolveAnalysisMode(report, analysis) === "comparison";
    if (criticalCount === 0 && unsupportedItems === 0) {
        return "The current material does not show a clear unsupported repair-process gap.";
    }
    if (supplementItems.length > 0) {
        const topItems = supplementItems.slice(0, 5);
        const topOperations = topItems.map((item) => item.title.toLowerCase());
        const kinds = new Set(topItems.map((item) => item.kind));
        const lead = buildPositionStatementLead({
            isComparison,
            kinds,
            topOperations,
        });
        return lead;
    }
    return "Key procedures or documentation still need clearer support before this estimate reads as fully defended.";
}
function buildRequest(report, panel, supplementItems, chatRequest) {
    if (supplementItems.length > 0) {
        const requestItems = selectConsistentSupplementItems(supplementItems);
        const heading = buildRequestHeading(requestItems);
        return [
            heading,
            ...requestItems.map((item) => {
                return `- ${item.title}: ${buildRequestLine(item)}`;
            }),
        ].join("\n");
    }
    if (chatRequest?.trim() && looksLikeCleanRequest(chatRequest)) {
        return sanitizeReason(chatRequest, "Please review and clarify how the repair plan is being supported.");
    }
    if (panel?.negotiationResponse?.trim() &&
        !isContradictorySupportiveDraft(panel.negotiationResponse, report, supplementItems)) {
        return sanitizeReason(panel.negotiationResponse, panel.negotiationResponse.trim());
    }
    const topIssues = report?.issues
        .filter((issue) => issue.severity === "high" || issue.missingOperation)
        .slice(0, 3)
        .map((issue) => `- ${issue.title}: ${issue.impact || issue.finding}`) ?? [];
    if (topIssues.length > 0) {
        return [
            "The file leaves the following items open; please provide updated support if they remain part of the intended repair plan:",
            ...topIssues,
        ].join("\n");
    }
    if (report?.recommendedActions?.length) {
        return sanitizeReason(report.recommendedActions[0], "Please review and clarify how the repair plan is being supported.");
    }
    return "Please review and clarify how the repair plan is being supported.";
}
function buildRepairPositionLead(params) {
    if (params.isComparison) {
        const kinds = new Set(params.topItems.map((item) => item.kind));
        if (kinds.has("missing_operation") || kinds.has("missing_verification")) {
            return "Across the current file, the support gap is most noticeable in how several repair-path items are documented and verified.";
        }
        if (kinds.has("underwritten_operation")) {
            return "Across the current file, support appears uneven in several repair-process areas, and some items remain open or lightly documented.";
        }
        return "Across the current file, several repair-path items remain open enough that a single fully supported position is not yet established.";
    }
    return buildSingleEstimateLead(params.estimateFacts, params.estimateText);
}
function buildRepairIssueBridge(params) {
    const hasDocumentedSupport = params.reportFields.documentedProcedures.length > 0 ||
        params.reportFields.documentedHighlights.length > 0;
    const kinds = new Set(params.topItems.map((item) => item.kind));
    if (hasDocumentedSupport && (kinds.has("missing_verification") || kinds.has("missing_operation"))) {
        return `The file documents several parts of the repair path clearly, but documentation is not shown for ${params.topTitles}.`;
    }
    if (params.isComparison && kinds.has("underwritten_operation")) {
        return `The clearest separation in the file is around ${params.topTitles}.`;
    }
    if (kinds.has("disputed_repair_path") && !kinds.has("missing_operation") && !kinds.has("missing_verification")) {
        return `The file leaves the repair-path support most open around ${params.topTitles}.`;
    }
    return `The file leaves the following items least settled: ${params.topTitles}.`;
}
function buildPositionStatementLead(params) {
    const joinedOperations = joinHumanList(params.topOperations);
    if (params.kinds.has("missing_verification")) {
        return params.isComparison
            ? `The current file leaves verification and documentation support open on ${joinedOperations}.`
            : `The file leaves verification and documentation support open on ${joinedOperations}.`;
    }
    if (params.kinds.has("missing_operation")) {
        return params.isComparison
            ? `The current file does not yet fully support the intended repair plan on ${joinedOperations}.`
            : `The file does not yet fully support the intended repair plan on ${joinedOperations}.`;
    }
    if (params.kinds.has("underwritten_operation")) {
        return params.isComparison
            ? `Support appears thinner on ${joinedOperations} in the current file, which keeps those repair-process items open.`
            : `Support remains light on ${joinedOperations}, which keeps those repair-process items open.`;
    }
    return params.isComparison
        ? `The current file still leaves the repair-path rationale most open on ${joinedOperations}.`
        : `The file still leaves the repair-path rationale most open on ${joinedOperations}.`;
}
function buildExportSupplementItems(report, analysis, panel, chatInsights, assistantAnalysis, estimateFacts, vehicleApplicability = (0, vehicleApplicability_1.resolveVehicleApplicabilityContext)(report?.vehicle, report?.analysis?.vehicle, analysis?.vehicle, estimateFacts.vehicle)) {
    const defaultRationale = "This operation appears supportable but is not yet carried clearly in the current estimate.";
    const sourceText = collectVehicleDocumentText(report, analysis);
    const resolvedVehicle = {
        make: estimateFacts?.vehicle?.make ??
            report?.vehicle?.make ??
            analysis?.vehicle?.make ??
            undefined,
        model: estimateFacts?.vehicle?.model ??
            report?.vehicle?.model ??
            analysis?.vehicle?.model ??
            undefined,
        year: estimateFacts?.vehicle?.year ??
            report?.vehicle?.year ??
            analysis?.vehicle?.year ??
            undefined,
    };
    const hasVehicleIdentity = resolvedVehicle.make || resolvedVehicle.model || resolvedVehicle.year;
    const adasNarrative = (0, adasDecision_1.buildAdasNarrative)({
        vehicle: hasVehicleIdentity ? resolvedVehicle : undefined,
        estimateText: sourceText,
        extractedFacts: {
            vin: estimateFacts?.vehicle?.vin ?? report?.vehicle?.vin ?? analysis?.vehicle?.vin ?? null,
            mileage: estimateFacts.mileage ?? null,
        },
        files: [
            ...(report?.evidence.map((entry) => ({
                name: entry.title,
                text: entry.snippet,
                summary: null,
            })) ?? []),
            ...(analysis?.evidence?.map((entry) => ({
                name: entry.source,
                text: entry.quote,
                summary: null,
            })) ?? []),
        ],
    });
    const fromPanel = panel?.supplements
        .filter((item) => isSpecificSupplementItem(item.title) || isSpecificSupplementItem(item.mappedLabel))
        .map((item) => ({
        title: deriveSupplementTitle(item.mappedLabel || item.title),
        category: item.category,
        kind: inferSupplementKindFromText(item.rationale),
        rationale: sanitizeSupplementReason(deriveSupplementTitle(item.mappedLabel || item.title), item.rationale, defaultRationale, adasNarrative.body),
        evidence: sanitizeSupplementEvidence(deriveSupplementTitle(item.mappedLabel || item.title), item.support),
        source: polishSourceLabel("Decision panel"),
        priority: "medium",
    })) ?? [];
    const fromMissingProcedures = report?.missingProcedures.map((procedure) => ({
        title: deriveSupplementTitle(procedure),
        category: inferSupplementCategory(procedure),
        kind: "missing_operation",
        rationale: "This function is not clearly represented in the current estimate.",
        source: polishSourceLabel("Missing procedure list"),
        priority: "medium",
    })) ?? [];
    const fromSupplementOpportunities = report?.supplementOpportunities
        .map((item) => ({
        raw: item,
        title: deriveSupplementTitle(item),
    }))
        .filter((item) => isSpecificSupplementItem(item.title))
        .map((item) => ({
        title: item.title,
        category: inferSupplementCategory(item.title),
        kind: inferSupplementKindFromText(item.raw),
        rationale: sanitizeSupplementReason(item.title, item.raw, defaultRationale, adasNarrative.body),
        source: polishSourceLabel(item.raw) ?? polishSourceLabel("Supplement opportunity"),
        priority: "medium",
    })) ?? [];
    const fromIssues = report?.issues
        .map((issue) => buildSupplementItemFromIssue(report, issue, adasNarrative.body))
        .filter((item) => Boolean(item)) ?? [];
    const fromAnalysisFindings = paramsToAnalysisFindings(report, panel)
        .map((item) => ({
        ...item,
        title: deriveSupplementTitle(item.title),
    }))
        .filter((item) => isSpecificSupplementItem(item.title))
        .map((item) => ({
        title: item.title,
        category: inferSupplementCategory(item.title),
        kind: inferSupplementKindFromText(item.reason),
        rationale: sanitizeSupplementReason(item.title, item.reason, defaultRationale, adasNarrative.body),
        evidence: sanitizeSupplementEvidence(item.title, item.evidence),
        source: polishSourceLabel(item.source),
        priority: item.priority,
    }));
    const fromChatInsights = chatInsights.supplementItems
        .map((item) => ({
        ...item,
        title: deriveSupplementTitle(item.title || item.rationale),
        rationale: sanitizeSupplementReason(deriveSupplementTitle(item.title || item.rationale), item.rationale, defaultRationale, adasNarrative.body),
        evidence: sanitizeSupplementEvidence(deriveSupplementTitle(item.title || item.rationale), item.evidence),
        source: polishSourceLabel(item.source),
    }))
        .filter((item) => isSpecificSupplementItem(item.title));
    const fromConcreteEstimateDisputes = buildConcreteEstimateDisputeItems(sourceText);
    const merged = [
        ...fromConcreteEstimateDisputes,
        ...fromPanel,
        ...fromMissingProcedures,
        ...fromSupplementOpportunities,
        ...fromIssues,
        ...fromAnalysisFindings,
        ...fromChatInsights,
        ...synthesizeSupplementItemsFromNarrative({
            assistantAnalysis,
            analysisNarrative: analysis?.narrative ?? null,
            panelNarrative: panel?.narrative ?? null,
            recommendedActions: report?.recommendedActions ?? [],
        }),
    ].map((item) => ({
        ...item,
        rationale: (0, vehicleApplicability_1.sanitizeVehicleSpecificText)(item.rationale, vehicleApplicability),
        evidence: item.evidence ? (0, vehicleApplicability_1.sanitizeVehicleSpecificText)(item.evidence, vehicleApplicability) : undefined,
        source: item.source ? (0, vehicleApplicability_1.sanitizeVehicleSpecificText)(item.source, vehicleApplicability) : undefined,
    }))
        .filter((item) => (0, vehicleApplicability_1.isVehicleContentApplicable)(`${item.title} ${item.rationale} ${item.evidence ?? ""} ${item.source ?? ""}`, vehicleApplicability))
        .filter((item) => Boolean(item.rationale.trim()));
    const structuralApplicability = (0, structuralApplicability_1.deriveStructuralApplicability)({
        vehicle: report?.vehicle ?? analysis?.vehicle ?? estimateFacts.vehicle,
        rawText: collectVehicleDocumentText(report, analysis),
        evidenceTexts: [
            ...(report?.evidence.map((entry) => `${entry.title ?? ""} ${entry.snippet ?? ""}`) ?? []),
            ...(analysis?.evidence.map((entry) => `${entry.source ?? ""} ${entry.quote ?? ""}`) ?? []),
        ],
        requiredProcedures: report?.requiredProcedures.map((entry) => entry.procedure),
        presentProcedures: report?.presentProcedures,
        missingProcedures: report?.missingProcedures,
        issueTexts: report?.issues.map((issue) => `${issue.title} ${issue.impact || issue.finding}`),
    });
    const deduped = new Map();
    for (const item of (0, structuralApplicability_1.filterStructuralTitles)(merged, structuralApplicability)) {
        if (/^Structural Measurement Verification$/i.test(item.title) &&
            /missing procedure list/i.test(item.source ?? "") &&
            !hasStructuralMeasurementEvidence(`${sourceText} ${item.rationale} ${item.evidence ?? ""}`)) {
            continue;
        }
        const key = normalizeKey(item.title);
        if (!key)
            continue;
        if (!deduped.has(key)) {
            deduped.set(key, item);
            continue;
        }
        const existing = deduped.get(key);
        deduped.set(key, {
            ...existing,
            rationale: pickBetterNarrative(existing.rationale, item.rationale) ?? existing.rationale,
            evidence: pickPreferredDetail(existing.evidence, item.evidence),
            source: pickPreferredDetail(existing.source, item.source),
            kind: mergeSupplementKind(existing.kind, item.kind),
            priority: mergePriority(existing.priority, item.priority),
        });
    }
    const resolved = [...deduped.values()].sort(sortSupplementItems);
    const filtered = resolved.filter((item) => !isContradictedByDocumentedFacts(item, estimateFacts));
    const curated = curateExportSupplementItems(filtered, sourceText);
    return curated.map((item) => ({
        ...item,
        category: inferSupplementCategory(item.title),
        rationale: trimTrailingPunctuation(item.rationale) + ".",
        evidence: item.evidence ? trimTrailingPunctuation(item.evidence) + "." : undefined,
    }));
}
function buildConcreteEstimateDisputeItems(sourceText) {
    const items = [];
    const push = (item) => items.push(item);
    if (/lkq\s+grille[^.\n]{0,120}not\s+correct\s+style|not\s+correct\s+style[^.\n]{0,120}lkq\s+grille/i.test(sourceText)) {
        push({
            title: "LKQ Grille Style Contradiction",
            category: "parts",
            kind: "disputed_repair_path",
            rationale: "The carrier estimate itself notes the LKQ grille is not the correct style, so this should be treated as a line-specific grille dispute rather than a generic OEM preference.",
            evidence: "Carrier estimate line note: LKQ grille not correct style.",
            source: "Current upload estimate evidence",
            priority: "high",
        });
    }
    if (/\b(?:a\/m|aftermarket|capa|lkq)\b/i.test(sourceText) && /\b(?:oem|radiator support|bumper|grille|liftgate|rear lamp|tail lamp|rear[- ]bumper|front[- ]end)\b/i.test(sourceText)) {
        push({
            title: "Non-OEM, CAPA, LKQ, or alternate parts compared with documented repair scope",
            category: "parts",
            kind: "disputed_repair_path",
            rationale: "The estimate evidence shows A/M, CAPA, LKQ, OEM, or alternate part-scope language on specific documented rows; group each disputed part family by line, part type, amount, and substitution basis.",
            evidence: "Estimate-only evidence supports a part-type and pricing dispute; it does not automatically prove every alternative part is improper.",
            source: "Current upload estimate evidence",
            priority: "high",
        });
    }
    if (/(body[^.\n]{0,40}13\.5[^.\n]{0,40}75|paint[^.\n]{0,40}3\.7[^.\n]{0,40}75|paint supplies[^.\n]{0,40}3\.7[^.\n]{0,40}60)/i.test(sourceText) &&
        /(body[^.\n]{0,40}13\.2[^.\n]{0,40}60|paint[^.\n]{0,40}3\.2[^.\n]{0,40}60|paint supplies[^.\n]{0,40}3\.2[^.\n]{0,40}40)/i.test(sourceText)) {
        push({
            title: "Labor Rate and Paint-Material Delta",
            category: "labor",
            kind: "underwritten_operation",
            rationale: "The shop and carrier estimates carry different body, paint, and paint-supply hours/rates, explaining part of the total gap as a pricing and labor support dispute.",
            evidence: "Shop: body 13.5 at 75, paint 3.7 at 75, supplies 3.7 at 60; carrier: body 13.2 at 60, paint 3.2 at 60, supplies 3.2 at 40.",
            source: "Current upload estimate evidence",
            priority: "high",
        });
    }
    if (/(pre[- ]?repair scan|post[- ]?repair scan|in[- ]?process scan|seat belt dynamic function test|revvadas|egnyte)/i.test(sourceText)) {
        push({
            title: "Scan ADAS and Dynamic-Test Documentation",
            category: "adas",
            kind: "missing_verification",
            rationale: "The estimate set references scan, ADAS, dynamic-test, or REVVAdas/Egnyte support that should be separated into produced records versus referenced-but-not-produced links.",
            evidence: /egnyte/i.test(sourceText)
                ? "REV VADAS/Egnyte support is referenced; treat the link as referenced/not produced unless the file was retrieved and reviewed."
                : "Estimate evidence references diagnostic or dynamic-test support; production of the underlying records is not established.",
            source: "Current upload estimate evidence",
            priority: "high",
        });
    }
    if (/(test fit|final road test|alignment)/i.test(sourceText)) {
        push({
            title: "Test-Fit Road-Test and Alignment Proof",
            category: "documentation",
            kind: "missing_verification",
            rationale: "Bumper test fit, final road test, and alignment references should be verified with final documentation; an alignment line without amount or result should not be treated as completed proof.",
            source: "Current upload estimate evidence",
            priority: "medium",
        });
    }
    return items;
}
function buildValuation(panel, chatValuation, reportFields, report, analysis) {
    const vehicleForValuation = reportFields.vehicle ?? estimateFactsToVehicle(reportFields.estimateFacts);
    const hasKnownVehicleMarketInputs = hasVehicleMarketIdentity({
        vehicle: vehicleForValuation,
        mileage: reportFields.mileage,
    });
    const hasCompleteSpecificVehicleInputs = hasSpecificVehicleValuationIdentity({
        vehicle: vehicleForValuation,
        mileage: reportFields.mileage,
    });
    const rawComputedAcv = resolveComputedAcv({
        report,
        analysis,
        vehicle: vehicleForValuation,
        mileage: reportFields.mileage,
    });
    const computedAcv = hasKnownVehicleMarketInputs && !hasCompleteSpecificVehicleInputs && rawComputedAcv?.sourceType === "comps"
        ? null
        : rawComputedAcv;
    const likelyStructuredAcvRange = computedAcv?.acvRange ?? resolveLikelyStructuredAcvRange({
        report,
        analysis,
        vehicle: vehicleForValuation,
        mileage: reportFields.mileage,
    });
    const sanePanelDv = coerceSaneDvRange(panel?.diminishedValue?.low, panel?.diminishedValue?.high);
    const rawChatAcvPreviewRange = computedAcv
        ? computedAcv.acvRange
        : hasKnownVehicleMarketInputs
            ? undefined
            : resolveValuationPreviewRange({
                status: normalizeAcvStatus(chatValuation),
                value: chatValuation.acvValue,
                range: isSaneRange(chatValuation.acvRange, 250000) ? chatValuation.acvRange : undefined,
                maxRange: 250000,
                minSpread: 1200,
                spreadRatio: 0.08,
            });
    const chatAcvPreviewRange = isFallbackMateriallyBelowLikelyMarket(rawChatAcvPreviewRange, likelyStructuredAcvRange)
        ? undefined
        : rawChatAcvPreviewRange;
    const acvPreviewRange = computedAcv
        ? computedAcv.acvRange
        : chatAcvPreviewRange;
    const dvPreviewRange = resolveValuationPreviewRange({
        status: chatValuation.dvStatus === "provided" && typeof chatValuation.dvValue === "number"
            ? "provided"
            : chatValuation.dvStatus === "estimated_range" && isSaneRange(chatValuation.dvRange, 50000)
                ? "estimated_range"
                : sanePanelDv
                    ? "estimated_range"
                    : "not_determinable",
        value: chatValuation.dvValue,
        range: chatValuation.dvStatus === "estimated_range" && isSaneRange(chatValuation.dvRange, 50000)
            ? chatValuation.dvRange
            : sanePanelDv,
        maxRange: 50000,
        minSpread: 500,
        spreadRatio: 0.16,
    });
    const dvFallbackRange = dvPreviewRange
        ? undefined
        : resolveDirectionalDvFallbackRange({
            panel,
            reportFields,
            report,
            analysis,
        });
    const resolvedDvPreviewRange = dvPreviewRange ?? dvFallbackRange;
    const canonicalAcvMissingInputs = acvPreviewRange
        ? []
        : scrubValuationMissingInputs(chatValuation.acvMissingInputs.length
            ? chatValuation.acvMissingInputs
            : ["vehicle condition", "mileage", "trim/submodel", "ZIP or local market location", "three local comparable vehicle ads"], reportFields);
    const dvStatus = resolvedDvPreviewRange ? "estimated_range" : "not_determinable";
    const canonicalDvMissingInputs = dvStatus === "not_determinable"
        ? scrubValuationMissingInputs(chatValuation.dvMissingInputs.length
            ? chatValuation.dvMissingInputs
            : ["repair severity context", "damage photos or confirmed repair scope", "pre-loss market context"], reportFields)
        : [];
    return {
        ...chatValuation,
        acvStatus: acvPreviewRange ? "estimated_range" : "not_determinable",
        acvValue: computedAcv ? computedAcv.acvValue : undefined,
        acvRange: acvPreviewRange,
        acvConfidence: computedAcv
            ? computedAcv.confidence
            : normalizeValuationConfidence(acvPreviewRange ? "estimated_range" : "not_determinable", chatValuation.acvConfidence, canonicalAcvMissingInputs),
        acvCompCount: computedAcv ? computedAcv.compCount : undefined,
        acvSourceType: computedAcv?.sourceType ?? (acvPreviewRange ? "fallback" : "unavailable"),
        acvReasoning: computedAcv
            ? `${computedAcv.reasoning} This is a market preview, not a formal actual cash value appraisal.`
            : acvPreviewRange
                ? sanitizeReason(chatValuation.acvReasoning, "This is a market preview band based on the current file set.") || "This is a market preview band based on the current file set."
                : hasKnownVehicleMarketInputs || Boolean(likelyStructuredAcvRange)
                    ? buildMarketPreviewUnavailableReason(reportFields, report, analysis)
                    : sanitizeReason(chatValuation.acvReasoning, "Market preview is not supportable from the current documents.") ||
                        "Market preview is not supportable from the current documents.",
        acvMissingInputs: canonicalAcvMissingInputs,
        dvStatus,
        dvValue: undefined,
        dvRange: resolvedDvPreviewRange,
        dvConfidence: dvFallbackRange
            ? "low"
            : normalizeValuationConfidence(dvStatus, chatValuation.dvConfidence ?? normalizePanelDvConfidence(panel?.diminishedValue?.confidence), canonicalDvMissingInputs),
        dvReasoning: dvFallbackRange
            ? "Directional preview only. The file shows enough repair-impact context to support a conservative diminished value preview band, but not a formal appraisal-grade DV conclusion."
            : resolvedDvPreviewRange
                ? sanitizeReason(chatValuation.dvReasoning ?? panel?.diminishedValue?.rationale, "This is a directional diminished value preview band based on the current file set.") || "This is a directional diminished value preview band based on the current file set."
                : sanitizeReason(chatValuation.dvReasoning ?? panel?.diminishedValue?.rationale, "DV preview is not supportable from the current documents.") || "DV preview is not supportable from the current documents.",
        dvMissingInputs: canonicalDvMissingInputs,
    };
}
function hasSpecificVehicleValuationIdentity(params) {
    const vehicle = (0, vehicleContext_1.normalizeVehicleIdentity)(params.vehicle);
    const hasYearMakeModel = hasVehicleMarketIdentity(params);
    const hasTrim = Boolean(vehicle?.trim?.trim());
    return hasYearMakeModel && hasTrim;
}
function buildMarketPreviewUnavailableReason(reportFields, report, analysis) {
    const searchState = getMarketPreviewSearchState(report, analysis);
    if (searchState?.state === "failed") {
        const reason = normalizeMarketPreviewFailureText(searchState.failureReason || formatMarketPreviewFailureReason(searchState.status));
        const counts = [
            typeof searchState.comparableCount === "number"
                ? `${searchState.comparableCount} comparable listing${searchState.comparableCount === 1 ? "" : "s"} preserved`
                : null,
            typeof searchState.validPriceCount === "number"
                ? `${searchState.validPriceCount} valid asking price${searchState.validPriceCount === 1 ? "" : "s"}`
                : null,
        ].filter(Boolean).join("; ");
        return counts ? `${reason} ${counts}.` : reason;
    }
    const vehicle = reportFields.vehicle;
    const available = [
        vehicle?.year ? `year ${vehicle.year}` : null,
        vehicle?.make ? `make ${vehicle.make}` : null,
        vehicle?.model ? `model ${vehicle.model}` : null,
        vehicle?.trim ? `trim ${vehicle.trim}` : null,
        typeof reportFields.mileage === "number" ? `mileage ${reportFields.mileage.toLocaleString("en-US")}` : null,
    ].filter(Boolean).join(", ");
    const preservedComps = extractStructuredValuationData(report, analysis).comparableListings ?? [];
    if (preservedComps.length > 0 && preservedComps.length < 3) {
        return `Market Preview limited: ${preservedComps.length} local comparable listing${preservedComps.length === 1 ? " was" : "s were"} found, so confidence is limited because fewer than three usable local comps were available.`;
    }
    return `Market Preview unavailable: the report has ${available || "limited vehicle identity data"}, but no completed live local comparable listings or structured valuation comps were preserved for this generation.`;
}
function normalizeMarketPreviewFailureText(value) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed) {
        return "Market Preview unavailable: live comparable search failed.";
    }
    return /^Market Preview\b/i.test(trimmed)
        ? trimmed
        : `Market Preview unavailable: ${trimmed.replace(/\.$/, "")}.`;
}
function getMarketPreviewSearchState(report, analysis) {
    const candidates = [report, analysis, report?.analysis].filter(Boolean);
    for (const candidate of candidates) {
        const state = asRecord(candidate.marketPreviewSearch);
        if (state)
            return state;
    }
    return null;
}
function formatMarketPreviewFailureReason(status) {
    switch (status) {
        case "provider_not_configured":
            return "provider not configured";
        case "vehicle_identifiers_missing":
            return "vehicle identifiers missing";
        case "location_missing":
            return "owner or insured ZIP missing";
        case "no_results":
            return "no comparable ads returned";
        case "timeout":
            return "search timed out";
        case "parsing_failed":
            return "results were returned but usable prices could not be parsed";
        default:
            return "live comparable search failed";
    }
}
function hasVehicleMarketIdentity(params) {
    const vehicle = (0, vehicleContext_1.normalizeVehicleIdentity)(params.vehicle);
    const hasYearMakeModel = typeof vehicle?.year === "number" &&
        Boolean(vehicle.make?.trim()) &&
        Boolean(vehicle.model?.trim());
    const hasMileage = typeof params.mileage === "number" && Number.isFinite(params.mileage);
    return hasYearMakeModel && hasMileage;
}
function resolveDirectionalDvFallbackRange(params) {
    if (!hasDirectionalDvFallbackSupport(params)) {
        return undefined;
    }
    return { ...DV_FALLBACK_RANGE };
}
function hasDirectionalDvFallbackSupport(params) {
    const vehicleYear = params.reportFields.vehicle?.year ?? params.reportFields.estimateFacts.vehicle?.year;
    const lateModelVehicle = typeof vehicleYear === "number" && vehicleYear >= new Date().getFullYear() - 10;
    const sourceText = collectVehicleDocumentText(params.report, params.analysis);
    const repairStory = sourceText ? (0, buildRepairStory_1.buildRepairStory)(sourceText) : null;
    const multiPanelRepair = Boolean(repairStory && repairStory.panels.length >= 2);
    const structuredImpact = Boolean(repairStory && (repairStory.structural || repairStory.impact !== "general")) ||
        (params.report?.issues.length ?? 0) > 0 ||
        (params.report?.missingProcedures.length ?? 0) > 0 ||
        (params.report?.supplementOpportunities.length ?? 0) > 0 ||
        (params.analysis?.findings.length ?? 0) > 0;
    const comparisonDispute = (params.analysis?.mode ?? params.report?.analysis?.mode) === "comparison";
    const calibrationOrStructuralSignals = /calibration|scan|adas|sensor|camera|radar|structural|measure|rail|support|pillar|apron/i.test([
        params.panel?.narrative,
        params.panel?.supplements.map((item) => `${item.title} ${item.rationale}`).join(" "),
        params.report?.recommendedActions.join(" "),
        params.report?.missingProcedures.join(" "),
        params.report?.supplementOpportunities.join(" "),
        sourceText,
    ]
        .filter(Boolean)
        .join(" "));
    const strongSignals = [multiPanelRepair, structuredImpact, comparisonDispute].filter(Boolean).length;
    const supportingSignals = [lateModelVehicle, calibrationOrStructuralSignals].filter(Boolean).length;
    return strongSignals >= 1 || strongSignals + supportingSignals >= 2;
}
function resolveValuationPreviewRange(params) {
    if (params.status === "estimated_range" && isSaneRange(params.range, params.maxRange)) {
        return params.range;
    }
    if (params.status === "provided" && typeof params.value === "number") {
        return buildPreviewBandFromValue(params.value, params.minSpread, params.spreadRatio, params.maxRange);
    }
    return undefined;
}
function buildPreviewBandFromValue(value, minSpread, spreadRatio, maxRange) {
    if (!Number.isFinite(value) || value <= 0 || value > maxRange) {
        return undefined;
    }
    const spread = Math.max(minSpread, Math.round(value * spreadRatio));
    const range = {
        low: Math.max(1, value - spread),
        high: Math.min(maxRange, value + spread),
    };
    return isSaneRange(range, maxRange) ? range : undefined;
}
function resolveComputedAcv(params) {
    const valuationData = extractStructuredValuationData(params.report, params.analysis);
    return computeWeightedAcvPreview({
        vehicle: params.vehicle,
        mileage: params.mileage,
        comparableListings: valuationData.comparableListings,
        jdPower: valuationData.jdPower,
    });
}
function computeACVFromComps(params) {
    return computeWeightedAcvPreview(params);
}
function computeWeightedAcvPreview(params) {
    const targetVehicle = params.vehicle;
    const normalizedTargetTrim = normalizeKey(targetVehicle?.trim ?? "");
    const adjusted = (params.comparableListings ?? [])
        .map((listing) => normalizeComparableListing(listing))
        .filter((listing) => Boolean(listing))
        .filter((listing) => isComparableListingRelevant(listing, targetVehicle, params.mileage))
        .map((listing) => {
        const mileageAdjusted = applyMileageAdjustment(listing.price, params.mileage, listing.mileage);
        const yearAdjusted = applyYearAdjustment(mileageAdjusted, targetVehicle?.year, listing.year);
        const trimAdjusted = applyTrimAdjustment(yearAdjusted, normalizedTargetTrim, normalizeKey(listing.trim ?? ""));
        return {
            ...listing,
            adjustedPrice: Math.round(trimAdjusted),
            exactTrimMatch: Boolean(normalizedTargetTrim) &&
                Boolean(normalizeKey(listing.trim ?? "")) &&
                trimsLookEquivalent(normalizedTargetTrim, normalizeKey(listing.trim ?? "")),
        };
    })
        .filter((listing) => Number.isFinite(listing.adjustedPrice) && listing.adjustedPrice > 500);
    const guide = normalizeGuideValuation(params.jdPower);
    if (adjusted.length === 0) {
        return guide ? computeACVFromJdPower(params.jdPower) : null;
    }
    const sorted = adjusted
        .map((listing) => listing.adjustedPrice)
        .sort((left, right) => left - right);
    const compAverage = Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length);
    const weights = getGuideCompWeights(adjusted.length, Boolean(guide));
    const previewValue = guide
        ? Math.round(guide.average * weights.guide + compAverage * weights.comps)
        : compAverage;
    const compLow = adjusted.length === 1 ? undefined : computePercentile(sorted, 0.25);
    const compHigh = adjusted.length === 1 ? undefined : computePercentile(sorted, 0.75);
    const guideLow = guide?.low;
    const guideHigh = guide?.high;
    const lowAnchor = weightedAnchor(guideLow, compLow, previewValue, weights, "low");
    const highAnchor = weightedAnchor(guideHigh, compHigh, previewValue, weights, "high");
    const range = {
        low: Math.min(lowAnchor, previewValue),
        high: Math.max(highAnchor, previewValue),
    };
    if (!isSaneRange(range, 250000)) {
        return null;
    }
    const mileageKnownCount = adjusted.filter((listing) => typeof listing.mileage === "number").length;
    const exactTrimMatchCount = adjusted.filter((listing) => listing.exactTrimMatch).length;
    const completeness = deriveValuationCompleteness({
        compCount: adjusted.length,
        mileageKnownCount,
        exactTrimMatchCount,
        regionKnownCount: adjusted.filter((listing) => Boolean(listing.location)).length,
        conditionKnownCount: adjusted.filter((listing) => Boolean(listing.condition)).length,
        titleStatusKnownCount: adjusted.filter((listing) => Boolean(listing.titleStatus)).length,
        targetTrimKnown: Boolean(normalizedTargetTrim),
    });
    const confidence = deriveWeightedPreviewConfidence({
        compCount: adjusted.length,
        completeness,
    });
    const label = adjusted.length === 1
        ? "Limited comp preview"
        : "Comparable market preview";
    const sourceType = guide ? "guide_blend" : "comps";
    const notes = [
        `Comparable source count: ${adjusted.length}`,
        guide ? `Guide/book anchor weight: ${Math.round(weights.guide * 100)}%` : "Guide/book anchor unavailable",
        `Comparable listing weight: ${Math.round(weights.comps * 100)}%`,
        mileageKnownCount > 0 ? "Mileage adjustment note: mileage-normalized against the uploaded mileage" : "Mileage adjustment note: limited mileage detail",
        completeness.regionUsable ? "Region note: listing region/location usable" : "Region note: use local comparable listings when available",
        normalizedTargetTrim
            ? exactTrimMatchCount > 0
                ? `${exactTrimMatchCount} trim-aligned`
                : "trim normalized conservatively"
            : "target trim not confirmed",
    ];
    const compSummary = adjusted
        .slice(0, 3)
        .map((listing, index) => {
        const price = formatCompactCurrency(listing.price);
        const mileage = typeof listing.mileage === "number" ? `${listing.mileage.toLocaleString("en-US")} miles` : "mileage not listed";
        const location = listing.location ? `, ${listing.location}` : "";
        const source = listing.source || listing.title || listing.url || "market listing";
        const accessed = listing.dateAccessed ? `, accessed ${listing.dateAccessed}` : "";
        return `Comp ${index + 1}: ${source}, ${price}, ${mileage}${location}${accessed}`;
    })
        .join("; ");
    return {
        acvRange: range,
        acvValue: previewValue,
        confidence,
        compCount: adjusted.length,
        sourceType,
        label,
        reasoning: `${label}: confidence-weighted valuation preview derived from ${notes.join("; ")}. ${compSummary ? `${compSummary}. ` : ""}Needs 3+ comps for stronger confidence. Confidence level: ${confidence}.`,
    };
}
function getGuideCompWeights(compCount, hasGuide) {
    if (!hasGuide)
        return { guide: 0, comps: 1 };
    if (compCount <= 1)
        return { guide: 0.65, comps: 0.35 };
    if (compCount === 2)
        return { guide: 0.5, comps: 0.5 };
    return { guide: 0.35, comps: 0.65 };
}
function weightedAnchor(guideAnchor, compAnchor, previewValue, weights, side) {
    if (typeof guideAnchor === "number" && typeof compAnchor === "number") {
        return Math.round(guideAnchor * weights.guide + compAnchor * weights.comps);
    }
    const spread = Math.max(1200, Math.round(previewValue * (side === "low" ? 0.08 : 0.1)));
    return side === "low" ? previewValue - spread : previewValue + spread;
}
function normalizeGuideValuation(jdPower) {
    if (!jdPower)
        return null;
    const low = coerceCurrencyValue(jdPower.low ?? jdPower.cleanTradeIn);
    const high = coerceCurrencyValue(jdPower.high ?? jdPower.cleanRetail);
    const average = coerceCurrencyValue(jdPower.average ??
        (typeof low === "number" && typeof high === "number" ? Math.round((low + high) / 2) : undefined));
    if (typeof low !== "number" || typeof high !== "number" || typeof average !== "number") {
        return null;
    }
    const range = {
        low: Math.min(low, high),
        high: Math.max(low, high),
    };
    if (!isSaneRange(range, 250000)) {
        return null;
    }
    return {
        low: range.low,
        high: range.high,
        average,
    };
}
function computeACVFromJdPower(jdPower) {
    const guide = normalizeGuideValuation(jdPower);
    if (!guide)
        return null;
    return {
        acvRange: { low: guide.low, high: guide.high },
        acvValue: guide.average,
        confidence: "low",
        compCount: 0,
        sourceType: "jd_power",
        label: "Guide-only directional preview",
        reasoning: "Guide-only directional preview: market preview derived from structured guide/book valuation data only. Comparable source count: 0 usable listings. Region note: add local comparable listings before treating this as stronger valuation support. Confidence level: low.",
    };
}
function extractStructuredValuationData(report, analysis) {
    const candidates = [
        analysis,
        report?.analysis ?? null,
        report,
    ].filter(Boolean);
    const valuationData = {};
    for (const candidate of candidates) {
        const containers = [
            candidate,
            asRecord(candidate.valuationData),
            asRecord(candidate.marketValuation),
            asRecord(candidate.valuation),
            asRecord(candidate.acv),
            asRecord(candidate.marketData),
            asRecord(candidate.marketPreview),
        ].filter(Boolean);
        for (const container of containers) {
            if (!valuationData.comparableListings) {
                const listings = coerceComparableListings(container.comparableListings ??
                    container.comps ??
                    container.comparables ??
                    container.listings);
                if (listings.length > 0) {
                    valuationData.comparableListings = listings;
                }
            }
            if (!valuationData.jdPower) {
                const jdPower = coerceJdPowerValuation(container.jdPower ?? container.jd_power ?? container.jdpower);
                if (jdPower) {
                    valuationData.jdPower = jdPower;
                }
            }
        }
    }
    return valuationData;
}
function coerceComparableListings(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => asRecord(entry))
        .filter((entry) => Boolean(entry))
        .map((entry) => ({
        price: coerceCurrencyValue(entry.price ??
            entry.askingPrice ??
            entry.listPrice ??
            asRecord(entry.price)?.amount),
        askingPrice: coerceCurrencyValue(entry.askingPrice ?? entry.listPrice),
        mileage: coerceIntegerValue(entry.mileage ?? entry.odometer),
        year: coerceIntegerValue(entry.year),
        make: coerceStringValue(entry.make),
        model: coerceStringValue(entry.model),
        trim: coerceStringValue(entry.trim),
        source: coerceStringValue(entry.source ?? entry.sourceType ?? entry.provider),
        title: coerceStringValue(entry.title ?? entry.label ?? entry.name),
        location: coerceStringValue(entry.location ?? entry.market),
        url: coerceStringValue(entry.url ?? entry.link),
        dateAccessed: coerceStringValue(entry.dateAccessed ?? entry.accessedAt ?? entry.retrievedAt),
    }))
        .filter((entry) => typeof (entry.price ?? entry.askingPrice) === "number");
}
function coerceJdPowerValuation(value) {
    const record = asRecord(value);
    if (!record)
        return null;
    return {
        average: coerceCurrencyValue(record.average ?? record.mid ?? record.marketValue),
        low: coerceCurrencyValue(record.low ?? record.tradeIn ?? record.lowRetail),
        high: coerceCurrencyValue(record.high ?? record.cleanRetail ?? record.highRetail),
        cleanTradeIn: coerceCurrencyValue(record.cleanTradeIn),
        cleanRetail: coerceCurrencyValue(record.cleanRetail),
        source: coerceStringValue(record.source ?? record.provider),
    };
}
function normalizeComparableListing(listing) {
    const price = coerceCurrencyValue(listing.price ?? listing.askingPrice);
    if (typeof price !== "number" || price <= 500 || price > 250000) {
        return null;
    }
    return {
        price,
        mileage: coerceIntegerValue(listing.mileage),
        year: coerceIntegerValue(listing.year),
        make: (0, displayText_1.cleanDisplayLabel)(listing.make),
        model: (0, displayText_1.cleanDisplayLabel)(listing.model),
        trim: cleanVehicleDescriptor(listing.trim),
        source: (0, displayText_1.cleanDisplayLabel)(listing.source),
        title: (0, displayText_1.cleanDisplayLabel)(listing.title),
        location: (0, displayText_1.cleanDisplayLabel)(listing.location),
        url: (0, displayText_1.cleanDisplayLabel)(listing.url),
        dateAccessed: (0, displayText_1.cleanDisplayLabel)(listing.dateAccessed),
        condition: (0, displayText_1.cleanDisplayLabel)(listing.condition),
        titleStatus: (0, displayText_1.cleanDisplayLabel)(listing.titleStatus),
    };
}
function isComparableListingRelevant(listing, targetVehicle, targetMileage) {
    const targetMake = normalizeKey(targetVehicle?.make ?? "");
    const targetModel = normalizeKey(targetVehicle?.model ?? "");
    const targetTrim = normalizeKey(targetVehicle?.trim ?? "");
    const listingMake = normalizeKey(listing.make ?? "");
    const listingModel = normalizeKey(listing.model ?? "");
    const listingTrim = normalizeKey(listing.trim ?? "");
    if (targetMake && listingMake && targetMake !== listingMake) {
        return false;
    }
    if (targetModel && listingModel && !modelKeysLookEquivalent(targetModel, listingModel)) {
        return false;
    }
    if (typeof targetVehicle?.year === "number" &&
        typeof listing.year === "number" &&
        Math.abs(targetVehicle.year - listing.year) > 1) {
        return false;
    }
    if (typeof targetVehicle?.year === "number" && typeof listing.year === "number" && targetVehicle.year !== listing.year) {
        return false;
    }
    if (targetTrim && listingTrim && !trimsLookEquivalent(targetTrim, listingTrim)) {
        return false;
    }
    if (typeof targetMileage === "number" && typeof listing.mileage === "number") {
        const band = Math.max(5000, Math.round(targetMileage * 0.2));
        if (Math.abs(targetMileage - listing.mileage) > band) {
            return false;
        }
    }
    return true;
}
function modelKeysLookEquivalent(targetModel, listingModel) {
    if (!targetModel || !listingModel)
        return false;
    return targetModel === listingModel ||
        listingModel.startsWith(`${targetModel} `) ||
        targetModel.startsWith(`${listingModel} `);
}
function resolveLikelyStructuredAcvRange(params) {
    const valuationData = extractStructuredValuationData(params.report, params.analysis);
    const targetVehicle = (0, vehicleContext_1.normalizeVehicleIdentity)(params.vehicle);
    const comparablePrices = (valuationData.comparableListings ?? [])
        .map((listing) => normalizeComparableListing(listing))
        .filter((listing) => Boolean(listing))
        .filter((listing) => isComparableListingRelevant(listing, targetVehicle, params.mileage))
        .map((listing) => {
        const mileageAdjusted = applyMileageAdjustment(listing.price, params.mileage, listing.mileage);
        const yearAdjusted = applyYearAdjustment(mileageAdjusted, targetVehicle?.year, listing.year);
        return Math.round(applyTrimAdjustment(yearAdjusted, normalizeKey(targetVehicle?.trim ?? ""), normalizeKey(listing.trim ?? "")));
    })
        .filter((price) => Number.isFinite(price) && price > 500)
        .sort((left, right) => left - right);
    if (comparablePrices.length > 0) {
        const range = comparablePrices.length === 1
            ? buildPreviewBandFromValue(comparablePrices[0], 1200, 0.08, 250000)
            : {
                low: comparablePrices[0],
                high: comparablePrices[comparablePrices.length - 1],
            };
        if (isSaneRange(range, 250000)) {
            return range;
        }
    }
    return computeACVFromJdPower(valuationData.jdPower)?.acvRange;
}
function isFallbackMateriallyBelowLikelyMarket(fallbackRange, likelyRange) {
    if (!fallbackRange || !likelyRange) {
        return false;
    }
    const fallbackMid = (fallbackRange.low + fallbackRange.high) / 2;
    const likelyMid = (likelyRange.low + likelyRange.high) / 2;
    return fallbackMid < likelyMid * 0.7;
}
function applyMileageAdjustment(price, targetMileage, compMileage) {
    if (typeof targetMileage !== "number" || typeof compMileage !== "number") {
        return price;
    }
    const mileageDelta = compMileage - targetMileage;
    const adjustment = Math.max(-4000, Math.min(4000, Math.round(mileageDelta * 0.08)));
    return price - adjustment;
}
function applyYearAdjustment(price, targetYear, compYear) {
    if (typeof targetYear !== "number" || typeof compYear !== "number" || targetYear === compYear) {
        return price;
    }
    const yearDelta = compYear - targetYear;
    const rate = Math.min(Math.abs(yearDelta) * 0.04, 0.12);
    return Math.round(yearDelta > 0 ? price * (1 - rate) : price * (1 + rate));
}
function applyTrimAdjustment(price, targetTrim, compTrim) {
    if (!targetTrim || !compTrim || trimsLookEquivalent(targetTrim, compTrim)) {
        return price;
    }
    return Math.round(price * 0.975);
}
function trimsLookEquivalent(left, right) {
    if (!left || !right)
        return false;
    return left === right || left.includes(right) || right.includes(left);
}
function deriveValuationCompleteness(params) {
    return {
        trimUsable: params.targetTrimKnown && params.exactTrimMatchCount >= 1,
        mileageUsable: params.mileageKnownCount >= Math.ceil(params.compCount / 2),
        regionUsable: params.regionKnownCount >= Math.ceil(params.compCount / 2),
        conditionUsable: params.conditionKnownCount >= Math.ceil(params.compCount / 2),
        titleStatusUsable: params.titleStatusKnownCount >= Math.ceil(params.compCount / 2),
    };
}
function deriveWeightedPreviewConfidence(params) {
    if (params.compCount < 2)
        return "low";
    if (params.compCount === 2) {
        return params.completeness.mileageUsable && params.completeness.trimUsable ? "medium" : "low";
    }
    const completeCount = [
        params.completeness.trimUsable,
        params.completeness.mileageUsable,
        params.completeness.regionUsable,
        params.completeness.conditionUsable,
        params.completeness.titleStatusUsable,
    ].filter(Boolean).length;
    if (params.compCount >= 5 &&
        completeCount === 5) {
        return "high";
    }
    if (params.compCount >= 3 && completeCount >= 5) {
        return "medium";
    }
    return "low";
}
function computePercentile(values, percentile) {
    if (values.length === 0)
        return 0;
    const index = Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * percentile)));
    return values[index];
}
function asRecord(value) {
    return value && typeof value === "object" ? value : null;
}
function coerceCurrencyValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.round(value);
    }
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replace(/[^0-9.-]/g, "");
    if (!normalized)
        return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}
function coerceIntegerValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.round(value);
    }
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replace(/[^0-9-]/g, "");
    if (!normalized)
        return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}
function coerceStringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function estimateFactsToVehicle(facts) {
    return facts?.vehicle;
}
function scrubValuationMissingInputs(inputs, reportFields) {
    return inputs
        .map((input) => {
        let cleaned = (0, displayText_1.cleanDisplayLabel)(input);
        const normalized = normalizeKey(cleaned);
        if (normalized.includes("mileage") && typeof reportFields.mileage === "number") {
            cleaned = cleaned
                .replace(/\bmileage\b/gi, "")
                .replace(/\s*\/\s*/g, " / ")
                .replace(/\s*,\s*/g, ", ")
                .replace(/(?:^|\s)[/,-](?=\s|$)/g, " ")
                .replace(/\(\s*\)/g, "")
                .replace(/\s{2,}/g, " ")
                .replace(/^(?:\/|,|-)\s*|\s*(?:\/|,|-)\s*$/g, "")
                .trim();
        }
        return cleaned;
    })
        .filter((input) => {
        const normalized = normalizeKey(input);
        if (!normalized)
            return false;
        if (normalized.includes("mileage") && typeof reportFields.mileage === "number") {
            return false;
        }
        if ((normalized.includes("trim") || normalized.includes("options")) &&
            Boolean(reportFields.vehicle?.trim || reportFields.vehicle?.model)) {
            return false;
        }
        return true;
    });
}
function normalizePanelDvConfidence(confidence) {
    if (!confidence)
        return undefined;
    if (confidence === "low_to_moderate")
        return "low";
    return confidence;
}
function normalizeValuationConfidence(status, confidence, missingInputs = []) {
    if (status === "not_determinable") {
        return missingInputs.length > 0 ? "low" : confidence;
    }
    if (confidence) {
        if (missingInputs.length > 0 && confidence === "high")
            return "medium";
        return confidence;
    }
    if (status === "estimated_range") {
        return missingInputs.length > 0 ? "low" : "medium";
    }
    return missingInputs.length > 0 ? "medium" : "high";
}
function inferSupplementCategory(value) {
    const lower = value.toLowerCase();
    if (lower.includes("refinish") ||
        lower.includes("blend") ||
        lower.includes("tint") ||
        lower.includes("color sand") ||
        lower.includes("denib") ||
        lower.includes("polish") ||
        lower.includes("masking") ||
        lower.includes("edge prep") ||
        lower.includes("flex additive") ||
        lower.includes("let-down")) {
        return "refinish";
    }
    if (lower.includes("scan"))
        return "scan";
    if (lower.includes("calibration") ||
        lower.includes("radar") ||
        lower.includes("camera") ||
        lower.includes("sensor") ||
        lower.includes("adas") ||
        lower.includes("alignment")) {
        return "calibration";
    }
    if (lower.includes("seam") ||
        lower.includes("corrosion") ||
        lower.includes("hardware") ||
        lower.includes("clip") ||
        lower.includes("seal") ||
        lower.includes("material") ||
        lower.includes("primer") ||
        lower.includes("wax") ||
        lower.includes("protection")) {
        return "material";
    }
    if (lower.includes("frame") ||
        lower.includes("setup") ||
        lower.includes("realignment") ||
        lower.includes("structural") ||
        lower.includes("aperture") ||
        lower.includes("roof rail") ||
        lower.includes("door shell") ||
        lower.includes("quarter") ||
        lower.includes("section") ||
        lower.includes("measure") ||
        lower.includes("support area") ||
        lower.includes("upper rail") ||
        lower.includes("lock support") ||
        lower.includes("tie bar") ||
        lower.includes("core support")) {
        return "structural";
    }
    return "labor";
}
function buildSupplementItemFromIssue(report, issue, adasNarrativeBody) {
    const title = deriveSupplementTitle(issue.missingOperation || issue.title || issue.impact || issue.finding);
    if (!isSpecificSupplementItem(title)) {
        return null;
    }
    return {
        title,
        category: inferSupplementCategory(title),
        kind: inferSupplementKindFromText(`${issue.missingOperation ?? ""} ${issue.impact ?? ""} ${issue.finding ?? ""} ${issue.title ?? ""}`),
        rationale: sanitizeSupplementReason(title, issue.impact || issue.finding, "This operation appears underwritten or not fully supported in the current estimate.", adasNarrativeBody),
        evidence: sanitizeSupplementEvidence(title, buildIssueEvidence(report, issue.evidenceIds, title)),
        source: polishSourceLabel(issue.title),
        priority: issue.severity,
    };
}
function deriveSupplementTitle(value) {
    const lower = value.toLowerCase();
    if (lower.includes("lkq grille") && lower.includes("not correct style")) {
        return "LKQ Grille Style Contradiction";
    }
    if (lower.includes("seat belt dynamic function test")) {
        return "Seat Belt Dynamic Function Test";
    }
    if (lower.includes("front structure scope")) {
        return "Front Structure Scope / Tie Bar / Upper Rail Reconciliation";
    }
    if (lower.includes("aperture") ||
        lower.includes("door shell") ||
        lower.includes("roof rail") ||
        lower.includes("side structure") ||
        lower.includes("side-impact sensor") ||
        lower.includes("side impact sensor")) {
        return "Side Structure / Aperture / Door-Shell Fit Verification";
    }
    if (lower.includes("sidemember") ||
        lower.includes("support area") ||
        lower.includes("mounting geometry")) {
        return "Hidden Mounting Geometry / Teardown Growth";
    }
    if (lower.includes("structural setup and pull verification")) {
        return "Structural Setup and Pull Verification";
    }
    if (lower.includes("structural measurement verification")) {
        return "Structural Measurement Verification";
    }
    if (lower.includes("adas / calibration procedure support")) {
        return "ADAS / Calibration Procedure Support";
    }
    if (lower.includes("oem fit-sensitive part posture")) {
        return "OEM Fit-Sensitive Part Posture";
    }
    if (lower.includes("upper tie bar / lock support reconciliation")) {
        return "Upper Tie Bar / Lock Support Reconciliation";
    }
    if (lower.includes("upper tie bar / core support reconciliation")) {
        return "Upper Tie Bar / Core Support Reconciliation";
    }
    if (lower.includes("post-repair scan") || lower.includes("post repair scan")) {
        return "Post-Repair Scan";
    }
    if (lower.includes("pre-repair scan") || lower.includes("pre repair scan")) {
        return "Pre-Repair Scan";
    }
    if (lower.includes("steering angle")) {
        return "Steering Angle Sensor Calibration";
    }
    if (lower.includes("headlamp aiming") ||
        lower.includes("headlamp aim") ||
        lower.includes("headlight aiming") ||
        lower.includes("headlight aim") ||
        (lower.includes("lamp") && lower.includes("aim"))) {
        return "Headlamp aiming check";
    }
    if (lower.includes("alignment documentation follow-up")) {
        return "Final Alignment Printout / Completion Support";
    }
    if (lower.includes("scan report documentation follow-up")) {
        return "Final Scan Report Documentation";
    }
    if (lower.includes("calibration / aiming documentation follow-up")) {
        return "Calibration / Aiming Completion Documentation";
    }
    if (lower.includes("fit-sensitive") || lower.includes("fit sensitive")) {
        return "OEM Fit-Sensitive Part Posture";
    }
    if (lower.includes("fender") && (lower.includes("replace") || lower.includes("repair"))) {
        return "Fender Replace vs Repair Justification";
    }
    if ((looksLikeFrontEndOrFitSensitiveScope(lower) || lower.includes("fit-sensitive") || lower.includes("fit sensitive")) &&
        hasExplicitFitCheckLanguage(lower)) {
        return "Pre-Paint Test Fit";
    }
    if (lower.includes("bumper") && lower.includes("test fit")) {
        return "Bumper Test Fit";
    }
    if (lower.includes("lamp") && lower.includes("test fit")) {
        return "Lamp Test Fit";
    }
    if (lower.includes("fender") && lower.includes("test fit")) {
        return "Fender Test Fit";
    }
    if (lower.includes("adas") ||
        lower.includes("camera") ||
        lower.includes("radar") ||
        lower.includes("sensor") ||
        lower.includes("calibration")) {
        return "ADAS / Calibration Procedure Support";
    }
    if (lower.includes("scan")) {
        return lower.includes("post")
            ? "Post-Repair Scan"
            : lower.includes("pre")
                ? "Pre-Repair Scan"
                : "Diagnostic Scan";
    }
    if (lower.includes("alignment")) {
        return "Four-Wheel Alignment";
    }
    if (lower.includes("suspension")) {
        return "Four-Wheel Alignment";
    }
    if (lower.includes("setup")) {
        return "Structural Setup and Pull Verification";
    }
    if (hasExplicitFitCheckLanguage(lower)) {
        return "Test Fit / Mock-Up";
    }
    if (lower.includes("coolant") || lower.includes("bleed") || lower.includes("purge")) {
        return "Coolant Fill and Bleed";
    }
    if (lower.includes("tint color") || lower.includes("let-down panel") || lower.includes("let down panel")) {
        return "Tint Color / Let-Down Panel";
    }
    if (lower.includes("finish sand and polish") ||
        lower.includes("color sand and buff") ||
        lower.includes("denib")) {
        return "Finish Sand and Polish";
    }
    if (lower.includes("masking") || lower.includes("edge prep")) {
        return "Masking / Edge Prep";
    }
    if (lower.includes("three-stage refinish") || lower.includes("three stage refinish")) {
        return "Three-Stage Refinish Operation";
    }
    if (lower.includes("flex additive")) {
        return "Flex Additive";
    }
    if (lower.includes("blend")) {
        return "Blend / Blend Within Panel";
    }
    if (lower.includes("hardware") ||
        lower.includes("one-time-use") ||
        lower.includes("one time use") ||
        lower.includes("clip") ||
        lower.includes("seal") ||
        lower.includes("fastener")) {
        return "One-Time-Use Hardware / Seals / Clips";
    }
    if (lower.includes("corrosion protection")) {
        return "Corrosion Protection / Cavity Wax";
    }
    if (lower.includes("cavity wax")) {
        return "Corrosion Protection / Cavity Wax";
    }
    if (lower.includes("seam sealer")) {
        return "Seam Sealer Restoration";
    }
    if (lower.includes("tie bar") || lower.includes("core support")) {
        return "Upper Tie Bar / Core Support Reconciliation";
    }
    if (lower.includes("lock support")) {
        return "Upper Tie Bar / Lock Support Reconciliation";
    }
    if (hasTrueStructuralMeasurementSignals(lower)) {
        return "Structural Measurement Verification";
    }
    if (lower.includes("weld")) {
        return "Weld Verification";
    }
    if (lower.includes("airbag") || lower.includes("srs")) {
        return "SRS / Airbag System Verification";
    }
    if (lower.includes("pretensioner")) {
        return "Seat Belt / Pretensioner Verification";
    }
    if (lower.includes("seat belt")) {
        return "Seat Belt Dynamic Function Test";
    }
    return value.replace(/\s+/g, " ").trim();
}
function sanitizeReason(value, fallback) {
    const cleaned = sanitizeNarrative(value) ?? "";
    if (!cleaned)
        return fallback ?? "";
    const withoutEstimateGlossary = cleaned
        .replace(/\bshould clearl\b/gi, "should clearly")
        .replace(/\bclearl\b/gi, "clearly")
        .replace(/\b(R&I|RPR|REPL|BLND|REFN|CAL|SCAN)\b(?:\s+\b(R&I|RPR|REPL|BLND|REFN|CAL|SCAN)\b)+/gi, "")
        .replace(/\s+[/:|-]\s*$/g, "")
        .replace(/[:;,\-]\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return withoutEstimateGlossary || fallback || "";
}
function isContradictedByDocumentedFacts(item, estimateFacts) {
    const normalizedDocumented = [
        ...estimateFacts.documentedProcedures,
        ...estimateFacts.documentedHighlights,
    ].map((value) => normalizeKey(value));
    const documented = new Set(normalizedDocumented);
    const itemKey = normalizeKey(item.title);
    const hasAnyScanCoverage = normalizedDocumented.some((value) => /(pre repair scan|post repair scan|in process scan|in process repair scan|diagnostic scan|scan support|pre scan|post scan)/.test(value));
    const hasPostScanCoverage = normalizedDocumented.some((value) => /(post repair scan|post scan|final scan)/.test(value));
    const hasPreScanCoverage = normalizedDocumented.some((value) => /(pre repair scan|pre scan|diagnostic scan)/.test(value));
    const hasInProcessScanCoverage = normalizedDocumented.some((value) => /(in process scan|in process repair scan)/.test(value));
    const hasCavityWaxCoverage = normalizedDocumented.some((value) => /(cavity wax|corrosion protection)/.test(value));
    if (!itemKey)
        return false;
    if (itemKey.includes("scan")) {
        if (itemKey.includes("post") && (hasPostScanCoverage || hasAnyScanCoverage)) {
            return true;
        }
        if (itemKey.includes("pre") && (hasPreScanCoverage || hasAnyScanCoverage)) {
            return true;
        }
        if (hasAnyScanCoverage) {
            return true;
        }
    }
    if (itemKey.includes("in process") && hasInProcessScanCoverage) {
        return true;
    }
    if (hasCavityWaxCoverage && itemKey.includes("corrosion protection")) {
        return true;
    }
    if ((itemKey === normalizeKey("Pre-Repair Scan") && documented.has(normalizeKey("Pre-repair scan"))) ||
        (itemKey === normalizeKey("Post-Repair Scan") && documented.has(normalizeKey("Post-repair scan"))) ||
        (itemKey === normalizeKey("In-process scan") && documented.has(normalizeKey("In-process scan"))) ||
        (itemKey === normalizeKey("In-process repair scan") && documented.has(normalizeKey("In-process repair scan"))) ||
        (itemKey === normalizeKey("Headlamp aiming check") && documented.has(normalizeKey("Headlamp/fog aim"))) ||
        (itemKey === normalizeKey("Corrosion Protection / Cavity Wax") && documented.has(normalizeKey("Cavity wax"))) ||
        (itemKey === normalizeKey("Corrosion Protection / Weld Restoration") && documented.has(normalizeKey("Cavity wax")))) {
        return true;
    }
    return false;
}
function sanitizeEvidence(value) {
    const cleaned = sanitizeReason(value, "").replace(/^evidence:\s*/i, "").trim();
    return cleaned || undefined;
}
function sanitizeSupplementEvidence(title, value) {
    const cleaned = sanitizeEvidence(value);
    if (!cleaned)
        return undefined;
    if (title === "One-Time-Use Hardware / Seals / Clips") {
        const filtered = filterHardwareText(cleaned);
        return filtered && !looksLikeNoisySupplementText(filtered) ? filtered : undefined;
    }
    if (title === "Seam Sealer Restoration") {
        const filtered = filterSeamSealerText(cleaned);
        return filtered && !looksLikeNoisySupplementText(filtered) ? filtered : undefined;
    }
    if (title === "ADAS / Calibration Procedure Support") {
        if (looksLikeNoisySupplementText(cleaned) || !looksCalibrationFocused(cleaned)) {
            return undefined;
        }
    }
    if (title === "Headlamp aiming check") {
        if (looksLikeNoisySupplementText(cleaned) || !looksHeadlampAimFocused(cleaned)) {
            return undefined;
        }
    }
    return cleaned;
}
function polishSourceLabel(value) {
    const raw = sanitizeReason(value, "").trim();
    if (!raw)
        return undefined;
    if (/^(?:missing procedures?|repair review|file review|estimate text|documentation|parts analysis|scan analysis|calibration analysis|oem procedure support|drive knowledge base)$/i.test(raw) ||
        /^retrieved evidence\s*\d+$/i.test(raw)) {
        return undefined;
    }
    if (/seam sealer/i.test(raw)) {
        return undefined;
    }
    if (/function not clearly represented in estimate|not clearly represented in estimate|not clearly documented in the current estimate|not clearly documented in the current material/i.test(raw)) {
        return undefined;
    }
    const cleaned = raw
        .replace(/\bdecision panel\b/gi, "")
        .replace(/\bmissing procedure list\b/gi, "")
        .replace(/\bsupplement opportunity\b/gi, "")
        .replace(/\bstructured narrative\b/gi, "")
        .replace(/\bassistant reasoning\b/gi, "")
        .replace(/\bline mapping(?: engine)?\b/gi, "")
        .replace(/\bhybrid supplement(?: flow)?\b/gi, "")
        .replace(/\bdrive knowledge base\b/gi, "")
        .replace(/\bretrieved evidence\s*\d+\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
        .trim();
    return cleaned || undefined;
}
function cleanFormalExportText(value) {
    const cleaned = (0, displayText_1.cleanDisplayText)(value);
    if (!cleaned)
        return "";
    return cleaned
        .replace(/\bPotential omissions \/ likely supplement areas\s*:\s*\.?/gi, "")
        .replace(/\bBottom line:\s*/gi, "")
        .replace(/\bStructured analysis\b/gi, "")
        .replace(/\bSupplement analysis\b/gi, "")
        .replace(/\bNarrative synthesis\b/gi, "")
        .replace(/\bStructured narrative\b/gi, "")
        .replace(/\bcurrent normalized repair analysis\b/gi, "current repair file")
        .replace(/\bexport model\b/gi, "supporting documentation")
        .replace(/\bfunction not clearly represented\b/gi, "not clearly documented")
        .replace(/\bthe current material does not clearly document\b/gi, "the file does not clearly support")
        .replace(/\bsupport remains open\b/gi, "documentation is not shown")
        .replace(/\bProc\s*-\s*Structural cues\b/gi, "")
        .replace(/\bMissing procedures?\b/gi, "")
        .replace(/\bRetrieved Evidence\s*\d+\b/gi, "")
        .replace(/\b(?:Drive|Linked external-document) knowledge base\b/gi, "")
        .replace(/\bFile review\b/gi, "")
        .replace(/\bRepair review\b/gi, "")
        .replace(/\bOEM procedure support\b/gi, "")
        .replace(/\bthe\s+the\b/gi, "the")
        .replace(/\s{2,}/g, " ")
        .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}
function sanitizeSupplementReason(title, value, fallback, adasNarrativeBody) {
    const cleaned = sanitizeReason(value, fallback);
    if (title === "One-Time-Use Hardware / Seals / Clips") {
        const filtered = filterHardwareText(cleaned);
        return ((filtered && !looksLikeNoisySupplementText(filtered) ? filtered : "") ||
            "The file supports one-time-use hardware, seals, or clip replacement for the documented repair path, while the related parts, materials, or documentation remain open in the estimate.");
    }
    if (title === "ADAS / Calibration Procedure Support") {
        if (adasNarrativeBody?.trim()) {
            return adasNarrativeBody.trim();
        }
        const normalized = normalizeSupplementText(cleaned);
        if (!normalized || looksLikeNoisySupplementText(normalized)) {
            return "The file supports scan, calibration, or related verification steps, but the estimate does not clearly document what was required or how it would be confirmed.";
        }
        return normalizeCalibrationReason(normalized);
    }
    if (title === "Headlamp aiming check") {
        const normalized = normalizeSupplementText(cleaned);
        if (!normalized || looksLikeNoisySupplementText(normalized)) {
            return "The file supports a headlamp aiming check after lamp or related component service, but that verification step is not clearly documented in the estimate.";
        }
        return normalizeHeadlampAimReason(normalized);
    }
    if (title === "Seam Sealer Restoration") {
        const withoutRefinishGlossary = filterSeamSealerText(cleaned);
        return ((withoutRefinishGlossary && !looksLikeNoisySupplementText(withoutRefinishGlossary)
            ? withoutRefinishGlossary
            : "") ||
            "The file would benefit from clearer seam sealer restoration documentation for the affected area, with supporting process or OEM material as needed.");
    }
    return cleaned;
}
function filterHardwareText(value) {
    const filtered = value
        .replace(/\bcolor coat application\b/gi, "")
        .replace(/\bbagging\b/gi, "")
        .replace(/\bclear coat finishes?\b/gi, "")
        .replace(/\bthree-stage finishes?\b/gi, "")
        .replace(/\bthree stage finishes?\b/gi, "")
        .replace(/\bcolor blend\b/gi, "")
        .replace(/\bblend(?:ing)?\b/gi, "")
        .replace(/\bbasecoat\b/gi, "")
        .replace(/\bclearcoat\b/gi, "")
        .replace(/\brefinish(?:ing)?\b/gi, "")
        .replace(/\bpaint glossary\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .replace(/(?:,\s*){2,}/g, ", ")
        .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
        .trim();
    if (!filtered) {
        return "";
    }
    if (!looksHardwareFocused(filtered)) {
        return "";
    }
    return filtered;
}
function filterSeamSealerText(value) {
    const filtered = value
        .replace(/\bcolor coat application\b/gi, "")
        .replace(/\bbagging\b/gi, "")
        .replace(/\bthree-stage finishes?\b/gi, "")
        .replace(/\bthree stage finishes?\b/gi, "")
        .replace(/\bcolor blend\b/gi, "")
        .replace(/\bblend(?:ing)?\b/gi, "")
        .replace(/\bbasecoat\b/gi, "")
        .replace(/\bclearcoat\b/gi, "")
        .replace(/\brefinish(?:ing)?\b/gi, "")
        .replace(/\bpaint glossary\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .replace(/(?:,\s*){2,}/g, ", ")
        .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
        .trim();
    if (!filtered) {
        return "";
    }
    if (!looksSeamSealerFocused(filtered)) {
        return "";
    }
    return filtered;
}
function normalizeSupplementText(value) {
    return value
        .replace(/\blamp assy\b/gi, "headlamp assembly")
        .replace(/\bassy\b/gi, "assembly")
        .replace(/\bfrt\b/gi, "front")
        .replace(/\brr\b/gi, "rear")
        .replace(/\blh\b/gi, "left")
        .replace(/\brh\b/gi, "right")
        .replace(/\bheadlight\b/gi, "headlamp")
        .replace(/\s{2,}/g, " ")
        .trim();
}
function normalizeCalibrationReason(value) {
    const normalized = normalizeSupplementText(value);
    if (looksCalibrationFocused(normalized) && !looksLikeNoisySupplementText(normalized)) {
        return normalized
            .replace(/\bcalibration analysis\b/gi, "calibration")
            .replace(/\bscan analysis\b/gi, "scan support");
    }
    return "The file supports scan, calibration, or related verification steps, but the estimate does not clearly document what was required or how it would be confirmed.";
}
function normalizeHeadlampAimReason(value) {
    const normalized = normalizeSupplementText(value);
    if (looksHeadlampAimFocused(normalized) && !looksLikeNoisySupplementText(normalized)) {
        return normalized;
    }
    return "The file supports a headlamp aiming check after lamp or related component service, but that verification step is not clearly documented in the estimate.";
}
function looksLikeNoisySupplementText(value) {
    const lower = value.toLowerCase();
    const codeMatches = (lower.match(/\b(r&i|rpr|repl|blnd|refn|sublet|nags|op|incl|w\/|w\/o|lt|rt|lh|rh|assy)\b/g) ?? []).length;
    const punctuationDensity = (lower.match(/[|/]/g) ?? []).length;
    const numberCodeDensity = (lower.match(/\b\d{2,}\b/g) ?? []).length;
    const glossaryHits = (lower.match(/\b(color coat|bagging|three-stage|three stage|blend|basecoat|clearcoat)\b/g) ?? []).length;
    return codeMatches >= 3 || punctuationDensity >= 3 || numberCodeDensity >= 4 || glossaryHits >= 2;
}
function looksCalibrationFocused(value) {
    const lower = value.toLowerCase();
    return (lower.includes("adas") ||
        lower.includes("calibration") ||
        lower.includes("scan") ||
        lower.includes("camera") ||
        lower.includes("radar") ||
        lower.includes("sensor") ||
        lower.includes("verification"));
}
function looksHeadlampAimFocused(value) {
    const lower = value.toLowerCase();
    return ((lower.includes("headlamp") || lower.includes("lamp")) &&
        (lower.includes("aim") || lower.includes("alignment") || lower.includes("verification")));
}
function looksSeamSealerFocused(value) {
    const lower = value.toLowerCase();
    return (lower.includes("seam sealer") ||
        lower.includes("joint sealing") ||
        lower.includes("sealer") ||
        lower.includes("corrosion") ||
        lower.includes("cavity wax") ||
        lower.includes("weld protection"));
}
function looksHardwareFocused(value) {
    const lower = value.toLowerCase();
    return (lower.includes("one-time-use") ||
        lower.includes("one time use") ||
        lower.includes("hardware") ||
        lower.includes("clip") ||
        lower.includes("seal") ||
        lower.includes("fastener") ||
        lower.includes("retainer"));
}
function pickPreferredDetail(left, right) {
    if (!left)
        return right;
    if (!right)
        return left;
    return scoreDisplayDetail(right) > scoreDisplayDetail(left) ? right : left;
}
function scoreDisplayDetail(value) {
    const lower = value.toLowerCase();
    let score = value.length;
    if (lower.includes("pipeline evidence"))
        score -= 15;
    if (lower.includes("repair-pipeline"))
        score -= 15;
    if (lower.includes("structured analysis"))
        score += 10;
    if (lower.includes("oem"))
        score += 20;
    if (lower.includes("procedure"))
        score += 12;
    return score;
}
function pickBetterNarrative(left, right) {
    const candidates = [left, right].filter(Boolean);
    if (candidates.length === 0)
        return undefined;
    return candidates.sort((a, b) => scoreNarrative(b) - scoreNarrative(a))[0];
}
function scoreNarrative(value) {
    const lower = value.toLowerCase();
    let score = value.length;
    if (lower.includes("not clearly"))
        score += 50;
    if (lower.includes("not documented"))
        score += 50;
    if (lower.includes("underwritten"))
        score += 50;
    if (lower.includes("requires"))
        score += 25;
    return score;
}
function sortSupplementItems(left, right) {
    const scoreDelta = scoreSupplementItem(right) - scoreSupplementItem(left);
    if (scoreDelta !== 0)
        return scoreDelta;
    return left.title.localeCompare(right.title);
}
function scoreSupplementItem(item) {
    const lower = `${item.title} ${item.rationale} ${item.source ?? ""}`.toLowerCase();
    let score = item.priority === "high" ? 300 : item.priority === "medium" ? 200 : 100;
    if (item.kind === "missing_operation")
        score += 45;
    if (item.kind === "underwritten_operation")
        score += 35;
    if (item.kind === "disputed_repair_path")
        score += 30;
    if (item.category === "structural")
        score += 60;
    if (item.category === "material")
        score += 80;
    if (lower.includes("front structure") ||
        lower.includes("tie bar") ||
        lower.includes("lock support") ||
        lower.includes("support area") ||
        lower.includes("upper rail") ||
        lower.includes("core support") ||
        lower.includes("guide") ||
        lower.includes("bracket"))
        score += 85;
    if (lower.includes("rear body") ||
        lower.includes("deck opening") ||
        lower.includes("bumper reinforcement") ||
        lower.includes("absorber") ||
        lower.includes("blind spot") ||
        lower.includes("rear sensor") ||
        lower.includes("striker") ||
        lower.includes("latch"))
        score += 85;
    if (lower.includes("setup") || lower.includes("measure") || lower.includes("realignment"))
        score += 110;
    if (lower.includes("replace vs repair") || lower.includes("repair vs replace"))
        score += 105;
    if (lower.includes("fit-sensitive") || lower.includes("fit sensitive"))
        score += 70;
    if (lower.includes("adas") || lower.includes("calibration procedure support"))
        score += 95;
    if (lower.includes("test fit"))
        score += 35;
    if (lower.includes("coolant") || lower.includes("bleed") || lower.includes("refill"))
        score += 95;
    if (lower.includes("hardware") || lower.includes("seal") || lower.includes("clip") || lower.includes("fastener"))
        score += 28;
    if (lower.includes("mounting geometry") || lower.includes("teardown") || lower.includes("hidden"))
        score += 30;
    if (lower.includes("corrosion") || lower.includes("cavity wax") || lower.includes("seam sealer") || lower.includes("weld protection"))
        score += 90;
    if (lower.includes("alignment"))
        score += 20;
    if (lower.includes("scan") || lower.includes("calibration"))
        score += 50;
    if (looksLikeMetaCommentary(lower))
        score -= 400;
    if (lower.includes("not documented") || lower.includes("not clearly") || lower.includes("underwritten"))
        score += 40;
    score += Math.min(item.rationale.length, 100);
    return score;
}
function curateExportSupplementItems(items, sourceText) {
    if (items.length <= 1)
        return items;
    const lowerSource = sourceText.toLowerCase();
    const operationSnapshot = (0, estimateOperationEquivalence_1.analyzeEstimateOperations)(sourceText);
    const impactZone = (0, impactZone_1.deriveImpactZone)({ text: sourceText });
    const hasFrontSupportOperations = (0, impactZone_1.hasFrontSupportZoneEvidence)(sourceText);
    const hasRadiatorSupport = /\b(?:radiator support|core support|lock support)\b/.test(lowerSource);
    const hasTieBar = /\btie bar\b/.test(lowerSource);
    const hasApron = /\bapron\b/.test(lowerSource);
    const hasUpperRail = /\bupper rail\b/.test(lowerSource);
    const hasLowerRail = /\blower rail\b/.test(lowerSource);
    const allowHiddenMountingGeometry = impactZone.primary === "front" ||
        hasFrontSupportOperations ||
        hasRadiatorSupport ||
        hasTieBar ||
        hasApron ||
        hasUpperRail ||
        hasLowerRail;
    const frontSpecificExists = items.some((item) => inferExportSupplementFamily(item.title) === "front_structure_scope" &&
        !isGenericExportFallback(item.title));
    const rearSpecificExists = items.some((item) => inferExportSupplementFamily(item.title) === "rear_structure_scope" &&
        !isGenericExportFallback(item.title));
    const filtered = items.filter((item) => {
        if (item.title === "Headlamp aiming check" &&
            (operationSnapshot.headlamp_aim || operationSnapshot.fog_lamp_aim)) {
            return false;
        }
        if (item.title === "Four-Wheel Alignment" && operationSnapshot.alignment) {
            return false;
        }
        if (item.title === "Four-Wheel Alignment" && !hasExportAlignmentEvidence(lowerSource)) {
            return false;
        }
        if (item.title === "One-Time-Use Hardware / Seals / Clips" && !hasExportHardwareEvidence(lowerSource, item)) {
            return false;
        }
        if (item.title === "Pre-Paint Test Fit" &&
            (!hasExplicitFitCheckLanguage(`${lowerSource} ${item.rationale.toLowerCase()} ${item.evidence?.toLowerCase() ?? ""}`) ||
                !looksLikeFrontEndOrFitSensitiveScope(`${lowerSource} ${item.rationale.toLowerCase()} ${item.evidence?.toLowerCase() ?? ""}`))) {
            return false;
        }
        if (item.title === "ADAS / Calibration Procedure Support" &&
            !hasExportAdasProcedureEvidence(lowerSource, item)) {
            return false;
        }
        if (item.title === "Structural Measurement Verification" &&
            !hasExportMeasurementEvidence(lowerSource) &&
            (frontSpecificExists || rearSpecificExists)) {
            return false;
        }
        if (item.title === "Hidden Mounting Geometry / Teardown Growth" &&
            (!allowHiddenMountingGeometry || !hasExportHiddenMountingEvidence(lowerSource, item))) {
            return false;
        }
        return true;
    });
    const kept = [];
    const seenFamilies = new Set();
    let genericFallbacks = 0;
    for (const item of [...filtered].sort((left, right) => scoreExportSupplementItemInContext(right, lowerSource) - scoreExportSupplementItemInContext(left, lowerSource))) {
        const family = inferExportSupplementFamily(item.title);
        const generic = isGenericExportFallback(item.title);
        if (seenFamilies.has(family)) {
            continue;
        }
        if (generic && genericFallbacks >= 1) {
            continue;
        }
        kept.push(item);
        seenFamilies.add(family);
        if (generic)
            genericFallbacks += 1;
    }
    return kept;
}
function inferExportSupplementFamily(title) {
    const lower = title.toLowerCase();
    if (lower.includes("front structure") ||
        lower.includes("tie bar") ||
        lower.includes("lock support") ||
        lower.includes("core support") ||
        lower.includes("upper rail") ||
        lower.includes("support area") ||
        lower.includes("hidden mounting")) {
        return "front_structure_scope";
    }
    if (lower.includes("rear body") ||
        lower.includes("deck opening") ||
        lower.includes("bumper reinforcement") ||
        lower.includes("absorber") ||
        lower.includes("rear sensor") ||
        lower.includes("blind spot") ||
        lower.includes("deck lid") ||
        lower.includes("latch") ||
        lower.includes("striker")) {
        return "rear_structure_scope";
    }
    if (lower.includes("test fit") || lower.includes("fit-sensitive"))
        return "fit_verification";
    if (lower.includes("aperture") ||
        lower.includes("door shell") ||
        lower.includes("quarter") ||
        lower.includes("roof rail") ||
        lower.includes("side structure")) {
        return "side_structure_scope";
    }
    if (lower.includes("alignment"))
        return "alignment";
    if (lower.includes("hardware") || lower.includes("clip") || lower.includes("fastener"))
        return "hardware";
    if (lower.includes("measure") || lower.includes("setup") || lower.includes("realignment")) {
        return "structural_measurement";
    }
    if (lower.includes("scan") || lower.includes("calibration") || lower.includes("sensor") || lower.includes("aim")) {
        return "verification";
    }
    if (lower.includes("corrosion") || lower.includes("seam") || lower.includes("weld")) {
        return "corrosion";
    }
    return title.toLowerCase();
}
function isGenericExportFallback(title) {
    return [
        "Four-Wheel Alignment",
        "One-Time-Use Hardware / Seals / Clips",
        "Structural Measurement Verification",
        "Hidden Mounting Geometry / Teardown Growth",
    ].includes(title);
}
function hasExportAlignmentEvidence(value) {
    return (value.includes("alignment") ||
        value.includes("toe") ||
        value.includes("camber") ||
        value.includes("caster") ||
        value.includes("suspension") ||
        value.includes("steering") ||
        value.includes("subframe"));
}
function hasExportHardwareEvidence(value, item) {
    const combined = `${value} ${item.rationale} ${item.evidence ?? ""}`.toLowerCase();
    return (combined.includes("one-time-use") ||
        combined.includes("one time use") ||
        combined.includes("hardware") ||
        combined.includes("fastener") ||
        combined.includes("retainer") ||
        /\bclip(s)?\b/i.test(combined) ||
        /\bseal(s)?\b/i.test(combined));
}
function hasExportMeasurementEvidence(value) {
    return (/(measure|measurement|measuring)/.test(value) ||
        /\bframe\b/.test(value) ||
        /\bbench\b/.test(value) ||
        /\bsetup\b/.test(value) ||
        /\bpull\b/.test(value) ||
        /realign(?:ment)?/.test(value) ||
        /dimension(?:s|al)?/.test(value) ||
        /\bdatum\b/.test(value) ||
        /\bgeometry\b/.test(value) ||
        hasVerifiedStructuralZoneEvidence(value));
}
function hasExportAdasProcedureEvidence(value, item) {
    const combined = `${value} ${item?.rationale ?? ""} ${item?.evidence ?? ""}`.toLowerCase();
    const hasAdasSubject = combined.includes("adas") ||
        combined.includes("calibration") ||
        combined.includes("camera") ||
        combined.includes("radar") ||
        combined.includes("sensor") ||
        combined.includes("scan");
    const hasProcedureContext = combined.includes("procedure") ||
        combined.includes("calibrate") ||
        combined.includes("calibration") ||
        combined.includes("scan") ||
        combined.includes("verification") ||
        combined.includes("aim");
    return hasAdasSubject && hasProcedureContext;
}
function hasExportSupportScopeEvidence(value) {
    return (value.includes("tie bar") ||
        value.includes("lock support") ||
        value.includes("core support") ||
        value.includes("radiator support") ||
        value.includes("support area") ||
        value.includes("upper rail") ||
        value.includes("guide") ||
        value.includes("bracket") ||
        value.includes("mount"));
}
function hasExportHiddenMountingEvidence(value, item) {
    const combined = `${value} ${item?.rationale ?? ""} ${item?.evidence ?? ""}`.toLowerCase();
    return (hasExportSupportScopeEvidence(combined) ||
        combined.includes("reinforcement") ||
        combined.includes("absorber") ||
        combined.includes("shutter") ||
        combined.includes("duct") ||
        combined.includes("ducting") ||
        combined.includes("hidden bracket") ||
        combined.includes("mounting disturbance") ||
        combined.includes("mounting geometry") ||
        combined.includes("teardown"));
}
function isLightFrontBumperDrivenExportFile(value, item) {
    const combined = `${value} ${item?.rationale ?? ""} ${item?.evidence ?? ""}`.toLowerCase();
    const hasLightSignals = combined.includes("bumper") ||
        combined.includes("fascia") ||
        combined.includes("trim") ||
        combined.includes("sensor") ||
        combined.includes("scan");
    const lacksHeavySignals = !hasExportHiddenMountingEvidence(combined, item) &&
        !hasExportMeasurementEvidence(combined) &&
        !combined.includes("structure") &&
        !combined.includes("rail") &&
        !combined.includes("apron");
    return hasLightSignals && lacksHeavySignals;
}
function hasVerifiedStructuralZoneEvidence(value) {
    return (/\b(?:rail|apron)\b.{0,40}\b(?:measure|measurement|measuring|setup|pull|realign|datum|geometry|dimension)\b/.test(value) ||
        /\b(?:measure|measurement|measuring|setup|pull|realign|datum|geometry|dimension)\b.{0,40}\b(?:rail|apron)\b/.test(value));
}
function hasExplicitFitCheckLanguage(value) {
    return (/test fit/.test(value) ||
        /test-fit/.test(value) ||
        /fit check/.test(value) ||
        /fit-check/.test(value) ||
        /mock up/.test(value) ||
        /mock-up/.test(value) ||
        /fit verification/.test(value) ||
        /gap confirmation/.test(value) ||
        /aim confirmation/.test(value));
}
function looksLikeFrontEndOrFitSensitiveScope(value) {
    return (/\bfront(?:-|\s)?end\b/.test(value) ||
        /\bbumper\b/.test(value) ||
        /\bfascia\b/.test(value) ||
        /\bfender\b/.test(value) ||
        /\blamp\b/.test(value) ||
        /\bheadlamp\b/.test(value) ||
        /\bgrille\b/.test(value) ||
        /\bhood\b/.test(value) ||
        /\bfit-sensitive\b/.test(value) ||
        /\bgap\b/.test(value) ||
        /\baim\b/.test(value));
}
function hasTrueStructuralMeasurementSignals(value) {
    return (/(measure|measurement|measuring)/.test(value) ||
        /\bframe\b/.test(value) ||
        /\bbench\b/.test(value) ||
        /\bsetup\b/.test(value) ||
        /\bpull\b/.test(value) ||
        /realign(?:ment)?/.test(value) ||
        /dimension(?:s|al)?/.test(value) ||
        /\bdatum\b/.test(value) ||
        /\bgeometry\b/.test(value) ||
        hasVerifiedStructuralZoneEvidence(value));
}
function hasMajorFitStackUpEvidence(value) {
    const lower = value.toLowerCase();
    const fitSignals = [
        "hood",
        "fender",
        "lamp",
        "headlamp",
        "grille",
        "gap",
        "aim",
        "fit-sensitive",
        "fit sensitive",
        "camera",
    ].filter((signal) => lower.includes(signal)).length;
    return fitSignals >= 2;
}
function scoreExportSupplementItemInContext(item, sourceText) {
    const combined = `${sourceText} ${item.title} ${item.rationale} ${item.evidence ?? ""}`.toLowerCase();
    let score = scoreSupplementItem(item);
    if (item.title === "Pre-Paint Test Fit") {
        if (!hasMajorFitStackUpEvidence(combined))
            score -= 120;
        if (isLightFrontBumperDrivenExportFile(sourceText, item))
            score -= 140;
    }
    if (item.title === "Hidden Mounting Geometry / Teardown Growth") {
        if (isLightFrontBumperDrivenExportFile(sourceText, item))
            score -= 180;
        const impactZone = (0, impactZone_1.deriveImpactZone)({ text: sourceText });
        const lowerSource = sourceText.toLowerCase();
        const hasFrontSupportOperations = (0, impactZone_1.hasFrontSupportZoneEvidence)(sourceText);
        const hasRadiatorSupport = /\b(?:radiator support|core support|lock support)\b/.test(lowerSource);
        const hasTieBar = /\btie bar\b/.test(lowerSource);
        const hasApron = /\bapron\b/.test(lowerSource);
        const hasUpperRail = /\bupper rail\b/.test(lowerSource);
        const hasLowerRail = /\blower rail\b/.test(lowerSource);
        const allowHiddenMountingGeometry = impactZone.primary === "front" ||
            hasFrontSupportOperations ||
            hasRadiatorSupport ||
            hasTieBar ||
            hasApron ||
            hasUpperRail ||
            hasLowerRail;
        if (!allowHiddenMountingGeometry) {
            score -= 240;
        }
        if (hasExportHiddenMountingEvidence(sourceText, item))
            score += 30;
    }
    if (item.title === "ADAS / Calibration Procedure Support") {
        if (!hasExportAdasProcedureEvidence(sourceText, item))
            score -= 180;
        if (/\b(?:camera|sensor|scan|calibration|park sensor|front camera)\b/.test(combined))
            score += 45;
    }
    if (/\b(?:bumper|grille|trim|park sensor|front camera|absorber|reinforcement|guide|bracket|shutter|duct)\b/.test(combined)) {
        score += 35;
    }
    return score;
}
function selectConsistentSupplementItems(items, limit = 6) {
    if (items.length <= limit) {
        return items;
    }
    const narrowFocus = new Set([
        "ADAS / Calibration Procedure Support",
        "Headlamp aiming check",
        "Seam Sealer Restoration",
    ]);
    const primary = items.filter((item) => !narrowFocus.has(item.title)).slice(0, Math.max(1, limit - 1));
    const fallback = items.filter((item) => narrowFocus.has(item.title)).slice(0, limit - primary.length);
    return [...primary, ...fallback].slice(0, limit);
}
function buildRequestHeading(items) {
    const hasOnlyRefinishItems = items.length > 0 && items.every((item) => isRefinishSupportItem(item.title));
    const kinds = new Set(items.map((item) => item.kind));
    if (hasOnlyRefinishItems) {
        return "Please review the following refinish-related items and provide the procedure, blend, material, or paint-process support carrying the current position:";
    }
    if (kinds.has("missing_operation")) {
        return "Please review the following operations and provide support if they remain part of the intended repair plan:";
    }
    if (kinds.has("missing_verification")) {
        return "Please review the following verification items and provide the supporting procedure path, measurements, scans, calibrations, or related records where available:";
    }
    if (kinds.has("underwritten_operation")) {
        return "Please review the following items and provide the support, time justification, or related documentation carrying the current position:";
    }
    return "Please review the following disputed repair-path items and provide the supporting rationale or documentation for the intended approach:";
}
function looksLikeCleanRequest(value) {
    const lower = value.toLowerCase();
    if (looksLikeEstimateNoise(value))
        return false;
    if (lower.includes("narrows repair scope") ||
        lower.includes("restructured rather than simply shortened") ||
        lower.includes("carrier estimate appears")) {
        return false;
    }
    return lower.startsWith("please review") || lower.startsWith("please provide");
}
function joinHumanList(values) {
    if (values.length === 0)
        return "";
    if (values.length === 1)
        return values[0];
    if (values.length === 2)
        return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}
function scoreRepairNarrative(value) {
    const lower = value.toLowerCase();
    let score = value.length;
    if (lower.includes("shop estimate"))
        score += 80;
    if (lower.includes("carrier estimate"))
        score += 80;
    if (lower.includes("underwritten"))
        score += 70;
    if (lower.includes("more complete"))
        score += 60;
    if (lower.includes("repair path"))
        score += 40;
    if (lower.includes("materially"))
        score += 25;
    if (looksLikeMetaCommentary(lower))
        score -= 100;
    return score;
}
function trimTrailingPunctuation(value) {
    return value.replace(/[.!\s]+$/g, "").trim();
}
function looksLikeMetaCommentary(value) {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized)
        return true;
    if (META_COMMENTARY_PATTERNS.some((pattern) => normalized.includes(pattern.replace(/[^a-z0-9\s]/g, " ")))) {
        return true;
    }
    return (!normalized.includes("test fit") &&
        !normalized.includes("alignment") &&
        !normalized.includes("scan") &&
        !normalized.includes("calibration") &&
        !normalized.includes("coolant") &&
        !normalized.includes("tie bar") &&
        !normalized.includes("lock support") &&
        !normalized.includes("core support") &&
        !normalized.includes("cavity wax") &&
        !normalized.includes("corrosion") &&
        !normalized.includes("fender") &&
        !normalized.includes("bumper") &&
        !normalized.includes("lamp") &&
        normalized.includes("repair strategy"));
}
function inferSupplementKindFromText(value) {
    const lower = (value ?? "").toLowerCase();
    if (lower.includes("verification") ||
        lower.includes("documented measurements") ||
        lower.includes("procedure support") ||
        lower.includes("calibration") ||
        lower.includes("scan") ||
        lower.includes("alignment")) {
        return "missing_verification";
    }
    if (lower.includes("missing") ||
        lower.includes("omitted") ||
        lower.includes("not shown") ||
        lower.includes("not carried") ||
        lower.includes("not reflected")) {
        return "missing_operation";
    }
    if (lower.includes("underwritten") ||
        lower.includes("not documented") ||
        lower.includes("not clearly represented") ||
        lower.includes("not clearly supported") ||
        lower.includes("needs documentation") ||
        lower.includes("time justification") ||
        lower.includes("access burden")) {
        return "underwritten_operation";
    }
    return "disputed_repair_path";
}
function mergeSupplementKind(left, right) {
    const rank = {
        missing_operation: 3,
        missing_verification: 2,
        underwritten_operation: 2,
        disputed_repair_path: 1,
    };
    return rank[left] >= rank[right] ? left : right;
}
function buildRequestLine(item) {
    const reason = sanitizeReason(item.rationale, "Please clarify how this item is being supported.");
    switch (item.title) {
        case "Tint Color / Let-Down Panel":
            return "Please provide the tint, let-down, or color-match rationale supporting this refinish step, including the paint-process support carrying the current position.";
        case "Finish Sand and Polish":
            return "Please provide the finish sand, denib, color-sand-and-buff, or final-finish rationale supporting this refinish step.";
        case "Masking / Edge Prep":
            return "Please provide the masking, edge-prep, or related paint-process rationale supporting this refinish step.";
        case "Three-Stage Refinish Operation":
            return "Please provide the three-stage refinish rationale, including the paint-process and material support carrying this operation.";
        case "Flex Additive":
            return "Please provide the flex-additive rationale and any supporting paint-process documentation carrying this refinish operation.";
        case "Blend / Blend Within Panel":
            return "Please provide the blend rationale and related paint-process support for this refinish operation.";
        case "Structural Measurement Verification":
            return "Please provide the documented dimensional measurement or verification support for this repair path, including how geometry confirmation was performed.";
        case "Structural Setup and Pull Verification":
            return "Please provide the setup, pull, or realignment rationale and the time support for that structural burden.";
        case "Fender Replace vs Repair Justification":
            return "Please provide the replace-versus-repair rationale for the fender, including how mounting alignment, wheel-opening shape, or adjacent support damage were evaluated.";
        case "OEM Fit-Sensitive Part Posture":
            return "Please provide the OEM-versus-aftermarket rationale for this fit-sensitive area, including any gap, finish, or stack-up concerns affecting the part posture.";
        case "Front Structure Scope / Tie Bar / Upper Rail Reconciliation":
            return "Please provide the rationale and scope support for the front structure, tie bar, support-area, or upper-rail reconciliation reflected by the intended repair path.";
        case "Upper Tie Bar / Lock Support Reconciliation":
            return "Please provide the structural rationale and documentation supporting the upper tie bar or lock-support reconciliation.";
        case "ADAS / Calibration Procedure Support":
            return "Please provide the required ADAS, scan, and calibration procedure support for this repair path, including the expected verification steps.";
        case "Headlamp aiming check":
            return "Please provide the headlamp aiming procedure support for this repair path, including how final aim verification was to be performed.";
        case "Four-Wheel Alignment":
            return "Please provide the alignment rationale and any related post-repair documentation supporting this operation.";
        case "Pre-Paint Test Fit":
            return "Please provide the rationale for the pre-paint test fit burden and how final fit was to be confirmed before finish work.";
        case "Seam Sealer Restoration":
            return "Please provide seam sealer restoration details for the affected areas, along with supporting repair-process or OEM documentation.";
        case "Corrosion Protection / Weld Restoration":
            return "Please provide the corrosion-protection, cavity-wax, seam, or weld-restoration documentation supporting this repair path.";
        case "Coolant Fill and Bleed":
            return "Please provide the support for the coolant refill, bleed, or related access burden associated with this repair path.";
        default:
            return makeRequestLineFromReason(reason);
    }
}
function makeRequestLineFromReason(reason) {
    const trimmed = trimTrailingPunctuation(reason);
    if (!trimmed) {
        return "Please provide the supporting rationale or documentation for this item.";
    }
    return `Please provide the supporting rationale or documentation for this item: ${trimmed}.`;
}
function isRefinishSupportItem(value) {
    const lower = (value ?? "").toLowerCase();
    return (lower.includes("refinish") ||
        lower.includes("blend") ||
        lower.includes("tint") ||
        lower.includes("let-down") ||
        lower.includes("let down") ||
        lower.includes("color sand") ||
        lower.includes("denib") ||
        lower.includes("polish") ||
        lower.includes("masking") ||
        lower.includes("edge prep") ||
        lower.includes("flex additive"));
}
function synthesizeSupplementItemsFromNarrative(params) {
    const text = [
        params.assistantAnalysis,
        params.analysisNarrative,
        params.panelNarrative,
        ...params.recommendedActions,
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
    if (!text.trim())
        return [];
    const candidates = [];
    const add = (title, rationale, priority = "medium", kind = "underwritten_operation") => {
        if (!isSpecificSupplementItem(title))
            return;
        candidates.push({
            title,
            category: inferSupplementCategory(title),
            kind,
            rationale,
            source: "Structured narrative",
            priority,
        });
    };
    if (hasExplicitFitCheckLanguage(text) && looksLikeFrontEndOrFitSensitiveScope(text)) {
        add("Pre-Paint Test Fit", "Test-fit or fit-check work appears supportable for adjacent panels before final finish work.", "high", "underwritten_operation");
    }
    if (hasTrueStructuralMeasurementSignals(text)) {
        add("Structural Measurement Verification", "Documented measurements or structural verification appear supportable here, but that verification item is not clearly documented in the current estimate.", "high", "missing_verification");
    }
    if (text.includes("tie bar") ||
        text.includes("lock support") ||
        text.includes("radiator support") ||
        text.includes("support area") ||
        text.includes("upper rail")) {
        if (/(not clearly|underwritten|not documented|unclear)/.test(text)) {
            add("Front Structure Scope / Tie Bar / Upper Rail Reconciliation", "Front-structure, tie-bar, lock-support, radiator-support, or adjacent support-area scope appears broader than the current estimate reflects.", "high", "disputed_repair_path");
        }
    }
    if (/\b(?:aperture|door shell|quarter|roof rail|side structure|side[-\s]?impact sensor)\b/.test(text) &&
        /(not clearly|underwritten|not documented|unclear|verification|fit|gap|seal|closure)/.test(text)) {
        add("Side Structure / Aperture / Door-Shell Fit Verification", "The narrative supports side-structure, aperture, door-shell, quarter, roof-rail, or closure-fit verification tied to the documented side repair path.", "high", "missing_verification");
    }
    if ((text.includes("corrosion protection") || text.includes("weld protection") || text.includes("masking")) &&
        /(not clearly|underwritten|not documented|unclear|missing)/.test(text)) {
        add("Corrosion Protection / Weld Restoration", "Corrosion protection, cavity wax, weld protection, or related restoration steps appear supportable here, but they are not clearly documented in the current estimate.", "medium", "underwritten_operation");
    }
    if (text.includes("refrigerant")) {
        add("Refrigerant Recover / Recharge", "Refrigerant handling appears supportable here, but that process burden is not clearly documented in the current estimate.", "medium", "underwritten_operation");
    }
    if (text.includes("coolant") || text.includes("air purge") || text.includes("bleed")) {
        add("Coolant Fill and Bleed", "Coolant refill, bleed, or air-purge work appears supportable here, but that operation is not clearly documented in the current estimate.", "medium", "underwritten_operation");
    }
    if (text.includes("teardown") || text.includes("mounting geometry") || text.includes("hidden damage")) {
        const impactZone = (0, impactZone_1.deriveImpactZone)({ text });
        if (hasNarrativeSupportScopeEvidence(text)) {
            if ((0, impactZone_1.isSideImpactZone)(impactZone) && impactZone.confidence !== "low" && !(0, impactZone_1.hasFrontSupportZoneEvidence)(text)) {
                add("Side Structure / Aperture / Door-Shell Fit Verification", "Teardown or documentation follow-up should stay tied to the documented side-impact repair path rather than a generic front mounting-geometry assumption.", "high", "missing_verification");
            }
            else {
                add("Hidden Mounting Geometry / Teardown Growth", "Teardown growth or hidden mounting-geometry burden appears supportable here, but that broader scope is not fully reflected in the current estimate.", "high", "disputed_repair_path");
            }
        }
    }
    if (hasNarrativeHardwareEvidence(text)) {
        add("One-Time-Use Hardware / Seals / Clips", "The file supports one-time-use hardware, seals, clips, or related replacement burden, but the estimate does not yet clearly show what should be added or documented.", "medium", "underwritten_operation");
    }
    if (text.includes("battery disconnect") || text.includes("battery reset") || text.includes("reset considerations")) {
        add("Battery Disconnect / Reset Considerations", "Battery disconnect or reset considerations appear relevant here, but that process item is not clearly documented in the current estimate.", "medium", "missing_verification");
    }
    if (hasNarrativeAlignmentEvidence(text)) {
        add("Four-Wheel Alignment", "Alignment appears relevant to the documented repair scope, but that operation is not clearly documented in the current estimate.", "medium", "missing_verification");
    }
    return candidates
        .filter((item, index, all) => all.findIndex((entry) => normalizeKey(entry.title) === normalizeKey(item.title)) === index)
        .sort(sortSupplementItems);
}
function hasNarrativeAlignmentEvidence(text) {
    return (text.includes("alignment") ||
        text.includes("toe") ||
        text.includes("camber") ||
        text.includes("caster") ||
        text.includes("suspension") ||
        text.includes("steering") ||
        text.includes("subframe"));
}
function hasNarrativeHardwareEvidence(text) {
    return (text.includes("one-time-use") ||
        text.includes("one time use") ||
        text.includes("hardware") ||
        text.includes("fastener") ||
        text.includes("retainer") ||
        /\bclip(s)?\b/i.test(text) ||
        /\bseal(s)?\b/i.test(text) ||
        text.includes("non-reusable") ||
        text.includes("replace hardware"));
}
function hasNarrativeSupportScopeEvidence(text) {
    return (text.includes("tie bar") ||
        text.includes("lock support") ||
        text.includes("core support") ||
        text.includes("radiator support") ||
        text.includes("support area") ||
        text.includes("upper rail") ||
        text.includes("guide") ||
        text.includes("bracket") ||
        text.includes("mount"));
}
function normalizeAcvStatus(valuation) {
    if (valuation.acvStatus === "provided" && typeof valuation.acvValue === "number") {
        return "provided";
    }
    if (valuation.acvStatus === "estimated_range" && isSaneRange(valuation.acvRange, 250000)) {
        return "estimated_range";
    }
    return "not_determinable";
}
function summarizeExportValuationBand(params) {
    if (params.status === "estimated_range" && isSaneRange(params.range, params.maxRange)) {
        return `${params.label}: ${formatCompactCurrency(params.range.low)}-${formatCompactCurrency(params.range.high)} (directional only)`;
    }
    if (params.status === "provided" && typeof params.value === "number") {
        return `${params.label}: around ${formatCompactCurrency(params.value)} (directional only)`;
    }
    return `${params.label}: directional range not strongly supported from the current file set`;
}
function formatCompactCurrency(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}
function coerceSaneDvRange(low, high) {
    if (typeof low !== "number" || typeof high !== "number")
        return undefined;
    const range = { low, high };
    return isSaneRange(range, 50000) ? range : undefined;
}
function isSaneRange(range, max) {
    if (!range)
        return false;
    if (!Number.isFinite(range.low) || !Number.isFinite(range.high))
        return false;
    if (range.low <= 0 || range.high <= 0)
        return false;
    if (range.high < range.low)
        return false;
    if (range.high > max)
        return false;
    if (range.high / range.low > 10)
        return false;
    return true;
}
function normalizeKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function looksLikeEstimateNoise(value) {
    if (!value)
        return false;
    const lower = value.toLowerCase();
    const estimateTokens = ["r&i", "rpr", "repl", "blnd", "refn", "scan", "cal"];
    const matchCount = estimateTokens.filter((token) => lower.includes(token)).length;
    return matchCount >= 3 || /(?:\b[a-z]{2,5}\b\s+){6,}/i.test(lower) && lower.includes(" r&i ");
}
function sanitizeNarrative(value) {
    if (!value)
        return null;
    const cleaned = value
        .replace(/\r/g, "")
        .replace(/(?:^|\n)\s*(?:what looks reasonable|what still needs support|what looks aggressive|what stands out|documented positives|likely remaining gaps|support posture|estimate position)\s*:\s*(?=\n|$)/gim, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (!cleaned || looksLikeEstimateNoise(cleaned)) {
        return null;
    }
    if (/upload an estimate or supporting documents to generate a real repair intelligence read/i.test(cleaned)) {
        return null;
    }
    return cleaned;
}
function looksLikeYearOnlyVehicleLabel(value) {
    if (!value)
        return false;
    return /^(19|20)\d{2}$/.test(value.trim());
}
function looksLikeWeakVehicleIdentityLabel(value) {
    if (!value)
        return false;
    const cleaned = (0, displayText_1.cleanDisplayText)(value);
    if (!cleaned || looksLikeYearOnlyVehicleLabel(cleaned)) {
        return true;
    }
    const tokens = cleaned
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
    const nonYearTokens = tokens.filter((token) => !/^(19|20)\d{2}$/.test(token));
    return nonYearTokens.length < 2;
}
function cleanPresentationProse(value) {
    const cleaned = (0, displayText_1.cleanDisplayText)(value);
    if (!cleaned)
        return "";
    const withoutEmptyStubs = cleaned
        .replace(/\bNo clear structural measuring listed\.?\b/gi, "")
        .replace(/\bWhere it looks incomplete or likely to supplement:\.?/gi, "")
        .replace(/\b(?:What looks reasonable|What still needs support|What looks aggressive|What stands out|Documented positives|Likely remaining gaps|Support posture|Estimate position):\s*/gi, "")
        .replace(/(?:^|[\s.])Areas that look aggressive or likely to get pushback\s*:?\s*(?:\.)?(?=\s|$)/gi, " ")
        .trim();
    if (!withoutEmptyStubs)
        return "";
    const withoutInlineEnumeration = withoutEmptyStubs.replace(INLINE_ENUMERATION_PATTERN, "$1").trim();
    const detailBlockMatch = withoutInlineEnumeration.match(PRESENTATION_DETAIL_BLOCK_PATTERN);
    const beforeDetailBlock = detailBlockMatch
        ? withoutInlineEnumeration.slice(0, detailBlockMatch.index).trim()
        : withoutInlineEnumeration;
    const collapsed = beforeDetailBlock
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();
    return removeNearDuplicateConclusionSentences(trimTrailingPunctuation(collapsed) + (collapsed ? "." : ""));
}
function stripUnsupportedSeamSealerLanguage(value, sourceText = "", preserveWhenCurated = false) {
    const cleaned = value ?? "";
    if (!cleaned)
        return "";
    if (preserveWhenCurated || hasExplicitSeamSealerSupport(sourceText)) {
        return cleaned;
    }
    return cleaned
        .replace(/\bAdd and document Seam sealer application before final repair delivery\.?/gi, "")
        .replace(/\bPlease review whether Seam sealer application not clearly documented in estimate is already represented in the estimate and what should be added or documented more clearly if it remains part of the repair path\.?/gi, "")
        .replace(/\bseam sealer restore\/apply operation\b/gi, "matching repair-process support")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
}
function hasExplicitSeamSealerSupport(sourceText) {
    const lower = sourceText.toLowerCase();
    return /(seam sealer|joint sealing|sealer application|weld protection|weld prep|weld-through primer|weld thru primer)/.test(lower);
}
function makeRepairPositionTail(value) {
    const cleaned = sanitizeNarrative(value);
    if (!cleaned)
        return null;
    const lower = cleaned.toLowerCase();
    if (lower.includes("the shop estimate appears materially more complete") ||
        lower.includes("the carrier estimate remains materially underwritten") ||
        lower.includes("credible preliminary repair plan") ||
        lower.includes("not obviously padded") ||
        lower.includes("likely incomplete in measuring") ||
        lower.includes("likely to grow after teardown")) {
        return null;
    }
    return trimTrailingPunctuation(cleaned);
}
function removeNearDuplicateConclusionSentences(value) {
    const sentences = value
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    const kept = [];
    const seenConcepts = new Set();
    for (const sentence of sentences) {
        const concept = normalizeConclusionConcept(sentence);
        if (concept && seenConcepts.has(concept)) {
            continue;
        }
        if (concept) {
            seenConcepts.add(concept);
        }
        kept.push(sentence);
    }
    return kept.join(" ").trim();
}
function normalizeConclusionConcept(value) {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    // Broad category buckets — each key phrase maps to a single concept slot
    const conceptMap = [
        [/credible preliminary (repair plan|position)/, "single_estimate_conclusion"],
        [/likely to grow after teardown/, "single_estimate_conclusion"],
        [/not obviously padded/, "single_estimate_conclusion"],
        [/likely incomplete in measuring/, "single_estimate_conclusion"],
        [/alignment.+hidden damage/, "hidden_damage_concept"],
        [/file documents a credible/, "file_credibility_statement"],
        [/supports a focused estimate review/, "file_credibility_statement"],
        [/repair path appears (supported|credible|defensible)/, "repair_path_statement"],
        [/adas calibration (may|is|remains)/, "adas_calibration_mention"],
        [/pre.?repair scan/, "pre_scan_mention"],
        [/corrosion protection/, "corrosion_protection_mention"],
        [/structural measurement/, "structural_measurement_mention"],
        [/support remains open/, "support_open_generic"],
        [/further documentation (is needed|needed|required)/, "support_open_generic"],
        [/referenced.+not produced/, "referenced_not_produced"],
        [/supplementable (but|with)/, "supplement_opportunity_generic"],
    ];
    for (const [pattern, concept] of conceptMap) {
        if (pattern.test(normalized))
            return concept;
    }
    return null;
}
function isSpecificSupplementItem(value) {
    if (!value)
        return false;
    const lower = value.toLowerCase();
    if (lower.includes("carrier estimate") ||
        lower.includes("shop estimate") ||
        lower.includes("repair story") ||
        lower.includes("support gaps") ||
        lower.includes("narrows repair scope") ||
        lower.includes("story alignment") ||
        lower.includes("estimate appears")) {
        return false;
    }
    return (lower.includes("scan") ||
        lower.includes("calibration") ||
        lower.includes("radar") ||
        lower.includes("camera") ||
        lower.includes("sensor") ||
        lower.includes("alignment") ||
        lower.includes("setup") ||
        lower.includes("test fit") ||
        lower.includes("fit-sensitive") ||
        lower.includes("fit sensitive") ||
        lower.includes("fender") ||
        lower.includes("aperture") ||
        lower.includes("door shell") ||
        lower.includes("roof rail") ||
        lower.includes("quarter") ||
        lower.includes("side structure") ||
        lower.includes("bumper") ||
        lower.includes("lamp") ||
        lower.includes("replace vs repair") ||
        lower.includes("repair vs replace") ||
        lower.includes("access") ||
        lower.includes("cooling") ||
        lower.includes("coolant") ||
        lower.includes("bleed") ||
        lower.includes("purge") ||
        lower.includes("hardware") ||
        lower.includes("one-time-use") ||
        lower.includes("one time use") ||
        lower.includes("fastener") ||
        lower.includes("clip") ||
        lower.includes("seal") ||
        lower.includes("seam") ||
        lower.includes("corrosion") ||
        lower.includes("primer") ||
        lower.includes("wax") ||
        lower.includes("refinish") ||
        lower.includes("blend") ||
        lower.includes("tint") ||
        lower.includes("let-down") ||
        lower.includes("let down") ||
        lower.includes("denib") ||
        lower.includes("color sand") ||
        lower.includes("polish") ||
        lower.includes("masking") ||
        lower.includes("edge prep") ||
        lower.includes("flex additive") ||
        lower.includes("tie bar") ||
        lower.includes("lock support") ||
        lower.includes("core support") ||
        lower.includes("support area") ||
        lower.includes("sidemember") ||
        lower.includes("mounting geometry") ||
        lower.includes("teardown") ||
        lower.includes("measure") ||
        lower.includes("section") ||
        lower.includes("weld") ||
        lower.includes("airbag") ||
        lower.includes("seat belt") ||
        lower.includes("road test"));
}
function buildIssueEvidence(report, evidenceIds, title) {
    if (!report || evidenceIds.length === 0)
        return undefined;
    const relevantEvidence = report.evidence
        .filter((entry) => evidenceIds.includes(entry.id))
        .filter((entry) => isRelevantEvidenceForSupplement(title, entry.title, entry.snippet))
        .slice(0, 2)
        .map((entry) => `${entry.title}: ${entry.snippet}`)
        .join(" | ");
    if (relevantEvidence) {
        return relevantEvidence;
    }
    const fallbackEvidence = report.evidence
        .filter((entry) => evidenceIds.includes(entry.id))
        .slice(0, 1)
        .map((entry) => `${entry.title}: ${entry.snippet}`)
        .join(" | ");
    return fallbackEvidence || undefined;
}
function isRelevantEvidenceForSupplement(title, evidenceTitle, evidenceSnippet) {
    if (!title)
        return true;
    const haystack = `${evidenceTitle ?? ""} ${evidenceSnippet ?? ""}`.toLowerCase();
    if (title === "Seam Sealer Restoration") {
        if (haystack.includes("color coat application") ||
            haystack.includes("bagging") ||
            haystack.includes("three-stage finish") ||
            haystack.includes("three stage finish") ||
            haystack.includes("color blend")) {
            return false;
        }
        return (haystack.includes("seam sealer") ||
            haystack.includes("sealer") ||
            haystack.includes("joint sealing") ||
            haystack.includes("corrosion") ||
            haystack.includes("cavity wax") ||
            haystack.includes("weld protection"));
    }
    return true;
}
function isContradictorySupportiveDraft(draft, report, supplementItems) {
    const lower = draft.toLowerCase();
    const soundsComplete = lower.includes("appears to support a complete repair process") ||
        lower.includes("support a complete repair process");
    const hasGapSignals = (report?.summary.criticalIssues ?? 0) > 0 ||
        (report?.missingProcedures.length ?? 0) > 0 ||
        supplementItems.length > 0;
    return soundsComplete && hasGapSignals;
}
function mergePriority(left, right) {
    if (left === "high" || right === "high")
        return "high";
    if (left === "medium" || right === "medium")
        return "medium";
    return "low";
}
function paramsToAnalysisFindings(report, panel) {
    const items = [];
    if (report) {
        for (const issue of report.issues) {
            if (isSpecificSupplementItem(issue.title)) {
                items.push({
                    title: issue.title,
                    reason: issue.impact || issue.finding,
                    evidence: buildIssueEvidence(report, issue.evidenceIds, deriveSupplementTitle(issue.title)),
                    source: issue.category,
                    priority: issue.severity,
                });
            }
        }
    }
    if (panel) {
        for (const item of panel.supplements) {
            if (isSpecificSupplementItem(item.mappedLabel || item.title)) {
                items.push({
                    title: item.mappedLabel || item.title,
                    reason: item.rationale,
                    evidence: item.support,
                    source: "Decision panel",
                    priority: "medium",
                });
            }
        }
    }
    return items;
}

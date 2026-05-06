"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAnalysisModeLabel = formatAnalysisModeLabel;
exports.buildExportTemplateSourceModel = buildExportTemplateSourceModel;
exports.buildRebuttalEmailTemplate = buildRebuttalEmailTemplate;
exports.buildDisputeIntelligenceReport = buildDisputeIntelligenceReport;
const buildExportModel_1 = require("./buildExportModel");
const estimateComparisons_1 = require("@/lib/workspace/estimateComparisons");
const presentationText_1 = require("@/lib/ui/presentationText");
const estimateComparisonPresentation_1 = require("@/components/workspace/estimateComparisonPresentation");
function formatAnalysisModeLabel(mode) {
    switch (mode) {
        case "comparison":
            return "Comparison Review";
        case "single-document-review":
            return "Single Estimate Review";
        case "parser-incomplete":
            return "Estimate Review";
        default:
            return "Estimate Review";
    }
}
function buildExportTemplateSourceModel(params) {
    const exportModel = resolveExportModel(params);
    const analysisMode = params.analysis?.mode ?? params.report?.analysis?.mode ?? "single-document-review";
    const fallbackComparisons = params.analysis?.estimateComparisons ?? params.report?.analysis?.estimateComparisons;
    const structuredComparisons = (0, estimateComparisons_1.normalizeWorkspaceEstimateComparisons)(params.workspaceData ? (params.workspaceData.estimateComparisons ?? null) : fallbackComparisons);
    const topDifferences = (0, estimateComparisonPresentation_1.getTopEstimateComparisonHighlights)(structuredComparisons.rows);
    const source = {
        exportModel,
        analysisMode,
        generatedLabel: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        }),
        categoryComparisons: buildCategoryComparisons(exportModel, analysisMode),
        lineItems: buildUiAlignedLineItems(exportModel, topDifferences, analysisMode),
        topDifferences,
    };
    if (source.categoryComparisons.length === 0) {
        source.categoryComparisons = [
            {
                category: "Overall Repair Position",
                shopPosition: exportModel.repairPosition,
                carrierPosition: exportModel.positionStatement,
                supportStatus: exportModel.supplementItems.length > 0 ? "underwritten" : "supported",
                rationale: exportModel.positionStatement,
                supportingFields: ["repairPosition", "positionStatement"],
            },
        ];
    }
    if (source.lineItems.length === 0) {
        source.lineItems = exportModel.supplementItems.slice(0, 8).map((item) => ({
            operation: displaySupplementTitle(item.title),
            component: formatCategoryLabel(item.category),
            carrierPosition: describeCarrierPosition(item, analysisMode === "comparison"),
            supportStatus: mapSupportStatus(item.kind),
            rationale: item.rationale,
            support: buildSupportSnippet(item),
        }));
    }
    return source;
}
function buildRebuttalEmailTemplate(params) {
    const source = buildExportTemplateSourceModel(params);
    const { exportModel } = source;
    const subjectVehicle = (0, buildExportModel_1.preferCanonicalField)(exportModel.reportFields.vehicleLabel, (0, buildExportModel_1.buildPreferredRebuttalSubjectVehicleLabel)(exportModel.vehicle)) ?? "Current repair file";
    const topItems = exportModel.supplementItems.slice(0, 4);
    const asks = topItems.length > 0
        ? topItems.map((item) => `- ${displaySupplementTitle(item.title)}: ${buildRequestSentence(item)}`)
        : ["- Please review the current estimate support and provide any supporting documentation needed to confirm the intended scope."];
    return [
        `Subject: Request for estimate revision - ${subjectVehicle}`,
        "",
        "To: [Carrier Adjuster Email]",
        "CC: [Shop / File Team]",
        "",
        "Hello,",
        "",
        `After reviewing the current file, our position is that ${lowercaseFirst(exportModel.repairPosition)}`,
        "",
        "The main items that still need revision or support are:",
        ...asks,
        "",
        "Please update the estimate or provide the documentation supporting the current position on the items above.",
        "",
        "If helpful, I can send the supporting estimate excerpts and comparison notes in a follow-up.",
        "",
        "Thank you,",
        "[Your Name]",
        "[Title / Shop]",
        "[Phone / Email]",
    ].join("\n");
}
function buildDisputeIntelligenceReport(params) {
    const source = buildExportTemplateSourceModel(params);
    const { exportModel } = source;
    const vehicleIdentity = (0, buildExportModel_1.resolveCanonicalVehicleLabel)(exportModel) ?? "Unspecified";
    const report = exportModel.disputeIntelligenceReport;
    const topDriverBlocks = report.topDrivers.map((driver) => [
        `## ${driver.title}`,
        `Impact: ${formatCategoryLabel(driver.impact)}`,
        `Support status: ${formatCategoryLabel(driver.supportStatus)}`,
        `Why it matters: ${driver.whyItMatters}`,
        `Current gap: ${driver.currentGap}`,
        `Recommended next action: ${driver.nextAction}`,
    ].join("\n"));
    return [
        "# Dispute Intelligence Report",
        "",
        `Generated: ${source.generatedLabel}`,
        `Vehicle: ${vehicleIdentity}`,
        `Mode: ${formatAnalysisModeLabel(source.analysisMode)}`,
        "",
        "## At-a-Glance Conclusion",
        report.summary,
        "",
        "## What Helps the Shop Position",
        ...report.positives.map((item) => `- ${item}`),
        "",
        "## What Still Needs Support",
        ...report.supportGaps.map((item) => `- ${item}`),
        "",
        "## Recommended Next Moves",
        ...report.nextMoves.map((item) => `- ${item}`),
        "",
        ...(report.valuationPreview
            ? [
                "## Valuation Preview",
                `- ${report.valuationPreview.dv}`,
                `- ${report.valuationPreview.acv}`,
                "",
            ]
            : []),
        "## Top Dispute Drivers",
        "",
        ...topDriverBlocks,
    ]
        .filter(Boolean)
        .join("\n");
}
function buildCategoryComparisons(exportModel, analysisMode) {
    const isComparison = analysisMode === "comparison";
    const grouped = new Map();
    for (const item of exportModel.supplementItems) {
        const key = item.category || "general";
        const existing = grouped.get(key) ?? [];
        existing.push(item);
        grouped.set(key, existing);
    }
    return [...grouped.entries()].map(([category, items]) => {
        const topItems = items.slice(0, 3);
        const supportStatus = deriveCategorySupportStatus(items);
        return {
            category: formatCategoryLabel(category),
            shopPosition: summarizeShopCategoryPosition(topItems, exportModel.repairPosition, isComparison),
            carrierPosition: summarizeCarrierCategoryPosition(topItems, isComparison),
            supportStatus,
            rationale: topItems.map((item) => item.rationale).join(" "),
            supportingFields: compact([
                "repairPosition",
                "positionStatement",
                ...topItems.map((item) => item.source),
            ]),
        };
    });
}
function displaySupplementTitle(value) {
    return (0, presentationText_1.cleanOperationDisplayText)(value) || (0, estimateComparisonPresentation_1.cleanOperationDisplayText)(value) || value || "Repair Operation";
}
function buildUiAlignedLineItems(exportModel, topDifferences, analysisMode) {
    const isComparison = analysisMode === "comparison";
    const supplementItems = exportModel.supplementItems.slice(0, 8).map((item) => ({
        operation: displaySupplementTitle(item.title),
        component: formatCategoryLabel(item.category),
        carrierPosition: describeCarrierPosition(item, isComparison),
        supportStatus: mapSupportStatus(item.kind),
        rationale: item.rationale,
        support: buildSupportSnippet(item),
    }));
    if (supplementItems.length > 0) {
        return supplementItems;
    }
    return topDifferences.slice(0, 5).map((difference, index) => ({
        operation: `Top Difference ${index + 1}`,
        component: "Workspace summary",
        carrierPosition: difference,
        supportStatus: "underwritten",
        rationale: difference,
    }));
}
function summarizeShopCategoryPosition(items, repairPosition, isComparison) {
    if (items.length === 0) {
        return repairPosition;
    }
    if (!isComparison) {
        return `The estimate position supports ${joinHumanList(items.map((item) => displaySupplementTitle(item.title).toLowerCase()))}.`;
    }
    return `The shop-side repair path supports ${joinHumanList(items.map((item) => displaySupplementTitle(item.title).toLowerCase()))}.`;
}
function summarizeCarrierCategoryPosition(items, isComparison) {
    if (items.length === 0) {
        return isComparison
            ? "No clear unsupported variance was identified in this category from the current file review."
            : "No clear estimate-support issue was identified in this category from the current file review.";
    }
    return items.map((item) => describeCarrierPosition(item, isComparison)).join(" ");
}
function deriveCategorySupportStatus(items) {
    if (items.some((item) => item.kind === "missing_operation"))
        return "missing";
    if (items.some((item) => item.kind === "disputed_repair_path"))
        return "disputed";
    if (items.some((item) => item.kind === "underwritten_operation" || item.kind === "missing_verification")) {
        return "underwritten";
    }
    return "supported";
}
function describeCarrierPosition(item, isComparison = true) {
    const label = displaySupplementTitle(item.title);
    switch (item.kind) {
        case "missing_operation":
            return isComparison
                ? `${label} is not clearly carried in the current estimate posture.`
                : `${label} is not clearly carried in the current estimate support.`;
        case "missing_verification":
            return isComparison
                ? `${label} may be implicitly required, but the current verification or documentation is not clearly shown.`
                : `${label} may be relevant, but the current verification or documentation is not clearly shown.`;
        case "underwritten_operation":
            return isComparison
                ? `${label} appears lighter or under-supported in the current estimate.`
                : `${label} still needs clearer estimate support or documentation.`;
        default:
            return isComparison
                ? `${label} reflects a repair-path position that still needs clearer support in the current file.`
                : `${label} still needs clearer support in the current file.`;
    }
}
function mapSupportStatus(kind) {
    switch (kind) {
        case "missing_operation":
            return "missing";
        case "underwritten_operation":
        case "missing_verification":
            return "underwritten";
        case "disputed_repair_path":
            return "disputed";
        default:
            return "supported";
    }
}
function buildSupportSnippet(item) {
    if (item.evidence) {
        return item.evidence;
    }
    if (item.source && !/^(?:estimate text|documentation)$/i.test(item.source)) {
        return `Document support: ${item.source}`;
    }
    return undefined;
}
function buildRequestSentence(item) {
    switch (item.kind) {
        case "missing_operation":
            return "Please add this item or clarify why it is not required for the documented repair path.";
        case "missing_verification":
            return "Please provide the verification, calibration, or documentation support for this item.";
        case "underwritten_operation":
            return "Please provide the documentation showing how this item is supported in the current estimate.";
        default:
            return "Please clarify the intended repair-path position and provide the supporting documentation for this item.";
    }
}
function formatCategoryLabel(value) {
    return value
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
function lowercaseFirst(value) {
    if (!value)
        return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
}
function compact(values) {
    return values.filter((value) => Boolean(value && value.trim()));
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
function resolveExportModel(params) {
    if (params.renderModel) {
        return (0, buildExportModel_1.redactExportModelForDownload)(params.renderModel);
    }
    return (0, buildExportModel_1.redactExportModelForDownload)((0, buildExportModel_1.buildExportModel)({
        report: params.report,
        analysis: params.analysis,
        panel: params.panel,
        assistantAnalysis: params.assistantAnalysis,
    }));
}

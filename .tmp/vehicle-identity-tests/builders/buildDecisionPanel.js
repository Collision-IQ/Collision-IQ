"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDecisionPanel = buildDecisionPanel;
exports.buildDecisionPanelHybrid = buildDecisionPanelHybrid;
const dvCalculator_1 = require("./dvCalculator");
const negotiationEngine_1 = require("./negotiationEngine");
const appraisalEngine_1 = require("./appraisalEngine");
const supplementBuilder_1 = require("./supplementBuilder");
const lineMappingEngine_1 = require("./lineMappingEngine");
const stateLeverageEngine_1 = require("./stateLeverageEngine");
const structuralApplicability_1 = require("../structuralApplicability");
function buildDecisionPanel(result) {
    const supplements = (0, supplementBuilder_1.buildSupplementLines)(result);
    const mappedLines = (0, lineMappingEngine_1.mapSupplementLines)(supplements, "ccc");
    const diminishedValue = buildDV(result);
    const negotiationResponse = (0, negotiationEngine_1.generateNegotiationResponse)(result);
    const appraisal = (0, appraisalEngine_1.detectAppraisalOpportunity)(result);
    const stateLeverage = (0, stateLeverageEngine_1.buildStateLeverage)().points;
    const supplementsWithMappedLabels = finalizeDecisionPanelSupplements(supplements.map((supplement, index) => ({
        ...supplement,
        mappedLabel: mappedLines[index]?.label,
    })), result.rawEstimateText ?? "");
    return {
        narrative: result.narrative,
        supplements: supplementsWithMappedLabels,
        ...(diminishedValue ? { diminishedValue } : {}),
        ...(negotiationResponse ? { negotiationResponse } : {}),
        appraisal: {
            triggered: appraisal.shouldRecommend,
            reasoning: appraisal.reasons.join(". "),
        },
        ...(stateLeverage.length > 0 ? { stateLeverage } : {}),
    };
}
async function buildDecisionPanelHybrid(params) {
    const structurallyScopedCandidates = (0, structuralApplicability_1.filterStructuralTitles)(params.supplementCandidates, (0, structuralApplicability_1.deriveStructuralApplicabilityFromResult)(params.result));
    const validCandidates = (0, supplementBuilder_1.validateSupplements)(params.result.rawEstimateText ?? "", structurallyScopedCandidates, params.supplementContext);
    const supplements = (0, supplementBuilder_1.buildSupplementLinesHybrid)(validCandidates, params.result.rawEstimateText ?? "");
    const mappedLines = (0, lineMappingEngine_1.mapSupplementLines)(supplements, "ccc");
    const diminishedValue = buildDV(params.result);
    const negotiationResponse = (0, negotiationEngine_1.generateNegotiationResponse)(params.result);
    const appraisal = (0, appraisalEngine_1.detectAppraisalOpportunity)(params.result);
    const stateLeverage = (0, stateLeverageEngine_1.buildStateLeverage)().points;
    const supplementsWithMappedLabels = finalizeDecisionPanelSupplements(supplements.map((supplement, index) => ({
        ...supplement,
        mappedLabel: mappedLines[index]?.label,
    })), params.result.rawEstimateText ?? "");
    return {
        narrative: params.result.narrative,
        supplements: supplementsWithMappedLabels,
        ...(diminishedValue ? { diminishedValue } : {}),
        ...(negotiationResponse ? { negotiationResponse } : {}),
        appraisal: {
            triggered: appraisal.shouldRecommend,
            reasoning: appraisal.reasons.join(". "),
        },
        ...(stateLeverage.length > 0 ? { stateLeverage } : {}),
    };
}
function finalizeDecisionPanelSupplements(supplements, evidenceText) {
    const lowerEvidence = evidenceText.toLowerCase();
    const filtered = supplements.filter((item) => {
        const title = item.mappedLabel ?? item.title;
        if (title === "Four-Wheel Alignment" && !hasDecisionPanelAlignmentEvidence(lowerEvidence)) {
            return false;
        }
        if (title === "One-Time-Use Hardware / Seals / Clips" &&
            !hasDecisionPanelHardwareEvidence(lowerEvidence)) {
            return false;
        }
        return true;
    });
    const ranked = [...filtered].sort((left, right) => scoreDecisionPanelSupplement(right) - scoreDecisionPanelSupplement(left));
    const kept = [];
    const seenFamilies = new Set();
    let genericFallbacks = 0;
    for (const item of ranked) {
        const title = item.mappedLabel ?? item.title;
        const family = inferDecisionPanelSupplementFamily(title);
        const generic = isDecisionPanelGenericFallback(title);
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
function inferDecisionPanelSupplementFamily(title) {
    const lower = title.toLowerCase();
    if (lower.includes("front structure") ||
        lower.includes("tie bar") ||
        lower.includes("lock support") ||
        lower.includes("core support") ||
        lower.includes("upper rail") ||
        lower.includes("hidden mounting")) {
        return "front_structure_scope";
    }
    if (lower.includes("rear body") ||
        lower.includes("deck opening") ||
        lower.includes("bumper reinforcement") ||
        lower.includes("rear sensor") ||
        lower.includes("blind spot") ||
        lower.includes("deck lid") ||
        lower.includes("latch") ||
        lower.includes("striker")) {
        return "rear_structure_scope";
    }
    if (lower.includes("test fit") || lower.includes("fit-sensitive"))
        return "fit_verification";
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
function isDecisionPanelGenericFallback(title) {
    return [
        "Four-Wheel Alignment",
        "One-Time-Use Hardware / Seals / Clips",
        "Structural Measurement Verification",
        "Hidden Mounting Geometry / Teardown Growth",
    ].includes(title);
}
function scoreDecisionPanelSupplement(item) {
    const lower = `${item.mappedLabel ?? item.title} ${item.rationale}`.toLowerCase();
    let score = item.rationale.length;
    if (lower.includes("front structure") || lower.includes("tie bar") || lower.includes("lock support"))
        score += 80;
    if (lower.includes("rear body") || lower.includes("deck opening") || lower.includes("bumper reinforcement"))
        score += 80;
    if (lower.includes("test fit") || lower.includes("fit-sensitive"))
        score += 45;
    if (lower.includes("sensor") || lower.includes("radar") || lower.includes("calibration"))
        score += 35;
    if (isDecisionPanelGenericFallback(item.mappedLabel ?? item.title))
        score -= 35;
    return score;
}
function hasDecisionPanelAlignmentEvidence(value) {
    return (value.includes("alignment") ||
        value.includes("toe") ||
        value.includes("camber") ||
        value.includes("caster") ||
        value.includes("suspension") ||
        value.includes("steering") ||
        value.includes("subframe"));
}
function hasDecisionPanelHardwareEvidence(value) {
    return (value.includes("one-time-use") ||
        value.includes("one time use") ||
        value.includes("hardware") ||
        value.includes("fastener") ||
        value.includes("retainer") ||
        /\bclip(s)?\b/i.test(value) ||
        /\bseal(s)?\b/i.test(value));
}
function buildDV(result) {
    const text = [
        ...result.findings.map((finding) => `${finding.title} ${finding.detail}`),
        ...result.evidence.map((entry) => `${entry.source} ${entry.quote ?? ""}`),
        result.rawEstimateText ?? "",
        result.narrative ?? "",
    ].join(" ");
    const lower = text.toLowerCase();
    const repairCost = extractRepairCost(lower);
    const structural = detectStructural(lower);
    const dv = (0, dvCalculator_1.calculateDV)({
        repairCost,
        structural,
        airbag: false,
        adas: false,
        hybrid: false,
        multiPanel: false,
    });
    if (!dv)
        return undefined;
    return {
        low: dv.low,
        high: dv.high,
        confidence: dv.confidence,
        rationale: dv.rationale,
    };
}
function includesAny(text, needles) {
    return needles.some((needle) => text.includes(needle));
}
function detectStructural(text) {
    return includesAny(text, [
        "structural",
        "frame",
        "rail",
        "pillar",
        "apron",
        "section",
        "unibody",
    ]);
}
function extractRepairCost(text) {
    const matches = [...text.matchAll(/\$?\s*([\d,]+\.\d{2})/g)];
    const values = matches
        .map((match) => Number.parseFloat(match[1].replace(/,/g, "")))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length)
        return undefined;
    return Math.max(...values);
}

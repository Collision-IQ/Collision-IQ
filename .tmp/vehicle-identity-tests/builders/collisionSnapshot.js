"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCollisionSnapshot = buildCollisionSnapshot;
exports.buildSnapshotSafeReport = buildSnapshotSafeReport;
exports.redactSensitiveData = redactSensitiveData;
const pressureMode_1 = require("./pressureMode");
const presentationText_1 = require("@/lib/ui/presentationText");
const BANNED_GENERIC_PHRASES = [
    "credible preliminary repair plan",
    "support remains open",
    "repair path appears supportable",
    "procedure support should not be treated as no support",
    "file documents several parts",
    "current file set supports",
    "the narrative supports",
];
function buildCollisionSnapshot(input) {
    const renderModel = "renderModel" in input ? input.renderModel : input;
    const snapshotSafeReport = buildSnapshotSafeReport(renderModel);
    const estimateComparisons = "renderModel" in input ? input.estimateComparisons : undefined;
    const snapshot = {
        title: "Collision Snapshot",
        vehicleLabel: buildSnapshotVehicleLabel(snapshotSafeReport),
        damageSummary: buildDamageSummary(snapshotSafeReport),
        repairPlanVerdict: buildRepairPlanVerdict(snapshotSafeReport),
        estimateComparison: buildEstimateComparison(snapshotSafeReport, estimateComparisons),
        topDisputeItems: buildTopDisputeItems(snapshotSafeReport),
        evidenceCompleteness: {
            adjustedConfidence: snapshotSafeReport.confidenceIntegrity.adjustedConfidence,
            completenessStatus: snapshotSafeReport.confidenceIntegrity.completenessStatus,
            uploadedFileCount: snapshotSafeReport.confidenceIntegrity.uploadedFileCount,
            uploadLimitReached: snapshotSafeReport.confidenceIntegrity.uploadLimitReached,
            userIndicatedMoreFiles: snapshotSafeReport.confidenceIntegrity.userIndicatedMoreFiles,
            missingCriticalEvidence: snapshotSafeReport.confidenceIntegrity.missingCriticalEvidence.slice(0, 5),
            userFacingDisclosure: snapshotSafeReport.confidenceIntegrity.userFacingDisclosure,
        },
        nextActions: buildNextActions(snapshotSafeReport),
        verdictLine: buildVerdictLine(snapshotSafeReport, estimateComparisons),
        valuationSnapshot: buildValuationSnapshot(snapshotSafeReport),
        disclosure: buildSnapshotDisclosure(snapshotSafeReport),
        redactionNotice: "Sensitive details removed for sharing.",
        pressureMode: snapshotSafeReport.pressureMode.mode,
        pressureModeRationale: snapshotSafeReport.pressureMode.rationale,
    };
    return sanitizeSnapshot(snapshot);
}
function buildSnapshotSafeReport(report, options = {}) {
    return redactSensitiveData(report, options);
}
function redactSensitiveData(report, options = {}) {
    const seen = new WeakMap();
    function redactValue(value, key = "") {
        if (value === null || value === undefined)
            return value;
        if (typeof value === "string")
            return redactSnapshotText(value, key, options);
        if (typeof value !== "object")
            return value;
        if (seen.has(value)) {
            return seen.get(value);
        }
        if (Array.isArray(value)) {
            const output = [];
            seen.set(value, output);
            value.forEach((item) => output.push(redactValue(item, key)));
            return output;
        }
        const output = {};
        seen.set(value, output);
        for (const [entryKey, entryValue] of Object.entries(value)) {
            if (/^debug$/i.test(entryKey))
                continue;
            if (/address|street|phone|email/i.test(entryKey))
                continue;
            if (/customer|claimant|owner|insured|policyholder/i.test(entryKey)) {
                output[entryKey] = "Vehicle Owner";
                continue;
            }
            if (/claim(?:number|no|id)?$/i.test(entryKey) || /claimNumber|claimNo|claimId/i.test(entryKey)) {
                output[entryKey] =
                    typeof entryValue === "string" || typeof entryValue === "number"
                        ? maskIdentifierLast4(String(entryValue))
                        : "[REDACTED_CLAIM]";
                continue;
            }
            if (/insurer|insurance/i.test(entryKey) && !options.showInsurerName) {
                output[entryKey] = "[INSURER HIDDEN]";
                continue;
            }
            if (/\bshop\b|repairFacility|bodyShop/i.test(entryKey) && !options.showShopName) {
                output[entryKey] = "[SHOP HIDDEN]";
                continue;
            }
            output[entryKey] = redactValue(entryValue, entryKey);
        }
        return output;
    }
    return redactValue(report);
}
function buildSnapshotVehicleLabel(renderModel) {
    const parts = [renderModel.vehicle.year, renderModel.vehicle.make, renderModel.vehicle.model]
        .filter(Boolean)
        .map(String);
    return parts.join(" ").trim() || "Vehicle not specified";
}
function buildDamageSummary(renderModel) {
    const candidates = [
        ...renderModel.reportFields.documentedHighlights,
        ...renderModel.reportFields.documentedProcedures,
        ...renderModel.supplementItems.map((item) => item.evidence || item.rationale),
        ...renderModel.findingReasoning.map((finding) => finding.what_proves_it),
    ];
    const claimSpecific = candidates
        .map((item) => cleanSnapshotText(item))
        .filter((item) => Boolean(item))
        .filter((item) => /impact|bumper|quarter|lamp|wheel|door|fender|hood|roof|rail|apron|pillar|structure|refinish|replace|repair|align|measure/i.test(item));
    return dedupe(claimSpecific).slice(0, 3).length
        ? dedupe(claimSpecific).slice(0, 3)
        : ["Damage summary is limited to the current uploaded and retrieved file set."];
}
function buildRepairPlanVerdict(renderModel) {
    const priorityCount = renderModel.disputeStrategy?.priorityFindings.length ?? 0;
    const highSpecificFindings = renderModel.findingReasoning.filter((finding) => finding.claimSpecificity === "high" && finding.confidence >= 0.7).length;
    const incomplete = renderModel.confidenceIntegrity.completenessStatus !== "COMPLETE";
    const hasDisputes = priorityCount > 0 || highSpecificFindings > 0 || renderModel.supplementItems.length > 0;
    const moreCompletePlan = hasDisputes ? "SHOP" : incomplete ? "INCONCLUSIVE" : "CARRIER";
    const carrierPlanStatus = hasDisputes && renderModel.confidenceIntegrity.adjustedConfidence === "High"
        ? "PARTIAL"
        : hasDisputes
            ? "LIGHT"
            : incomplete
                ? "INCONCLUSIVE"
                : "COMPLETE";
    const reasonBase = hasDisputes
        ? "Included findings identify estimate-specific gaps that need revision or written explanation."
        : "The current included findings do not show a stronger competing repair-plan gap.";
    const reason = incomplete
        ? `${reasonBase} Because evidence completeness is ${renderModel.confidenceIntegrity.completenessStatus.toLowerCase()}, this snapshot is not a final repair conclusion.`
        : reasonBase;
    return { moreCompletePlan, carrierPlanStatus, reason };
}
function buildEstimateComparison(renderModel, estimateComparisons) {
    const rows = estimateComparisons?.rows ?? [];
    const comparisonRows = rows.filter((row) => row.deltaType && row.deltaType !== "same");
    const totalRow = rows.find((row) => /total/i.test(`${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""}`));
    const shopTotal = numericValue(totalRow?.lhsValue);
    const carrierTotal = numericValue(totalRow?.rhsValue);
    const hasBothTotals = typeof shopTotal === "number" && typeof carrierTotal === "number";
    const keyDeltas = comparisonRows
        .map(formatComparisonDelta)
        .filter((item) => Boolean(item))
        .slice(0, 5);
    if (!hasBothTotals && keyDeltas.length === 0) {
        return {
            available: false,
            keyDeltas: [],
            unavailableReason: "Estimate comparison is unavailable from the current file.",
        };
    }
    return {
        available: true,
        ...(hasBothTotals
            ? {
                shopEstimateTotal: formatMoney(shopTotal),
                carrierEstimateTotal: formatMoney(carrierTotal),
                difference: formatMoney(shopTotal - carrierTotal),
            }
            : {}),
        keyDeltas,
    };
}
function buildVerdictLine(renderModel, estimateComparisons) {
    const hasLaborDelta = renderModel.supplementItems.some((item) => /labor/i.test(item.category)) ||
        (estimateComparisons?.rows ?? []).some((row) => /labor/i.test(`${row.category ?? ""} ${row.operation ?? ""}`) &&
            row.deltaType &&
            row.deltaType !== "same");
    const hasMissingVerification = renderModel.supplementItems.some((item) => item.kind === "missing_verification") ||
        renderModel.confidenceIntegrity.missingCriticalEvidence.length > 0;
    if (hasLaborDelta && hasMissingVerification) {
        return "Carrier estimate likely incomplete based on current evidence.";
    }
    return undefined;
}
function buildTopDisputeItems(renderModel) {
    const rankedFindings = [...renderModel.findingReasoning].sort((left, right) => (right.leverageScore ?? 0) - (left.leverageScore ?? 0));
    return rankedFindings.slice(0, 3).map((finding) => ({
        issue: cleanSnapshotText(finding.issue) || "Included dispute item",
        whyItMatters: cleanSnapshotText(finding.why_it_matters) || "This item affects the repair-plan or estimate position.",
        evidenceState: `${formatLabel(finding.evidenceLevel)} evidence at ${Math.round(finding.confidence * 100)}% confidence.`,
        nextAction: cleanSnapshotText(finding.next_action) || "Request a revised estimate or written explanation.",
        pressureMode: (0, pressureMode_1.computeItemPressureMode)(finding.evidenceLevel, finding.leverageScore ?? 0),
    }));
}
function buildNextActions(renderModel) {
    const missingProof = renderModel.confidenceIntegrity.missingCriticalEvidence.slice(0, 3);
    return [
        "Request a revised estimate tied to the included dispute items.",
        "Request a written line-item explanation for any denied or reduced operation.",
        missingProof.length
            ? `Request missing proof: ${joinHumanList(missingProof)}.`
            : "Request final support records before treating the analysis as complete.",
    ];
}
function buildValuationSnapshot(renderModel) {
    const acvPreviewRange = formatValuationRange(renderModel.valuation.acvRange);
    const dvPreviewRange = formatValuationRange(renderModel.valuation.dvRange);
    if (!acvPreviewRange && !dvPreviewRange) {
        return {
            available: false,
            disclosure: "Valuation preview not available from current file.",
        };
    }
    return {
        available: true,
        acvPreviewRange,
        dvPreviewRange,
        confidence: [
            renderModel.valuation.acvConfidence ? `ACV ${renderModel.valuation.acvConfidence}` : null,
            renderModel.valuation.dvConfidence ? `DV ${renderModel.valuation.dvConfidence}` : null,
        ].filter(Boolean).join(" / ") || "Directional",
        disclosure: "Directional preview only; not a formal valuation or appraisal.",
    };
}
function buildSnapshotDisclosure(renderModel) {
    if (renderModel.confidenceIntegrity.completenessStatus === "COMPLETE") {
        return "Snapshot is based on the included claim-specific findings and retrieved support available now.";
    }
    return `Snapshot is based on an incomplete file set. ${renderModel.confidenceIntegrity.userFacingDisclosure}`;
}
function sanitizeSnapshot(snapshot) {
    return redactSensitiveData(mapSnapshotStrings(snapshot, (value) => cleanSnapshotText(value) || ""));
}
function mapSnapshotStrings(value, transform) {
    if (typeof value === "string")
        return transform(value);
    if (!value || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map((item) => mapSnapshotStrings(item, transform));
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        key,
        mapSnapshotStrings(entry, transform),
    ]));
}
function redactSnapshotText(value, key, options) {
    let output = value;
    output = output.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (vin) => maskIdentifierLast4(vin));
    output = output.replace(/\bclaim\s*(?:(?:number|no\.?|#|id)\s*[:#-]?|[:#])\s*([A-Z0-9-]{5,})\b/gi, (_match, claimNumber) => `claim #${maskIdentifierLast4(claimNumber)}`);
    output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "");
    output = output.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "");
    output = output.replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/gi, "");
    output = output.replace(/\b(?:customer|owner|claimant|insured|policyholder|name)\s*[:#-]\s*[^,;\n]+/gi, "Vehicle Owner");
    if (/customer|claimant|owner|insured|policyholder/i.test(key)) {
        output = "Vehicle Owner";
    }
    if (/insurer|insurance/i.test(key) && !options.showInsurerName) {
        output = "[INSURER HIDDEN]";
    }
    if (/\bshop\b|repairFacility|bodyShop/i.test(key) && !options.showShopName) {
        output = "[SHOP HIDDEN]";
    }
    return output.replace(/\s{2,}/g, " ").trim();
}
function maskIdentifierLast4(value) {
    const compact = value.replace(/[^A-Za-z0-9]/g, "");
    const last4 = compact.slice(-4);
    return last4 ? `*****${last4}` : "*****";
}
function cleanSnapshotText(value) {
    if (!value)
        return null;
    let output = value.replace(/\s+/g, " ").replace(/\bthe\s+the\b/gi, "the").trim();
    for (const phrase of BANNED_GENERIC_PHRASES) {
        output = output.replace(new RegExp(escapeRegex(phrase), "gi"), "");
    }
    output = output.replace(/\s{2,}/g, " ").trim();
    return output || null;
}
function formatComparisonDelta(row) {
    const label = (0, presentationText_1.cleanOperationDisplayText)(row.operation) ||
        (0, presentationText_1.cleanOperationDisplayText)(row.partName) ||
        (0, presentationText_1.cleanOperationDisplayText)(row.category) ||
        "Estimate line";
    const delta = typeof row.delta === "number" ? `${row.delta > 0 ? "+" : ""}${row.delta}` : row.delta;
    const left = formatComparisonValue(row.lhsValue);
    const right = formatComparisonValue(row.rhsValue);
    if (!label || row.deltaType === "same")
        return null;
    if (/body.*labor|labor/i.test(label))
        return `Body labor: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
    if (/refinish|paint|material/i.test(label))
        return `Refinish/materials: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
    if (/structural|measure|mechanical|calibration|scan|adas/i.test(label)) {
        return `${label}: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
    }
    return `${label}: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
}
function formatComparisonValue(value) {
    if (value === null || value === undefined || `${value}`.trim() === "")
        return "not shown";
    return typeof value === "number" ? `${value}` : String(value);
}
function numericValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string")
        return undefined;
    const numeric = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(numeric) ? numeric : undefined;
}
function formatValuationRange(range) {
    if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high))
        return undefined;
    return `${formatMoney(range.low)} - ${formatMoney(range.high)}`;
}
function formatMoney(value) {
    const absolute = Math.abs(value);
    const formatted = absolute.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    });
    return value < 0 ? `-${formatted}` : formatted;
}
function formatLabel(value) {
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function normalizeKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function dedupe(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = normalizeKey(value);
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function joinHumanList(values) {
    if (values.length <= 1)
        return values[0] ?? "";
    if (values.length === 2)
        return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

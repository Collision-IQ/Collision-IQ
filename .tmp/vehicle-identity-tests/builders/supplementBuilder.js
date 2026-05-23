"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFunctionPresence = detectFunctionPresence;
exports.buildFunctionMap = buildFunctionMap;
exports.buildSupplementLines = buildSupplementLines;
exports.validateSupplements = validateSupplements;
exports.inferCategory = inferCategory;
exports.buildSupplementLinesHybrid = buildSupplementLinesHybrid;
const procedureEquivalence_1 = require("../procedureEquivalence");
const structuralApplicability_1 = require("../structuralApplicability");
const vehicleApplicability_1 = require("../vehicleApplicability");
const buildRepairStory_1 = require("./buildRepairStory");
const estimateOperationEquivalence_1 = require("../estimateOperationEquivalence");
const impactZone_1 = require("../impactZone");
const FUNCTIONS = [
    {
        name: "pre-scan",
        signals: ["pre-repair scan", "pre repair scan", "pre-scan"],
    },
    {
        name: "post-scan",
        signals: ["post-repair scan", "post repair scan", "post-scan", "final scan"],
    },
    {
        name: "calibration",
        signals: [
            "calibration",
            "adas report",
            "blind spot",
            "parking sensor",
            "parking assist",
        ],
    },
];
function detectFunctionPresence(text, signals) {
    const lower = text.toLowerCase();
    return signals.some((signal) => lower.includes(signal));
}
function buildFunctionMap(text) {
    const map = {};
    for (const repairFunction of FUNCTIONS) {
        map[repairFunction.name] = detectFunctionPresence(text, repairFunction.signals);
    }
    return map;
}
function buildSupplementLines(result) {
    const text = extractTextForFunctions(result);
    const context = extractValidationContext(result);
    const vehicleApplicability = extractSupplementVehicleApplicability(result);
    const candidates = Array.isArray(result)
        ? extractSupplementCandidates(result)
        : (0, structuralApplicability_1.filterStructuralTitles)(extractSupplementCandidates(result), (0, structuralApplicability_1.deriveStructuralApplicabilityFromResult)(result));
    if (candidates.length === 0) {
        return [];
    }
    const validatedCandidates = validateSupplements(text, candidates, context, vehicleApplicability);
    return buildSupplementLinesHybrid(validatedCandidates, text, vehicleApplicability);
}
function extractTextForFunctions(result) {
    if (Array.isArray(result)) {
        return result.map((finding) => `${finding.title} ${finding.detail}`).join("\n");
    }
    if ("findings" in result) {
        return result.rawEstimateText ?? "";
    }
    return result.evidence.map((entry) => entry.snippet).join("\n");
}
function validateSupplements(text, candidates, context, vehicleApplicability) {
    const representedText = [
        text,
        ...(context?.presentProcedures ?? []),
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
    const representedMatches = (0, procedureEquivalence_1.findProcedureMatches)(representedText);
    const representedOperations = (0, estimateOperationEquivalence_1.analyzeEstimateOperations)(representedText);
    const requiredProcedureMatches = (0, procedureEquivalence_1.findProcedureMatches)([...(context?.requiredProcedures ?? []), ...(context?.missingProcedures ?? [])]
        .filter(Boolean)
        .join("\n"));
    const requiredProcedureText = [
        ...(context?.requiredProcedures ?? []),
        ...(context?.missingProcedures ?? []),
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
    const hasCavityWaxCoverage = representedText.includes("cavity wax") || representedText.includes("corrosion protection");
    const hasPreScanCoverage = representedText.includes("pre-repair scan") ||
        representedText.includes("pre repair scan") ||
        representedText.includes("pre-scan");
    const hasInProcessScanCoverage = representedText.includes("in-process repair scan") ||
        representedText.includes("in process repair scan") ||
        representedText.includes("in-process scan") ||
        representedText.includes("in process scan");
    const hasPostScanCoverage = representedText.includes("post-repair scan") ||
        representedText.includes("post repair scan") ||
        representedText.includes("post-scan") ||
        representedText.includes("final scan");
    const functionMap = {
        "pre-repair scan": [
            "pre-repair scan",
            "pre repair scan",
            "pre-scan",
            "diagnostic scan",
        ],
        "post-repair scan": [
            "post-repair scan",
            "post repair scan",
            "post scan",
            "final scan",
            "vehicle diagnostics",
        ],
        calibration: [
            "calibration",
            "adas report",
            "blind spot",
            "parking sensor",
            "parking assist",
            "radar",
        ],
    };
    return candidates.filter((item) => {
        const vehicleScopedText = `${item.title} ${item.reason}`;
        if (!(0, vehicleApplicability_1.isVehicleContentApplicable)(vehicleScopedText, vehicleApplicability)) {
            return false;
        }
        const title = normalizeSupplementTitle(item.title).toLowerCase();
        const canonicalKey = inferCanonicalProcedureKey(title);
        const adasProcedure = canonicalKey
            ? isAdasProcedure(canonicalKey)
            : looksLikeAdasSupplementTitle(title);
        const scanProcedure = looksLikeScanSupplementTitle(title);
        const corrosionProtectionOnly = title.includes("corrosion") && !title.includes("seam") && !title.includes("weld");
        const proactiveOem = item.sourceType === "proactive_oem";
        const clearlyRepresented = isClearlyRepresentedEstimateImprovement(title, representedText);
        if (title.includes("headlamp") &&
            title.includes("aim") &&
            (representedOperations.headlamp_aim || representedOperations.fog_lamp_aim)) {
            return false;
        }
        if (title.includes("alignment") && representedOperations.alignment) {
            return false;
        }
        if (canonicalKey &&
            representedMatches.some((match) => match.key === canonicalKey) &&
            (!proactiveOem || clearlyRepresented)) {
            return false;
        }
        if (((title.includes("pre-repair scan") && hasPreScanCoverage) ||
            (title.includes("in-process") && hasInProcessScanCoverage) ||
            (title.includes("post-repair scan") && hasPostScanCoverage)) &&
            (!proactiveOem || clearlyRepresented)) {
            return false;
        }
        if (corrosionProtectionOnly && hasCavityWaxCoverage && (!proactiveOem || clearlyRepresented)) {
            return false;
        }
        for (const [functionName, keywords] of Object.entries(functionMap)) {
            if (title.includes(functionName) &&
                hasFunction(representedText, keywords) &&
                (!proactiveOem || clearlyRepresented)) {
                return false;
            }
        }
        if (scanProcedure &&
            !proactiveOem &&
            !isProcedureRequired(canonicalKey, title, requiredProcedureText, requiredProcedureMatches)) {
            return false;
        }
        if (adasProcedure &&
            !proactiveOem &&
            !isProcedureRequired(canonicalKey, title, requiredProcedureText, requiredProcedureMatches)) {
            return false;
        }
        if (proactiveOem && clearlyRepresented) {
            return false;
        }
        return true;
    });
}
function inferCategory(title) {
    const lower = normalizeSupplementTitle(title).toLowerCase();
    if (lower.includes("scan"))
        return "scan";
    if (lower.includes("calibration"))
        return "calibration";
    if (lower.includes("refinish"))
        return "refinish";
    if (lower.includes("seam") ||
        lower.includes("corrosion") ||
        lower.includes("hardware") ||
        lower.includes("clip") ||
        lower.includes("fastener")) {
        return "material";
    }
    if (lower.includes("measure") ||
        lower.includes("realignment") ||
        lower.includes("setup") ||
        lower.includes("aperture") ||
        lower.includes("door shell") ||
        lower.includes("roof rail") ||
        lower.includes("side structure") ||
        lower.includes("tie bar") ||
        lower.includes("lock support") ||
        lower.includes("core support") ||
        lower.includes("upper rail") ||
        lower.includes("deck opening") ||
        lower.includes("rear body")) {
        return "structural";
    }
    return "labor";
}
function buildSupplementLinesHybrid(validatedItems, evidenceText = "", vehicleApplicability) {
    const seen = new Set();
    return curateSupplementCandidates(validatedItems, evidenceText, vehicleApplicability)
        .map((item) => ({
        title: normalizeSupplementTitle(item.title),
        category: inferCategory(item.title),
        rationale: item.reason,
    }))
        .filter((item) => {
        const key = item.title.toLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
function normalizeSupplementTitle(title) {
    const normalized = title.replace(/\s+/g, " ").trim();
    const lower = normalized.toLowerCase();
    if (lower.includes("kafas")) {
        return "Forward Camera Calibration";
    }
    if (lower.includes("one-time-use") ||
        lower.includes("one time use") ||
        lower.includes("fastener") ||
        /\bclip(s)?\b/i.test(lower) ||
        /\bseal(s)?\b/i.test(lower) ||
        /\bretainer(s)?\b/i.test(lower)) {
        return "One-Time-Use Hardware / Seals / Clips";
    }
    if (lower.includes("test-fit") ||
        lower.includes("test fit") ||
        lower.includes("fit-check") ||
        lower.includes("fit check") ||
        lower.includes("mock-up") ||
        lower.includes("mock up") ||
        lower.includes("fit-sensitive") ||
        lower.includes("fit verification") ||
        lower.includes("gap confirmation") ||
        lower.includes("aim confirmation")) {
        return "Pre-Paint Test Fit";
    }
    if (lower.includes("cavity wax") || lower.includes("seam sealer") || lower.includes("corrosion-protection")) {
        return "Corrosion Protection / Weld Restoration";
    }
    if (lower.includes("weld-prep") || lower.includes("weld prep") || lower.includes("weld-protection") || lower.includes("weld protection")) {
        return "Corrosion Protection / Weld Restoration";
    }
    if (hasDirectAlignmentSignal(lower)) {
        return "Four-Wheel Alignment";
    }
    if (lower.includes("aperture") ||
        lower.includes("door shell") ||
        lower.includes("roof rail") ||
        lower.includes("side structure") ||
        lower.includes("side-impact sensor") ||
        lower.includes("side impact sensor")) {
        return "Side Structure / Aperture / Door-Shell Fit Verification";
    }
    if (lower.includes("adas") ||
        lower.includes("calibration") ||
        lower.includes("camera") ||
        lower.includes("radar") ||
        lower.includes("sensor")) {
        return "ADAS / Calibration Procedure Support";
    }
    return normalized;
}
function curateSupplementCandidates(candidates, text, vehicleApplicability) {
    if (candidates.length <= 1)
        return candidates;
    let storyText = "";
    if (text.trim()) {
        try {
            const story = (0, buildRepairStory_1.buildRepairStory)(text);
            storyText = [story.impact, ...story.zones, ...story.panels].join(" ");
        }
        catch {
            storyText = "";
        }
    }
    const evidenceText = `${text}\n${storyText}`.toLowerCase();
    const impactZone = (0, impactZone_1.deriveImpactZone)({ text: evidenceText });
    const hasFrontSupportOperations = (0, impactZone_1.hasFrontSupportZoneEvidence)(evidenceText);
    const hasRadiatorSupport = /\b(?:radiator support|core support|lock support)\b/.test(evidenceText);
    const hasTieBar = /\btie bar\b/.test(evidenceText);
    const hasApron = /\bapron\b/.test(evidenceText);
    const hasUpperRail = /\bupper rail\b/.test(evidenceText);
    const hasLowerRail = /\blower rail\b/.test(evidenceText);
    const allowHiddenMountingGeometry = impactZone.primary === "front" ||
        hasFrontSupportOperations ||
        hasRadiatorSupport ||
        hasTieBar ||
        hasApron ||
        hasUpperRail ||
        hasLowerRail;
    const resolvedVehicleApplicability = vehicleApplicability ??
        (0, vehicleApplicability_1.resolveVehicleApplicabilityContext)(extractVehicleIdentityFromSupplementText(text));
    const normalized = candidates.map((item) => ({
        ...item,
        title: normalizeSupplementTitle(item.title),
        reason: (0, vehicleApplicability_1.sanitizeVehicleSpecificText)(item.reason, resolvedVehicleApplicability),
    }));
    const frontSpecificExists = normalized.some((item) => inferSupplementConceptFamily(item.title) === "front_structure_scope" &&
        !isGenericSupplementTitle(item.title));
    const rearSpecificExists = normalized.some((item) => inferSupplementConceptFamily(item.title) === "rear_structure_scope" &&
        !isGenericSupplementTitle(item.title));
    const filtered = normalized
        .filter((item) => {
        if (!(0, vehicleApplicability_1.isVehicleContentApplicable)(`${item.title} ${item.reason}`, resolvedVehicleApplicability) ||
            !item.reason.trim()) {
            return false;
        }
        const title = item.title;
        if (title === "Four-Wheel Alignment" && !hasAlignmentEvidence(evidenceText)) {
            return false;
        }
        if (title === "One-Time-Use Hardware / Seals / Clips" &&
            !hasHardwareEvidence(`${evidenceText} ${item.reason}`)) {
            return false;
        }
        if (title === "Pre-Paint Test Fit" &&
            (!hasExplicitFitCheckEvidence(`${evidenceText} ${item.reason}`) ||
                !hasFrontEndOrFitSensitiveEvidence(`${evidenceText} ${item.reason}`))) {
            return false;
        }
        if (title === "ADAS / Calibration Procedure Support" &&
            !hasAdasProcedureEvidence(`${evidenceText} ${item.reason}`)) {
            return false;
        }
        if (title === "Structural Measurement Verification" &&
            !hasMeasurementEvidence(evidenceText) &&
            (frontSpecificExists || rearSpecificExists)) {
            return false;
        }
        if (title === "Hidden Mounting Geometry / Teardown Growth" &&
            (!allowHiddenMountingGeometry || !hasHiddenMountingEvidence(evidenceText))) {
            return false;
        }
        return true;
    })
        .sort((left, right) => scoreCuratedSupplementCandidate(right, evidenceText) - scoreCuratedSupplementCandidate(left, evidenceText));
    const kept = [];
    const seenFamilies = new Set();
    let genericFallbacks = 0;
    for (const item of filtered) {
        const family = inferSupplementConceptFamily(item.title);
        const generic = isGenericSupplementTitle(item.title);
        const explicitlySupportedGeneric = generic &&
            ((family === "hardware" && hasHardwareEvidence(item.reason)) ||
                (family === "fit_verification" && hasExplicitFitCheckEvidence(item.reason)));
        if (generic && !explicitlySupportedGeneric && genericFallbacks >= 1) {
            continue;
        }
        if (generic && seenFamilies.has(family)) {
            continue;
        }
        kept.push(item);
        if (family !== "other") {
            seenFamilies.add(family);
        }
        if (generic && !explicitlySupportedGeneric) {
            genericFallbacks += 1;
        }
    }
    return kept;
}
function extractSupplementVehicleApplicability(result) {
    if (Array.isArray(result)) {
        return (0, vehicleApplicability_1.resolveVehicleApplicabilityContext)(extractVehicleIdentityFromSupplementText(result.map((finding) => `${finding.title} ${finding.detail}`).join("\n")));
    }
    if ("findings" in result) {
        return (0, vehicleApplicability_1.resolveVehicleApplicabilityContext)(result.vehicle);
    }
    return (0, vehicleApplicability_1.resolveVehicleApplicabilityContext)(result.vehicle, result.analysis?.vehicle);
}
function extractVehicleIdentityFromSupplementText(text) {
    const lower = text.toLowerCase();
    if (/\bbmw\b|\bxdrive\b|\bkafas\b/.test(lower)) {
        return { make: "BMW" };
    }
    if (/\bvolvo\b|\bxc40\b|\bxc60\b|\bxc90\b/.test(lower)) {
        return { make: "Volvo" };
    }
    if (/\bnissan\b|\bsentra\b|\baltima\b|\brogue\b/.test(lower)) {
        return { make: "Nissan" };
    }
    if (/\bchevrolet\b|\bchevy\b|\bsilverado\b|\bequinox\b/.test(lower)) {
        return { make: "Chevrolet", manufacturer: "General Motors" };
    }
    return null;
}
function inferSupplementConceptFamily(title) {
    const lower = normalizeSupplementTitle(title).toLowerCase();
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
        lower.includes("bumper absorber") ||
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
    if (lower.includes("scan") ||
        lower.includes("calibration") ||
        lower.includes("sensor") ||
        lower.includes("aim")) {
        return "verification";
    }
    if (lower.includes("corrosion") || lower.includes("seam") || lower.includes("weld")) {
        return "corrosion";
    }
    return "other";
}
function isGenericSupplementTitle(title) {
    return [
        "Four-Wheel Alignment",
        "One-Time-Use Hardware / Seals / Clips",
        "Structural Measurement Verification",
        "Hidden Mounting Geometry / Teardown Growth",
    ].includes(normalizeSupplementTitle(title));
}
function scoreCuratedSupplementCandidate(item, evidenceText = "") {
    const lower = `${item.title} ${item.reason}`.toLowerCase();
    let score = item.reason.length;
    if (item.supportState === "missing")
        score += 70;
    if (item.supportState === "partial")
        score += 40;
    if (lower.includes("front structure") || lower.includes("tie bar") || lower.includes("lock support"))
        score += 80;
    if (lower.includes("aperture") || lower.includes("door shell") || lower.includes("roof rail") || lower.includes("side structure"))
        score += 85;
    if (lower.includes("rear body") || lower.includes("deck opening") || lower.includes("bumper reinforcement"))
        score += 80;
    if (lower.includes("test fit") || lower.includes("fit-sensitive"))
        score += 20;
    if (lower.includes("sensor") || lower.includes("radar") || lower.includes("calibration"))
        score += 45;
    if (isGenericSupplementTitle(item.title))
        score -= 40;
    if (item.title === "Pre-Paint Test Fit") {
        if (!hasMajorFitStackUpEvidence(`${evidenceText} ${lower}`))
            score -= 100;
        if (isLightFrontBumperDrivenFile(evidenceText))
            score -= 120;
    }
    if (item.title === "Hidden Mounting Geometry / Teardown Growth" && isLightFrontBumperDrivenFile(evidenceText)) {
        score -= 160;
    }
    if (item.title === "Hidden Mounting Geometry / Teardown Growth") {
        const impactZone = (0, impactZone_1.deriveImpactZone)({ text: evidenceText });
        const hasFrontSupportOperations = (0, impactZone_1.hasFrontSupportZoneEvidence)(evidenceText);
        const hasRadiatorSupport = /\b(?:radiator support|core support|lock support)\b/.test(evidenceText);
        const hasTieBar = /\btie bar\b/.test(evidenceText);
        const hasApron = /\bapron\b/.test(evidenceText);
        const hasUpperRail = /\bupper rail\b/.test(evidenceText);
        const hasLowerRail = /\blower rail\b/.test(evidenceText);
        const allowHiddenMountingGeometry = impactZone.primary === "front" ||
            hasFrontSupportOperations ||
            hasRadiatorSupport ||
            hasTieBar ||
            hasApron ||
            hasUpperRail ||
            hasLowerRail;
        if (!allowHiddenMountingGeometry) {
            score -= 220;
        }
    }
    if (item.title === "ADAS / Calibration Procedure Support") {
        if (!hasAdasProcedureEvidence(evidenceText))
            score -= 160;
        if (/\b(?:camera|sensor|scan|calibration|park sensor|front camera)\b/.test(evidenceText))
            score += 45;
    }
    return score;
}
function hasDirectAlignmentSignal(value) {
    return (value.includes("four-wheel alignment") ||
        value.includes("4-wheel alignment") ||
        value.includes("4 wheel alignment") ||
        value.includes("wheel alignment") ||
        value.includes("toe") ||
        value.includes("camber") ||
        value.includes("caster"));
}
function hasAlignmentEvidence(value) {
    return (hasDirectAlignmentSignal(value) ||
        value.includes("suspension") ||
        value.includes("steering") ||
        value.includes("subframe"));
}
function hasHardwareEvidence(value) {
    return (value.includes("one-time-use") ||
        value.includes("one time use") ||
        value.includes("hardware") ||
        value.includes("fastener") ||
        value.includes("retainer") ||
        /\bclip(s)?\b/i.test(value) ||
        /\bseal(s)?\b/i.test(value));
}
function hasMeasurementEvidence(value) {
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
function hasAdasProcedureEvidence(value) {
    const lower = value.toLowerCase();
    const hasAdasSubject = lower.includes("adas") ||
        lower.includes("calibration") ||
        lower.includes("camera") ||
        lower.includes("radar") ||
        lower.includes("sensor") ||
        lower.includes("scan");
    const hasProcedureContext = lower.includes("procedure") ||
        lower.includes("calibrate") ||
        lower.includes("calibration") ||
        lower.includes("scan") ||
        lower.includes("verification") ||
        lower.includes("aim");
    return hasAdasSubject && hasProcedureContext;
}
function hasExplicitFitCheckEvidence(value) {
    return (/test-?fit/.test(value) ||
        /fit-?check/.test(value) ||
        /mock-?up/.test(value) ||
        /fit verification/.test(value) ||
        /gap confirmation/.test(value) ||
        /aim confirmation/.test(value));
}
function hasFrontEndOrFitSensitiveEvidence(value) {
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
function hasSupportScopeEvidence(value) {
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
function hasHiddenMountingEvidence(value) {
    return (hasSupportScopeEvidence(value) ||
        value.includes("reinforcement") ||
        value.includes("absorber") ||
        value.includes("shutter") ||
        value.includes("duct") ||
        value.includes("ducting") ||
        value.includes("hidden bracket") ||
        value.includes("mounting disturbance") ||
        value.includes("mounting geometry") ||
        value.includes("teardown"));
}
function isLightFrontBumperDrivenFile(value) {
    const lower = value.toLowerCase();
    const hasLightSignals = lower.includes("bumper") ||
        lower.includes("fascia") ||
        lower.includes("trim") ||
        lower.includes("sensor") ||
        lower.includes("scan");
    const lacksHeavySignals = !hasHiddenMountingEvidence(lower) &&
        !hasMeasurementEvidence(lower) &&
        !lower.includes("structure") &&
        !lower.includes("rail") &&
        !lower.includes("apron");
    return hasLightSignals && lacksHeavySignals;
}
function hasVerifiedStructuralZoneEvidence(value) {
    return (/\b(?:rail|apron)\b.{0,40}\b(?:measure|measurement|measuring|setup|pull|realign|datum|geometry|dimension)\b/.test(value) ||
        /\b(?:measure|measurement|measuring|setup|pull|realign|datum|geometry|dimension)\b.{0,40}\b(?:rail|apron)\b/.test(value));
}
function hasFunction(text, keywords) {
    const lower = text.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
}
function inferCanonicalProcedureKey(title) {
    const normalizedTitle = title.toLowerCase();
    for (const procedure of procedureEquivalence_1.CANONICAL_PROCEDURES) {
        if (procedure.label.toLowerCase() === normalizedTitle ||
            procedure.aliases.some((alias) => alias.toLowerCase() === normalizedTitle) ||
            procedure.aliases.some((alias) => normalizedTitle.includes(alias.toLowerCase())) ||
            normalizedTitle.includes(procedure.label.toLowerCase())) {
            return procedure.key;
        }
    }
    return null;
}
function isAdasProcedure(key) {
    return (key.includes("camera") ||
        key.includes("radar") ||
        key === "lane_change_calibration" ||
        key === "lane_departure_calibration" ||
        key === "steering_angle_calibration" ||
        key === "adas_report");
}
function looksLikeAdasSupplementTitle(title) {
    return (title.includes("camera") ||
        title.includes("radar") ||
        title.includes("adas") ||
        title.includes("blind spot") ||
        title.includes("lane") ||
        title.includes("steering angle") ||
        title.includes("calibration"));
}
function looksLikeScanSupplementTitle(title) {
    return title.includes("scan");
}
function isProcedureRequired(canonicalKey, title, requiredProcedureText, requiredProcedureMatches) {
    if (canonicalKey) {
        return requiredProcedureMatches.some((match) => match.key === canonicalKey);
    }
    return procedureEquivalence_1.CANONICAL_PROCEDURES.some((procedure) => {
        if (!isAdasProcedure(procedure.key))
            return false;
        return (requiredProcedureText.includes(procedure.label.toLowerCase()) &&
            (title.includes(procedure.label.toLowerCase()) ||
                procedure.aliases.some((alias) => title.includes(alias.toLowerCase()) ||
                    alias.toLowerCase().includes(title))));
    });
}
function extractValidationContext(result) {
    if (Array.isArray(result)) {
        return undefined;
    }
    if ("findings" in result) {
        return {
            requiredProcedures: result.findings
                .filter((finding) => finding.status !== "present")
                .map((finding) => finding.title),
            presentProcedures: result.findings
                .filter((finding) => finding.status === "present")
                .map((finding) => finding.title),
            missingProcedures: result.supplements.map((finding) => finding.title),
        };
    }
    return {
        requiredProcedures: result.requiredProcedures.map((procedure) => procedure.procedure),
        presentProcedures: result.presentProcedures,
        missingProcedures: result.missingProcedures,
    };
}
function extractSupplementCandidates(result) {
    if (Array.isArray(result)) {
        return result
            .filter((finding) => finding.status !== "present")
            .map((finding) => ({
            title: normalizeSupplementTitle(finding.title),
            reason: finding.detail,
            sourceType: "support_gap",
            supportState: "partial",
        }));
    }
    if ("findings" in result) {
        return [
            ...result.supplements.map((finding) => ({
                title: normalizeSupplementTitle(finding.title),
                reason: finding.detail,
                sourceType: "support_gap",
                supportState: "partial",
            })),
            ...result.findings
                .filter((finding) => finding.status !== "present")
                .map((finding) => ({
                title: normalizeSupplementTitle(finding.title),
                reason: finding.detail,
                sourceType: "support_gap",
                supportState: "partial",
            })),
        ];
    }
    return [
        ...result.missingProcedures.map((procedure) => ({
            title: normalizeSupplementTitle(procedure),
            reason: "This procedure is not clearly represented in the current estimate.",
            sourceType: "missing",
            supportState: "missing",
        })),
        ...result.supplementOpportunities.map((item) => classifySupplementOpportunity(item)),
        ...result.requiredProcedures
            .filter((procedure) => !result.presentProcedures.some((present) => normalizeSupplementTitle(present).toLowerCase() === normalizeSupplementTitle(procedure.procedure).toLowerCase()))
            .map((procedure) => ({
            title: normalizeSupplementTitle(procedure.procedure),
            reason: procedure.reason,
            sourceType: "missing",
            supportState: "missing",
        })),
        ...result.issues
            .filter((issue) => issue.missingOperation || issue.category === "calibration" || issue.category === "scan")
            .map((issue) => ({
            title: normalizeSupplementTitle(issue.missingOperation ?? issue.title),
            reason: issue.impact || issue.finding,
            sourceType: issue.missingOperation ? "missing" : "support_gap",
            supportState: issue.missingOperation ? "missing" : "partial",
        })),
    ];
}
function classifySupplementOpportunity(item) {
    const normalizedTitle = normalizeSupplementTitle(item);
    const proactiveOem = /\boem support in\b/i.test(item) || /\bposition statement\b/i.test(item);
    const partialSupport = /\bbetter documented\b/i.test(item) ||
        /\bcarried or documented\b/i.test(item) ||
        /\breflected if\b/i.test(item) ||
        /\bmay still need\b/i.test(item) ||
        /\bremains open\b/i.test(item);
    return {
        title: normalizedTitle,
        reason: item,
        sourceType: proactiveOem ? "proactive_oem" : "support_gap",
        supportState: proactiveOem ? (partialSupport ? "partial" : "proactive") : "partial",
    };
}
function isClearlyRepresentedEstimateImprovement(title, representedText) {
    if (!representedText.trim())
        return false;
    if (title.includes("one-time-use hardware") ||
        title.includes("seal") ||
        title.includes("clip")) {
        return hasFunction(representedText, [
            "replace hardware",
            "replaced hardware",
            "one-time-use",
            "one time use",
            "non-reusable",
            "new clips",
            "new seals",
            "new fasteners",
        ]);
    }
    if (title.includes("corrosion protection") || title.includes("weld restoration")) {
        return hasFunction(representedText, [
            "corrosion protection",
            "cavity wax",
            "seam sealer",
            "anti-corrosion",
            "weld protection",
            "weld-through primer",
            "weld thru primer",
            "refinish protection",
        ]);
    }
    if (title.includes("pre-paint test fit")) {
        return hasFunction(representedText, [
            "pre-paint test fit",
            "pre paint test fit",
            "fit-check",
            "fit check",
            "mock-up",
            "mock up",
            "fit verification",
            "gap confirmation",
            "aim confirmation",
            "pre-finish fit confirmation",
        ]);
    }
    if (title.includes("alignment")) {
        return hasFunction(representedText, [
            "four-wheel alignment",
            "4-wheel alignment",
            "4 wheel alignment",
            "alignment check",
            "wheel alignment",
        ]);
    }
    if (title.includes("adas") || title.includes("calibration")) {
        return (hasFunction(representedText, ["calibration", "adas"]) &&
            hasFunction(representedText, ["scan", "verification", "aim", "alignment", "documentation"]));
    }
    if (/refinish|blend|mask|tint|let-?down|polish|sand/.test(title)) {
        return hasFunction(representedText, [
            "refinish",
            "blend",
            "masking",
            "tint",
            "let-down",
            "let down",
            "polish",
            "color sand",
        ]);
    }
    return false;
}

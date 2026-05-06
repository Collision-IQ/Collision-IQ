"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRepairStory = buildRepairStory;
exports.buildRepairNarrative = buildRepairNarrative;
const estimateParser_1 = require("../estimateParser");
const estimateExtractor_1 = require("../extractors/estimateExtractor");
const impactZone_1 = require("../impactZone");
function buildRepairStory(estimateText) {
    const lower = estimateText.toLowerCase();
    const detailedEstimate = (0, estimateParser_1.parseEstimate)(estimateText);
    const structuredEstimate = (0, estimateExtractor_1.parseEstimate)(estimateText);
    const panels = collectPanels(detailedEstimate.operations);
    const impactZone = (0, impactZone_1.deriveImpactZone)({ text: estimateText });
    const zones = collectZones(lower, panels, impactZone);
    const replacedPanels = collectPanelsByOperation(detailedEstimate.operations, ["Repl"]);
    const repairedPanels = collectPanelsByOperation(detailedEstimate.operations, ["Rpr"]);
    const operations = {
        repairDominant: repairedPanels.length >= replacedPanels.length,
        repairedParts: repairedPanels,
        replacedParts: replacedPanels,
    };
    const structural = lower.includes("alu") ||
        lower.includes("structural") ||
        lower.includes("door shell") ||
        includesAny(lower, ["rail", "apron", "pillar", "core support", "reinforcement"]);
    const impact = determineImpact(lower, zones, impactZone);
    return {
        impact,
        impactZone,
        zones,
        panels,
        replacedPanels,
        repairedPanels,
        operations,
        repairCharacter: classifyRepairCharacter({
            structural,
            operations,
        }),
        structural,
        complexity: classifyComplexity({ zones, panels, structural }),
        laborStructure: {
            bodyHours: structuredEstimate.bodyHours,
            paintHours: structuredEstimate.paintHours,
            mix: buildLaborMix(detailedEstimate.operations),
        },
    };
}
function buildRepairNarrative(story) {
    const parts = [];
    if (story.operations.repairDominant) {
        parts.push("This estimate is built around a repair-first approach rather than part replacement.");
    }
    else {
        parts.push("This estimate leans more toward part replacement than repair.");
    }
    if (story.zones.length > 0) {
        parts.push(`The work is concentrated in the ${story.zones.join(", ")}.`);
    }
    if (story.panels.length >= 3) {
        parts.push("The repair spans multiple panels, suggesting the impact carried beyond a single isolated component.");
    }
    parts.push(`Overall, this reads as a ${story.repairCharacter} repair.`);
    return parts.join(" ");
}
function collectPanels(operations) {
    const panels = operations
        .map((operation) => normalizePanelName(operation.component))
        .filter(Boolean);
    return [...new Set(panels)];
}
function collectPanelsByOperation(operations, operationTypes) {
    const panels = operations
        .filter((operation) => operationTypes.includes(operation.operation))
        .map((operation) => normalizePanelName(operation.component))
        .filter(Boolean);
    return [...new Set(panels)];
}
function normalizePanelName(component) {
    const lower = component.toLowerCase();
    const dictionary = [
        [/\bfront bumper\b|\bbumper cover\b/, "front bumper"],
        [/\brear bumper\b/, "rear bumper"],
        [/\bgrille\b/, "grille"],
        [/\bhood\b/, "hood"],
        [/\bfender\b/, "fender"],
        [/\bdoor shell\b|\bfront door\b|\brear door\b|\bdoor\b/, "door"],
        [/\bquarter\b|\bquarter panel\b/, "quarter panel"],
        [/\bapron\b/, "apron"],
        [/\brail\b/, "rail"],
        [/\bcore support\b|\bradiator support\b/, "radiator support"],
        [/\bpillar\b/, "pillar"],
        [/\bheadlamp\b|\bheadlight\b/, "headlamp"],
        [/\bmirror\b/, "mirror"],
        [/\bdecklid\b|\btrunk\b/, "decklid"],
    ];
    for (const [pattern, label] of dictionary) {
        if (pattern.test(lower)) {
            return label;
        }
    }
    return component.replace(/\s+/g, " ").trim().toLowerCase();
}
function collectZones(lower, panels, impactZone) {
    const zones = new Set();
    if (includesAny(lower, [
        "front bumper",
        "grille",
        "hood",
        "headlamp",
        "radiator support",
        "core support",
        "fender",
    ]) ||
        panels.some((panel) => includesAny(panel, [
            "front bumper",
            "grille",
            "hood",
            "headlamp",
            "radiator support",
            "fender",
        ]))) {
        zones.add("front-end");
    }
    if ((0, impactZone_1.isSideImpactZone)(impactZone) && !(0, impactZone_1.hasFrontSupportZoneEvidence)(lower)) {
        zones.delete("front-end");
    }
    if (includesAny(lower, ["door", "pillar", "rocker", "apron"]) ||
        panels.some((panel) => includesAny(panel, ["door", "pillar", "apron"]))) {
        zones.add("side structure");
    }
    if (includesAny(lower, ["quarter", "rear bumper", "decklid", "tail lamp"]) ||
        panels.some((panel) => includesAny(panel, ["quarter panel", "rear bumper", "decklid"]))) {
        zones.add("rear body");
    }
    return [...zones];
}
function determineImpact(lower, zones, impactZone) {
    if (impactZone.primary !== "unspecified" && impactZone.confidence !== "low") {
        return (0, impactZone_1.formatImpactZone)(impactZone);
    }
    if (/\bpoint\s+of\s+impact\s*:?\s*0?1\s+right\s+front\b/i.test(lower)) {
        return "right front";
    }
    if (/\bpoint\s+of\s+impact\s*:?\s*0?1\s+left\s+front\b/i.test(lower)) {
        return "left front";
    }
    if (/\b(right front|front right|rf|right headlamp|right fender|passenger side front)\b/i.test(lower)) {
        return "right front";
    }
    if (/\b(left front|front left|lf|left headlamp|left fender|driver side front)\b/i.test(lower)) {
        return "left front";
    }
    if (zones.includes("front-end")) {
        return "front";
    }
    if (includesAny(lower, ["right rear"])) {
        return "right rear";
    }
    if (includesAny(lower, ["left rear"])) {
        return "left rear";
    }
    if (zones.includes("side structure")) {
        return "side";
    }
    if (zones.includes("rear body")) {
        return "rear";
    }
    return "general";
}
function classifyRepairCharacter(params) {
    if (params.structural) {
        return "structural repair";
    }
    if (params.operations.repairDominant) {
        return "repair-dominant cosmetic";
    }
    return "parts replacement oriented";
}
function classifyComplexity(params) {
    if (params.structural || params.zones.length >= 2 || params.panels.length >= 5) {
        return "multi-zone repair";
    }
    if (params.panels.length >= 3) {
        return "moderate scope repair";
    }
    return "localized repair";
}
function buildLaborMix(operations) {
    return operations.reduce((mix, operation) => {
        const op = operation.operation.toLowerCase();
        if (op === "repl")
            mix.replace += 1;
        else if (op === "rpr")
            mix.repair += 1;
        else if (op === "r&i")
            mix.removeInstall += 1;
        else if (op === "blnd")
            mix.refinish += 1;
        else if (op === "cal" || op === "scan")
            mix.scanCalibration += 1;
        else
            mix.procedures += 1;
        return mix;
    }, {
        replace: 0,
        repair: 0,
        removeInstall: 0,
        refinish: 0,
        scanCalibration: 0,
        procedures: 0,
    });
}
function includesAny(text, values) {
    return values.some((value) => text.includes(value));
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapSupplementLines = mapSupplementLines;
function mapSupplementLines(lines, platform = "generic") {
    return lines.map((line) => ({
        label: mapLabel(line, platform),
        note: line.rationale,
        category: line.category,
    }));
}
function mapLabel(line, platform) {
    const lower = line.title.toLowerCase();
    if (line.category === "scan") {
        if (platform === "ccc")
            return "Pre/Post Repair Diagnostic Scan";
        if (platform === "mitchell")
            return "Diagnostic Scan / Clear Codes";
        return "Diagnostic Scan";
    }
    if (line.category === "calibration") {
        if (includesAny(lower, ["radar", "acc"])) {
            return platform === "mitchell"
                ? "Adaptive Cruise Control / Radar Calibration"
                : "Radar Calibration";
        }
        if (includesAny(lower, ["camera", "kafas"])) {
            return platform === "mitchell"
                ? "Forward Facing Camera Calibration"
                : "Camera Calibration";
        }
        if (includesAny(lower, ["steering"])) {
            return "Steering Angle Sensor Calibration";
        }
        return "System Calibration";
    }
    if (line.category === "material") {
        if (includesAny(lower, ["cavity", "corrosion"])) {
            return "Cavity Wax / Corrosion Protection";
        }
        if (includesAny(lower, ["seam"])) {
            return "Seam Sealer Application";
        }
        return "Required Materials";
    }
    if (line.category === "refinish") {
        if (includesAny(lower, ["blend"])) {
            return "Blend Adjacent Panel";
        }
        if (includesAny(lower, ["polish", "sand"])) {
            return "Finish Sand and Polish";
        }
        if (includesAny(lower, ["tint"])) {
            return "Tint / Color Adjustment";
        }
        return "Refinish Operation";
    }
    if (line.category === "structural") {
        return "Structural Repair / Measurement / Verification";
    }
    return normalize(line.title);
}
function includesAny(text, values) {
    return values.some((v) => text.includes(v));
}
function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
}

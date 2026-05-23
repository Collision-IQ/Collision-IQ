"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeVehicleForLog = summarizeVehicleForLog;
exports.summarizeVehicleLabelForLog = summarizeVehicleLabelForLog;
exports.summarizeTextForLog = summarizeTextForLog;
exports.summarizeTextMetadataForLog = summarizeTextMetadataForLog;
exports.summarizeParsedVehicleLineForLog = summarizeParsedVehicleLineForLog;
function summarizeVehicleForLog(vehicle) {
    if (!vehicle)
        return null;
    return {
        year: vehicle.year ?? null,
        make: vehicle.make ?? null,
        model: vehicle.model ?? null,
        trimPresent: Boolean(vehicle.trim),
        manufacturerPresent: Boolean(vehicle.manufacturer),
        vinTail: maskVinTail(vehicle.vin),
        confidence: vehicle.confidence ?? null,
        source: vehicle.source ?? null,
        fieldSourceKeys: vehicle.fieldSources ? Object.keys(vehicle.fieldSources).sort() : [],
        mismatchCount: vehicle.mismatches?.length ?? 0,
    };
}
function summarizeVehicleLabelForLog(value) {
    if (!value)
        return null;
    return redactVinInText(value);
}
function summarizeTextForLog(value, maxLength = 160) {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (!trimmed)
        return null;
    return redactVinInText(trimmed).slice(0, maxLength);
}
function summarizeTextMetadataForLog(value) {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (!trimmed) {
        return {
            present: false,
            length: 0,
            containsVin: false,
        };
    }
    return {
        present: true,
        length: trimmed.length,
        containsVin: /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(trimmed),
    };
}
function summarizeParsedVehicleLineForLog(parsed) {
    if (!parsed)
        return null;
    return {
        year: parsed.year ?? null,
        make: parsed.make ?? null,
        model: parsed.model ?? null,
        trimPresent: Boolean(parsed.trim),
    };
}
function maskVinTail(value) {
    const compact = value?.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
    if (!compact)
        return null;
    return `*****${compact.slice(-4)}`;
}
function redactVinInText(value) {
    return value.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, (vin) => `*****${vin.slice(-4)}`);
}

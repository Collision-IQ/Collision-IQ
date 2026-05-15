type VehicleLogInput = {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  trim?: string;
  manufacturer?: string;
  confidence?: unknown;
  source?: unknown;
  fieldSources?: Record<string, unknown>;
  mismatches?: unknown[];
} | null | undefined;

export function summarizeVehicleForLog(vehicle: VehicleLogInput) {
  if (!vehicle) return null;

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

export function summarizeVehicleLabelForLog(value: string | null | undefined) {
  if (!value) return null;
  return redactVinInText(value);
}

export function summarizeTextForLog(value: string | null | undefined, maxLength = 160) {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return redactVinInText(trimmed).slice(0, maxLength);
}

export function summarizeTextMetadataForLog(value: string | null | undefined) {
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

export function summarizeParsedVehicleLineForLog(
  parsed: { year?: number; make?: string; model?: string; trim?: string } | null | undefined
) {
  if (!parsed) return null;

  return {
    year: parsed.year ?? null,
    make: parsed.make ?? null,
    model: parsed.model ?? null,
    trimPresent: Boolean(parsed.trim),
  };
}

function maskVinTail(value: string | null | undefined) {
  const compact = value?.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
  if (!compact) return null;
  return `*****${compact.slice(-4)}`;
}

function redactVinInText(value: string) {
  return value.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, (vin) => `*****${vin.slice(-4)}`);
}

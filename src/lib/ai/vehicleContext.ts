import type { VehicleIdentity } from "./types/analysis";

export type ResolvedVehicleIdentity = {
  identity?: VehicleIdentity;
  label?: string;
  display: string;
  vehicleDisplay: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  manufacturer?: string;
  confidence: "supported" | "partial" | "unknown";
  sourceConfidence?: number;
  sourceSummary: string[];
  fieldSources?: VehicleIdentity["fieldSources"];
  mismatches?: string[];
};

const KNOWN_MAKES = [
  "Acura",
  "Audi",
  "BMW",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Ford",
  "GMC",
  "Honda",
  "Hyundai",
  "Infiniti",
  "Jeep",
  "Kia",
  "Lexus",
  "Lincoln",
  "Mazda",
  "Mercedes",
  "Mercedes-Benz",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Polestar",
  "Porsche",
  "Ram",
  "Subaru",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
];
const MAKE_ALIASES: Record<string, string> = {
  tesl: "Tesla",
};

const SOURCE_RANK: Record<NonNullable<VehicleIdentity["source"]>, number> = {
  vin_decoded: 6,
  attachment: 5,
  user: 4,
  inferred: 3,
  session: 2,
  unknown: 1,
};
const SOURCE_QUALITY_RANK: Record<NonNullable<VehicleIdentity["sourceQuality"]>, number> = {
  explicit_header: 5,
  labeled_block: 4,
  vin_backed: 3,
  note_context: 1,
  unknown: 0,
};

const VIN_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";
const VIN_ALLOWED = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const INVALID_VIN_VALUES = new Set([
  "UNSPECIFIED",
  "UNKNOWN",
  "NOTAVAILABLE",
  "NOTAPPLICABLE",
  "NODATA",
  "NONE",
  "PENDING",
  "TBD",
  "XXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXX",
  "11111111111111111",
  "99999999999999999",
  "00000000000000000",
]);
const VIN_FIELD_LABELS = ["vin", "vin#", "vehicle identification number"] as const;
const BLACKLISTED_VIN_HEADER_LABELS = [
  "workfile id",
  "federal id",
  "claim #",
  "claim number",
  "claim no",
  "claim id",
  "ro #",
  "ro number",
  "repair order",
  "repair order #",
  "file #",
  "file id",
  "loss #",
  "estimate #",
] as const;
const VIN_PAGE_FURNITURE_PATTERNS = [
  /\bpage\s+\d+\b/i,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{1,2}:\d{2}:\d{2}\b/,
  /\b(?:am|pm)\b/i,
  /\bpage\b/i,
  /\b\d{5,}\b/,
] as const;
const INVALID_VIN_FRAGMENT_PATTERNS = [
  /PAGE/i,
  /\bAM\b/i,
  /\bPM\b/i,
] as const;
const NOISE_PREFIXES = ["PANEL", "PART", "CLAIM", "WORKFILE", "FEDERAL", "POLICY", "PAGE"] as const;
const VEHICLE_NOTE_PATTERNS = [
  "closest like, kind & quality option",
  "closest like kind quality option",
  "closest lkq option",
  "non-database",
  "ccc note",
  "substitute vehicle",
  "modeling note",
] as const;
const VEHICLE_FIELDS = [
  "year",
  "make",
  "model",
  "vin",
  "trim",
  "manufacturer",
  "bodyStyle",
  "series",
] as const;

const WMI_MAP: Record<string, { make: string; manufacturer: string }> = {
  "19U": { make: "Acura", manufacturer: "Honda of America Mfg., Inc." },
  "1HG": { make: "Honda", manufacturer: "Honda of America Mfg., Inc." },
  "1HM": { make: "Honda", manufacturer: "Honda Manufacturing of Alabama, LLC" },
  "1N4": { make: "Nissan", manufacturer: "Nissan North America, Inc." },
  "1FA": { make: "Ford", manufacturer: "Ford Motor Company" },
  "1FD": { make: "Ford", manufacturer: "Ford Motor Company" },
  "1FM": { make: "Ford", manufacturer: "Ford Motor Company" },
  "1FT": { make: "Ford", manufacturer: "Ford Motor Company" },
  "1GC": { make: "Chevrolet", manufacturer: "General Motors LLC" },
  "1G1": { make: "Chevrolet", manufacturer: "General Motors LLC" },
  "1GK": { make: "GMC", manufacturer: "General Motors LLC" },
  "1GY": { make: "Cadillac", manufacturer: "General Motors LLC" },
  "1C4": { make: "Chrysler", manufacturer: "FCA US LLC" },
  "1C6": { make: "Ram", manufacturer: "FCA US LLC" },
  "1D4": { make: "Dodge", manufacturer: "FCA US LLC" },
  "2HG": { make: "Honda", manufacturer: "Honda of Canada Mfg., Inc." },
  "2HK": { make: "Honda", manufacturer: "Honda of Canada Mfg., Inc." },
  "2HJ": { make: "Honda", manufacturer: "Honda of Canada Mfg., Inc." },
  "2HNYD": { make: "Acura", manufacturer: "Honda of Canada Mfg., Inc." },
  "2T3": { make: "Toyota", manufacturer: "Toyota Motor Manufacturing Canada" },
  "2C3": { make: "Chrysler", manufacturer: "FCA Canada Inc." },
  "3FA": { make: "Ford", manufacturer: "Ford Motor Company Mexico" },
  "3GN": { make: "Chevrolet", manufacturer: "General Motors de Mexico" },
  "3VW": { make: "Volkswagen", manufacturer: "Volkswagen de Mexico" },
  "4S3": { make: "Subaru", manufacturer: "Subaru of America, Inc." },
  "4T1": { make: "Toyota", manufacturer: "Toyota Motor Manufacturing Kentucky, Inc." },
  "5FN": { make: "Honda", manufacturer: "Honda Manufacturing of Alabama, LLC" },
  "5J6": { make: "Honda", manufacturer: "Honda Manufacturing of Alabama, LLC" },
  "5J8": { make: "Acura", manufacturer: "Honda Manufacturing of Alabama, LLC" },
  "5LM": { make: "Lincoln", manufacturer: "Ford Motor Company" },
  "5N1": { make: "Nissan", manufacturer: "Nissan Motor Manufacturing USA" },
  "5NP": { make: "Hyundai", manufacturer: "Hyundai Motor Manufacturing Alabama" },
  "5TD": { make: "Toyota", manufacturer: "Toyota Motor Manufacturing Indiana, Inc." },
  "5TF": { make: "Toyota", manufacturer: "Toyota Motor Manufacturing Texas, Inc." },
  "5XY": { make: "Kia", manufacturer: "Kia Georgia, Inc." },
  "7MU": { make: "Toyota", manufacturer: "Toyota Motor Manufacturing" },
  "JA4": { make: "Mitsubishi", manufacturer: "Mitsubishi Motors North America" },
  "JF1": { make: "Subaru", manufacturer: "Subaru Corporation" },
  "JF2": { make: "Subaru", manufacturer: "Subaru Corporation" },
  "JHM": { make: "Honda", manufacturer: "Honda Motor Co., Ltd." },
  "JHL": { make: "Honda", manufacturer: "Honda Motor Co., Ltd." },
  "JM1": { make: "Mazda", manufacturer: "Mazda Motor Corporation" },
  "JN1": { make: "Nissan", manufacturer: "Nissan Motor Co., Ltd." },
  "JT3": { make: "Toyota", manufacturer: "Toyota Motor Corporation" },
  "JTJ": { make: "Lexus", manufacturer: "Toyota Motor Corporation" },
  "KM8": { make: "Hyundai", manufacturer: "Hyundai Motor Company" },
  "KNA": { make: "Kia", manufacturer: "Kia Corporation" },
  "SAL": { make: "Land Rover", manufacturer: "Jaguar Land Rover Limited" },
  "SCB": { make: "Bentley", manufacturer: "Bentley Motors Limited" },
  "TRU": { make: "Audi", manufacturer: "AUDI AG" },
  "VSS": { make: "SEAT", manufacturer: "SEAT, S.A." },
  "WA1": { make: "Audi", manufacturer: "AUDI AG" },
  "WAU": { make: "Audi", manufacturer: "AUDI AG" },
  "WBA": { make: "BMW", manufacturer: "Bayerische Motoren Werke AG" },
  "WBS": { make: "BMW", manufacturer: "Bayerische Motoren Werke AG" },
  "WDD": { make: "Mercedes-Benz", manufacturer: "Mercedes-Benz Group AG" },
  "WDW": { make: "Mercedes-Benz", manufacturer: "Mercedes-Benz Group AG" },
  "WVW": { make: "Volkswagen", manufacturer: "Volkswagen AG" },
  "YV1": { make: "Volvo", manufacturer: "Volvo Car Corporation" },
  "YV4": { make: "Volvo", manufacturer: "Volvo Car Corporation" },
  "ZFF": { make: "Ferrari", manufacturer: "Ferrari S.p.A." },
};

export function extractVehicleIdentityFromText(
  text: string,
  source: VehicleIdentity["source"] = "inferred"
): VehicleIdentity | null {
  if (!text.trim()) {
    return null;
  }

  const normalized = text.replace(/\r/g, "");
  const vin = extractVinFromTextBlock(normalized);
  const bestVehicleLineCandidate = extractBestVehicleLineCandidate(normalized, source);
  const parsedVehicleLine = bestVehicleLineCandidate
    ? {
        year: bestVehicleLineCandidate.year,
        make: bestVehicleLineCandidate.make,
        model: bestVehicleLineCandidate.model,
        trim: bestVehicleLineCandidate.trim,
      }
    : null;

  const year =
    parsedVehicleLine?.year ??
    normalizeYear(extractLabeledValue(normalized, ["year", "yr", "model year"]));
  const make =
    parsedVehicleLine?.make ??
    cleanVehicleToken(extractLabeledValue(normalized, ["make", "mk"]));
  const model =
    parsedVehicleLine?.model ??
    cleanVehicleToken(extractLabeledValue(normalized, ["model", "mdl"]));
  const trim =
    parsedVehicleLine?.trim ??
    cleanVehicleToken(extractLabeledValue(normalized, ["trim", "series", "package"]));

  const supportedCount = [year, make, model, vin, trim].filter(Boolean).length;
  if (supportedCount === 0) {
    return null;
  }

  const statedVehicle: VehicleIdentity = {
    vin,
    year,
    make,
    model,
    trim,
    sourceQuality: bestVehicleLineCandidate?.sourceQuality ?? (vin ? "vin_backed" : "unknown"),
    confidence: inferVehicleConfidence({ year, make, model, vin, trim }),
    source,
    fieldSources: buildFieldSources({
      year,
      make,
      model,
      vin,
      trim,
    }, source),
  };

  return mergeVehicleIdentity(
    statedVehicle,
    vin ? decodeVinVehicleIdentity(vin) : null
  ) ?? statedVehicle;
}

export function mergeVehicleIdentity(
  ...candidates: Array<VehicleIdentity | null | undefined>
): VehicleIdentity | undefined {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeVehicleIdentity(candidate))
    .filter((candidate): candidate is VehicleIdentity => Boolean(candidate));

  if (normalizedCandidates.length === 0) {
    return undefined;
  }

  const merged: VehicleIdentity = {
    confidence: Math.max(...normalizedCandidates.map((candidate) => candidate.confidence ?? 0)),
    source: normalizedCandidates
      .map((candidate) => candidate.source ?? "unknown")
      .sort((left, right) => SOURCE_RANK[right] - SOURCE_RANK[left])[0],
    sourceQuality: [...normalizedCandidates]
      .sort((left, right) => scoreVehicleIdentity(right) - scoreVehicleIdentity(left))[0]
      ?.sourceQuality ?? "unknown",
    fieldSources: {},
    mismatches: [],
  };

  for (const field of VEHICLE_FIELDS) {
    const contenders = normalizedCandidates.filter((candidate) => {
      const value = candidate[field];
      return value !== undefined && value !== null && value !== "";
    });
    if (contenders.length === 0) continue;

    const chosen = chooseVehicleFieldContender(field, contenders);
    const chosenValue = chosen[field];
    if (chosenValue !== undefined) {
      merged[field] = chosenValue as never;
      if (chosen.fieldSources?.[field]) {
        merged.fieldSources![field] = chosen.fieldSources[field];
      } else if (chosen.source) {
        merged.fieldSources![field] = chosen.source;
      }
    }

    const distinctValues = [...new Set(contenders.map((candidate) => stringifyVehicleField(candidate[field])))].filter(Boolean);
    if (distinctValues.length > 1) {
      const alternatives = contenders
        .filter((candidate) => stringifyVehicleField(candidate[field]) !== stringifyVehicleField(chosenValue))
        .map((candidate) => `${stringifyVehicleField(candidate[field])} (${candidate.fieldSources?.[field] ?? candidate.source ?? "unknown"})`);
      merged.mismatches!.push(
        `${field}: kept ${stringifyVehicleField(chosenValue)} (${chosen.fieldSources?.[field] ?? chosen.source ?? "unknown"}); also saw ${alternatives.join(", ")}`
      );
    }
  }

  if (merged.mismatches?.length === 0) {
    delete merged.mismatches;
  }

  return hasSupportedVehicleIdentity(merged) ? merged : merged;
}

export function normalizeVehicleIdentity(
  vehicle: VehicleIdentity | null | undefined
): VehicleIdentity | undefined {
  if (!vehicle) return undefined;

  const normalized: VehicleIdentity = {
    year:
      typeof vehicle.year === "number" && vehicle.year >= 1980 && vehicle.year <= 2035
        ? vehicle.year
        : undefined,
    make: cleanVehicleToken(vehicle.make),
    model: cleanVehicleToken(vehicle.model),
    vin: normalizeVin(vehicle.vin),
    trim: cleanVehicleToken(vehicle.trim),
    manufacturer: cleanVehicleToken(vehicle.manufacturer),
    bodyStyle: cleanVehicleToken(vehicle.bodyStyle),
    series: cleanVehicleToken(vehicle.series),
    sourceQuality: vehicle.sourceQuality ?? "unknown",
    confidence:
      typeof vehicle.confidence === "number"
        ? Number(Math.max(0, Math.min(1, vehicle.confidence)).toFixed(2))
        : undefined,
    source: vehicle.source ?? "unknown",
    fieldSources: normalizeFieldSources(
      vehicle.fieldSources,
      vehicle.source ?? "unknown",
      {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: vehicle.vin,
        trim: vehicle.trim,
        manufacturer: vehicle.manufacturer,
        bodyStyle: vehicle.bodyStyle,
        series: vehicle.series,
      }
    ),
    mismatches: vehicle.mismatches?.filter(Boolean),
  };

  if (!hasAnyVehicleField(normalized)) {
    return undefined;
  }

  if (typeof normalized.confidence !== "number") {
    normalized.confidence = inferVehicleConfidence(normalized);
  }

  return normalized;
}

export function hasSupportedVehicleIdentity(
  vehicle: VehicleIdentity | null | undefined
): boolean {
  const normalized = normalizeVehicleIdentity(vehicle);
  if (!normalized) return false;

  return Boolean(normalized.vin || (normalized.year && normalized.make) || (normalized.make && normalized.model));
}

export function buildVehicleLabel(
  vehicle: VehicleIdentity | null | undefined,
  options?: { includeTrim?: boolean }
): string {
  const normalized = normalizeVehicleIdentity(vehicle);
  if (!normalized) return "";

  const parts = [
    normalized.year,
    normalized.make,
    normalized.model,
    options?.includeTrim ? normalized.trim : undefined,
  ].filter(Boolean);

  return parts.join(" ").trim();
}

export function buildVehicleDisplayString(
  vehicle: VehicleIdentity | null | undefined,
  options?: { includeTrim?: boolean; fallback?: string }
): string {
  const label = buildVehicleLabel(vehicle, options);
  return label || options?.fallback || "Unspecified";
}

export function resolveVehicleIdentity(
  ...candidates: Array<VehicleIdentity | null | undefined>
): ResolvedVehicleIdentity {
  const identity = mergeVehicleIdentity(...candidates);
  const label = buildVehicleLabel(identity) || undefined;
  const display = buildVehicleDisplayString(identity);
  const detailCount = [
    identity?.year,
    identity?.make,
    identity?.model,
    identity?.vin,
    identity?.trim,
  ].filter(Boolean).length;
  const sourceSummary = buildVehicleSourceSummary(identity);

  return {
    identity,
    label,
    display,
    vehicleDisplay: display,
    vin: identity?.vin,
    year: identity?.year,
    make: identity?.make,
    model: identity?.model,
    trim: identity?.trim,
    manufacturer: identity?.manufacturer,
    confidence:
      detailCount >= 3 || Boolean(identity?.vin)
        ? "supported"
        : detailCount >= 2
          ? "partial"
          : "unknown",
    sourceConfidence: identity?.confidence,
    sourceSummary,
    fieldSources: identity?.fieldSources,
    mismatches: identity?.mismatches,
  };
}

function hasAnyVehicleField(vehicle: VehicleIdentity): boolean {
  return Boolean(
    vehicle.year ||
      vehicle.make ||
      vehicle.model ||
      vehicle.vin ||
      vehicle.trim ||
      vehicle.manufacturer ||
      vehicle.bodyStyle ||
      vehicle.series
  );
}

function vehiclePreferenceScore(vehicle: VehicleIdentity): number {
  return (
    (vehicle.confidence ?? 0) +
    SOURCE_RANK[vehicle.source ?? "unknown"] * 0.25 +
    SOURCE_QUALITY_RANK[vehicle.sourceQuality ?? "unknown"] * 1.5
  );
}

function chooseVehicleFieldContender(
  field: (typeof VEHICLE_FIELDS)[number],
  contenders: VehicleIdentity[]
): VehicleIdentity {
  if (field === "vin") {
    return contenders.reduce((best, contender) =>
      isBetterVinCandidate(contender, best) ? contender : best
    );
  }

  const sorted = [...contenders].sort(
    (left, right) => scoreVehicleIdentity(right) - scoreVehicleIdentity(left)
  );

  const explicitContenders = sorted.filter((candidate) =>
    ["attachment", "user", "session"].includes(
      (candidate.fieldSources?.[field] ?? candidate.source ?? "unknown") as string
    )
  );
  const decodedContender = sorted.find((candidate) =>
    (candidate.fieldSources?.[field] ?? candidate.source) === "vin_decoded"
  );

  if (
    explicitContenders.length > 0 &&
    decodedContender &&
    stringifyVehicleField(explicitContenders[0][field]) &&
    stringifyVehicleField(explicitContenders[0][field]) !== stringifyVehicleField(decodedContender[field])
  ) {
    return explicitContenders[0];
  }

  return sorted[0];
}

export function isBetterVinCandidate(
  next: VehicleIdentity | null | undefined,
  current: VehicleIdentity | null | undefined
): boolean {
  if (!next?.vin) return false;
  if (!current?.vin) return true;
  return scoreVinIdentity(next) > scoreVinIdentity(current);
}

export function isBetterVehicleCandidate(
  next: VehicleIdentity | null | undefined,
  current: VehicleIdentity | null | undefined
): boolean {
  if (!next) return false;
  if (!current) return true;
  return scoreVehicleIdentity(next) > scoreVehicleIdentity(current);
}

function pickPreferredSource(
  left: VehicleIdentity["source"],
  right: VehicleIdentity["source"]
): VehicleIdentity["source"] {
  const leftRank = SOURCE_RANK[left ?? "unknown"];
  const rightRank = SOURCE_RANK[right ?? "unknown"];
  return rightRank > leftRank ? right : left;
}

function inferVehicleConfidence(vehicle: {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  trim?: string;
  manufacturer?: string;
  bodyStyle?: string;
  series?: string;
}): number {
  const detailCount = [
    vehicle.year,
    vehicle.make,
    vehicle.model,
    vehicle.vin,
    vehicle.trim,
    vehicle.manufacturer,
    vehicle.bodyStyle,
    vehicle.series,
  ].filter(Boolean).length;
  if (vehicle.vin && detailCount >= 4) return 0.98;
  if (vehicle.vin) return 0.94;
  if (detailCount >= 4) return 0.88;
  if (detailCount >= 3) return 0.8;
  if (detailCount >= 2) return 0.68;
  return detailCount >= 1 ? 0.52 : 0;
}

function extractLabeledValue(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const regex = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:#-]\\s*([^\\n]+)`, "i");
    const match = text.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function extractBestVinCandidate(text: string): string | undefined {
  const lines = text.split("\n");
  const labeledCandidates = extractLabeledVinCandidates(text).map((candidate) => ({
    vin: candidate.vin,
    label: normalizeVinHeaderLabel(candidate.line),
    isLabeled: candidate.isLabeled,
    isBlacklistedLabel: false,
    contextWindow: candidate.localContext,
    localContext: candidate.localContext,
  }));
  const genericCandidates = lines
    .map((line, index) => buildVinTextCandidate(lines, index))
    .filter((candidate): candidate is VinTextCandidate => Boolean(candidate));
  const candidates = [...labeledCandidates, ...genericCandidates];
  const candidateCounts = new Map<string, number>();

  for (const candidate of candidates) {
    candidateCounts.set(candidate.vin, (candidateCounts.get(candidate.vin) ?? 0) + 1);
  }

  const labeledValidCandidates = labeledCandidates.filter(
    (candidate) =>
      hasValidVinChecksum(candidate.vin) &&
      !looksLikeNoiseVinContext(candidate.vin, candidate.localContext, true)
  );

  if (labeledValidCandidates.length > 0) {
    return bestRanked(labeledValidCandidates, candidateCounts)?.vin;
  }

  const genericValidCandidates = candidates.filter(
    (candidate) =>
      hasValidVinChecksum(candidate.vin) &&
      !looksLikeNoiseVinContext(candidate.vin, candidate.contextWindow)
  );

  return bestRanked(genericValidCandidates, candidateCounts)?.vin;
}

function extractBestVehicleLineCandidate(
  text: string,
  source: VehicleIdentity["source"]
): VehicleIdentity | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const labeledVinLineIndex = lines.findIndex((line) => {
    const label = normalizeVinHeaderLabel(line);
    return Boolean(label && isVinFieldLabel(label) && normalizeVin(extractHeaderValue(line)));
  });

  const candidates = lines
    .map((line, index) => buildVehicleLineCandidate(line, index, labeledVinLineIndex, source))
    .filter((candidate): candidate is VehicleIdentity => Boolean(candidate))
    .sort((left, right) => scoreVehicleIdentity(right) - scoreVehicleIdentity(left));

  return candidates[0];
}

function extractVehicleLikeLine(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) =>
    /\b(19\d{2}|20\d{2})\b/.test(line) &&
    KNOWN_MAKES.some((make) => line.toLowerCase().includes(make.toLowerCase())) ||
    Object.keys(MAKE_ALIASES).some((alias) => line.toLowerCase().includes(alias))
  );
}

function buildVehicleLineCandidate(
  line: string,
  index: number,
  labeledVinLineIndex: number,
  source: VehicleIdentity["source"]
): VehicleIdentity | undefined {
  const explicitVehicleLabelValue = extractInlineLabeledValue(line, [
    "vehicle",
    "vehicle info",
    "vehicle information",
    "vehicle description",
  ]);
  const candidateText = explicitVehicleLabelValue ?? line;
  const parsed = parseVehicleLine(candidateText);
  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    source,
    sourceQuality: classifyVehicleLineSourceQuality(
      line,
      Boolean(explicitVehicleLabelValue),
      index,
      labeledVinLineIndex
    ),
    confidence: inferVehicleConfidence(parsed),
  };
}

function classifyVehicleLineSourceQuality(
  line: string,
  hasExplicitVehicleLabel: boolean,
  index: number,
  labeledVinLineIndex: number
): NonNullable<VehicleIdentity["sourceQuality"]> {
  if (hasExplicitVehicleLabel) {
    return "explicit_header";
  }

  const lower = line.toLowerCase();
  if (VEHICLE_NOTE_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return "note_context";
  }

  if (labeledVinLineIndex >= 0 && Math.abs(index - labeledVinLineIndex) <= 3) {
    return "labeled_block";
  }

  return "unknown";
}

function extractInlineLabeledValue(line: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const regex = new RegExp(`^\\s*${escapeRegExp(label)}\\s*[:#-]\\s*(.+)$`, "i");
    const match = line.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function parseVehicleLine(line: string): {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
} | null {
  const yearMatch = line.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const normalizedLine = line.toLowerCase();
  const directMakeMatch = KNOWN_MAKES.find((candidate) => normalizedLine.includes(candidate.toLowerCase()));
  const aliasMakeMatch = Object.entries(MAKE_ALIASES).find(([alias]) => normalizedLine.includes(alias));
  const make = directMakeMatch ?? aliasMakeMatch?.[1];
  const matchedMakeToken = directMakeMatch ?? aliasMakeMatch?.[0];

  if (!year && !make) {
    return null;
  }

  let model: string | undefined;
  let trim: string | undefined;
  if (matchedMakeToken) {
    const regex = new RegExp(`${escapeRegExp(matchedMakeToken)}\\s+(.+)$`, "i");
    const makeTail = line.match(regex)?.[1]?.split(/[.;|\n]/)[0]?.trim();
    if (makeTail) {
      const tokens = makeTail.split(/\s+/).filter(Boolean);
      model = tokens.slice(0, 2).join(" ").trim() || undefined;
      trim = tokens.length > 2 ? tokens.slice(2, 5).join(" ").trim() : undefined;
    }
  }

  return {
    year,
    make,
    model: cleanVehicleToken(model),
    trim: cleanVehicleToken(trim),
  };
}

export function normalizeVin(value?: string): string | undefined {
  if (!value) return undefined;
  const compact = value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (compact.length !== 17) return undefined;
  if (NOISE_PREFIXES.some((prefix) => compact.startsWith(prefix))) return undefined;
  if (/^[A-Z]{4,}\d{6,}$/.test(compact)) return undefined;
  if (INVALID_VIN_VALUES.has(compact)) return undefined;
  if (containsInvalidVinFragments(compact)) return undefined;
  if (/^(.)\1{16}$/.test(compact)) return undefined;
  if (/\b(?:VIN|UNKNOWN|UNSPECIFIED|PENDING|TBD)\b/i.test(value)) return undefined;
  if (!hasValidVinChecksum(compact)) return undefined;
  return compact;
}

function extractVinFromTextBlock(text: string): string | undefined {
  return extractBestVinCandidate(text);
}

export function decodeVinVehicleIdentity(vin: string): VehicleIdentity | undefined {
  // This local decode is a lightweight hint for ranking/display only.
  // If external VIN decode data is supplied elsewhere in the app, NHTSA vPIC remains canonical.
  const normalizedVin = normalizeVin(vin);
  if (!normalizedVin) return undefined;

  const wmi = resolveVinManufacturer(normalizedVin);
  const year = decodeVinYear(normalizedVin);
  const checksumValid = validateVinChecksum(normalizedVin);

  const decoded: VehicleIdentity = {
    vin: normalizedVin,
    year,
    make: wmi?.make,
    manufacturer: wmi?.manufacturer,
    sourceQuality: "vin_backed",
    confidence: Number(
      Math.max(
        0.7,
        Math.min(
          0.99,
          inferVehicleConfidence({
            vin: normalizedVin,
            year,
            make: wmi?.make,
            manufacturer: wmi?.manufacturer,
          }) + (checksumValid ? 0.02 : 0)
        )
      ).toFixed(2)
    ),
    source: "vin_decoded",
    fieldSources: buildFieldSources(
      {
        vin: normalizedVin,
        year,
        make: wmi?.make,
        manufacturer: wmi?.manufacturer,
      },
      "vin_decoded"
    ),
  };

  return decoded;
}

function normalizeYear(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= 1980 && year <= 2035 ? year : undefined;
}

function cleanVehicleToken(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .split(
      /\b(?:the estimate|carrier estimate|shop estimate|repair path|reads like|appears|supports|underwritten|materially)\b/i
    )[0]
    .split(/[|;:\n]/)[0]
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/g, "")
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.length > 40) return undefined;
  if ((cleaned.match(/\s+/g)?.length ?? 0) > 4) return undefined;
  if (
    /\b(?:estimate|repair|carrier|shop|support|underwritten|materially|documentation)\b/i.test(
      cleaned
    )
  ) {
    return undefined;
  }
  return cleaned || undefined;
}

function buildFieldSources(
  values: Partial<Record<(typeof VEHICLE_FIELDS)[number], unknown>>,
  source: NonNullable<VehicleIdentity["source"]>
): NonNullable<VehicleIdentity["fieldSources"]> {
  const fieldSources: NonNullable<VehicleIdentity["fieldSources"]> = {};

  for (const field of VEHICLE_FIELDS) {
    const value = values[field];
    if (value !== undefined && value !== null && value !== "") {
      fieldSources[field] = source;
    }
  }

  return fieldSources;
}

function normalizeFieldSources(
  fieldSources: VehicleIdentity["fieldSources"],
  fallbackSource: NonNullable<VehicleIdentity["source"]>,
  values?: Partial<Record<(typeof VEHICLE_FIELDS)[number], unknown>>
): VehicleIdentity["fieldSources"] {
  const normalized: NonNullable<VehicleIdentity["fieldSources"]> = {};

  for (const field of VEHICLE_FIELDS) {
    const explicit = fieldSources?.[field];
    if (explicit) {
      normalized[field] = explicit;
    }
  }

  if (Object.keys(normalized).length === 0) {
    return buildFieldSources(values ?? {}, fallbackSource);
  }

  return normalized;
}

function stringifyVehicleField(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function buildVehicleSourceSummary(
  vehicle: VehicleIdentity | null | undefined
): string[] {
  const normalized = normalizeVehicleIdentity(vehicle);
  if (!normalized) {
    return [];
  }

  const summary = new Set<string>();
  if (normalized.fieldSources?.vin === "attachment") {
    summary.add("labeled_vin");
  }
  if (
    normalized.sourceQuality === "explicit_header" ||
    normalized.sourceQuality === "labeled_block"
  ) {
    summary.add("explicit_vehicle_block");
  }
  if (
    normalized.fieldSources?.vin === "vin_decoded" ||
    normalized.sourceQuality === "vin_backed"
  ) {
    summary.add("vin_backed_decode");
  }
  if (normalized.sourceQuality === "note_context") {
    summary.add("note_context");
  }
  if (summary.size === 0) {
    summary.add("inferred");
  }

  return [...summary];
}

function resolveVinManufacturer(vin: string): { make?: string; manufacturer?: string } | undefined {
  const prefixes = [vin.slice(0, 5), vin.slice(0, 3)];

  for (const prefix of prefixes) {
    if (WMI_MAP[prefix]) {
      return WMI_MAP[prefix];
    }
  }

  return undefined;
}

function decodeVinYear(vin: string): number | undefined {
  const code = vin[9];
  const codeIndex = VIN_YEAR_CODES.indexOf(code);
  if (codeIndex === -1) return undefined;

  const currentYear = new Date().getFullYear() + 1;
  const candidateYears = [1980 + codeIndex, 2010 + codeIndex];
  const validYears = candidateYears.filter((year) => year <= currentYear && year <= 2035);
  return validYears.length > 0 ? Math.max(...validYears) : Math.max(...candidateYears);
}

export function validateVinChecksum(vin: string): boolean {
  return hasValidVinChecksum(vin);
}

function transliterateVinChar(char: string): number {
  if (/^[0-9]$/.test(char)) return Number(char);
  return VIN_TRANSLITERATION[char] ?? -1;
}

function hasValidVinChecksum(vin: string): boolean {
  if (!VIN_ALLOWED.test(vin)) return false;

  let total = 0;
  for (let index = 0; index < vin.length; index += 1) {
    const value = transliterateVinChar(vin[index]);
    if (value < 0) return false;
    total += value * VIN_WEIGHTS[index];
  }

  const remainder = total % 11;
  const expectedCheckDigit = remainder === 10 ? "X" : String(remainder);
  return vin[8] === expectedCheckDigit;
}

function scoreVinIdentity(vehicle: VehicleIdentity): number {
  const vin = normalizeVin(vehicle.vin);
  if (!vin) return Number.NEGATIVE_INFINITY;

  let score =
    (vehicle.confidence ?? 0) +
    SOURCE_RANK[vehicle.source ?? "unknown"] * 0.25;

  score += 10;
  score += validateVinChecksum(vin) ? 4 : -3;

  const hasDecodedIdentity = Boolean(
    vehicle.year ||
      vehicle.make ||
      vehicle.model ||
      vehicle.manufacturer ||
      vehicle.fieldSources?.vin === "vin_decoded" ||
      vehicle.fieldSources?.year === "vin_decoded" ||
      vehicle.fieldSources?.make === "vin_decoded"
  );

  if (hasDecodedIdentity) {
    score += 3;
  }

  return score;
}

function scoreVehicleIdentity(vehicle: VehicleIdentity): number {
  let score = vehiclePreferenceScore(vehicle);

  if (vehicle.year && vehicle.make && vehicle.model) {
    score += 6;
  } else if (vehicle.make && vehicle.model) {
    score += 3;
  }

  if (vehicle.vin) {
    score += scoreVinIdentity(vehicle) / 10;
  }

  const rawTextLike = [vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .some((value) => typeof value === "string" && value.split(/\s+/).length >= 4);

  if (rawTextLike) {
    score -= 2;
  }

  return score;
}

type VinTextCandidate = {
  vin: string;
  label?: string;
  isLabeled: boolean;
  isBlacklistedLabel: boolean;
  contextWindow: string;
  localContext?: string;
};

function extractLabeledVinCandidates(text: string): Array<{
  vin: string;
  isLabeled: true;
  line: string;
  localContext: string;
}> {
  return text
    .split(/\r?\n/)
    .map((line, index, lines) => {
      const match = line.match(/\bVIN\b\s*[:#-]?\s*([A-HJ-NPR-Z0-9]{17})\b/i);
      if (!match) return null;

      return {
        vin: match[1].toUpperCase(),
        isLabeled: true as const,
        line,
        localContext: [lines[index - 1], line, lines[index + 1]].filter(Boolean).join("\n"),
      };
    })
    .filter((candidate): candidate is {
      vin: string;
      isLabeled: true;
      line: string;
      localContext: string;
    } => Boolean(candidate));
}

function buildVinTextCandidate(lines: string[], index: number): VinTextCandidate | null {
  const line = lines[index] ?? "";
  const trimmed = line.trim();
  if (!trimmed) return null;

  const label = normalizeVinHeaderLabel(trimmed);
  const isBlacklistedLabel = label ? isBlacklistedVinHeaderLabel(label) : false;
  if (isBlacklistedLabel) {
    return null;
  }
  const pageFurnitureLine = isPageFurnitureLine(trimmed);

  if (label && isVinFieldLabel(label)) {
    return null;
  }

  if (pageFurnitureLine) {
    return null;
  }

  const contiguousVinMatch = trimmed.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0];
  const normalizedVinValue = normalizeVin(contiguousVinMatch);
  if (!normalizedVinValue) {
    return null;
  }
  if (
    containsInvalidVinFragments(normalizedVinValue) ||
    hasVinNoiseContext(lines, index, normalizedVinValue)
  ) {
    return null;
  }

  return {
    vin: normalizedVinValue,
    label,
    isLabeled: false,
    isBlacklistedLabel: false,
    contextWindow: buildVinContextWindow(lines, index),
  };
}

function scoreVinTextCandidate(candidate: VinTextCandidate, repeatCount: number): number {
  let score = 0;
  if (candidate.isLabeled) score += 100;
  else if (repeatCount > 1) score += 20;
  else score += 5;
  if (candidate.label && isVinFieldLabel(candidate.label)) score += 50;
  if (candidate.label && candidate.isBlacklistedLabel) score -= 1000;
  score += 10;
  return score;
}

function bestRanked(
  candidates: VinTextCandidate[],
  candidateCounts: Map<string, number>
): VinTextCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort(
    (left, right) =>
      scoreVinTextCandidate(right, candidateCounts.get(right.vin) ?? 1) -
      scoreVinTextCandidate(left, candidateCounts.get(left.vin) ?? 1)
  )[0] ?? null;
}

function normalizeVinHeaderLabel(line: string): string | undefined {
  const colonIndex = line.indexOf(":");
  if (colonIndex >= 0) {
    return line.slice(0, colonIndex).trim().toLowerCase().replace(/\s+/g, " ") || undefined;
  }

  const separatorMatch = line.match(/^(.+?)\s(?:-|#)\s+/);
  if (!separatorMatch?.[1]) {
    return undefined;
  }

  return separatorMatch[1].trim().toLowerCase().replace(/\s+/g, " ") || undefined;
}

function isVinFieldLabel(label: string): boolean {
  return VIN_FIELD_LABELS.some((candidate) => label === candidate || label.startsWith(candidate));
}

function isBlacklistedVinHeaderLabel(label: string): boolean {
  return BLACKLISTED_VIN_HEADER_LABELS.some((candidate) =>
    label === candidate || label.startsWith(candidate)
  );
}

function extractHeaderValue(line: string): string | undefined {
  const colonIndex = line.indexOf(":");
  if (colonIndex >= 0) {
    return line.slice(colonIndex + 1).trim() || undefined;
  }

  const separatorMatch = line.match(/^.+?\s(?:-|#)\s+(.+)$/);
  return separatorMatch?.[1]?.trim() || undefined;
}

function isPageFurnitureLine(line: string): boolean {
  return VIN_PAGE_FURNITURE_PATTERNS.filter((pattern) => pattern.test(line)).length >= 2;
}

function containsInvalidVinFragments(value: string): boolean {
  return INVALID_VIN_FRAGMENT_PATTERNS.some((pattern) => pattern.test(value));
}

function hasVinNoiseContext(lines: string[], index: number, vin: string): boolean {
  const window = buildVinContextWindow(lines, index);

  return looksLikeNoiseVinContext(vin, window);
}

function buildVinContextWindow(lines: string[], index: number): string {
  return lines
    .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
    .join(" ");
}

function looksLikeNoiseVinContext(
  candidate: string,
  context: string,
  isDirectLabeledVin = false
): boolean {
  if (isDirectLabeledVin && hasValidVinChecksum(candidate)) {
    return false;
  }

  const lowerContext = context.toLowerCase();
  const noiseTokens = [
    "panel",
    "part number",
    "subtotal",
    "estimate totals",
    "supplement summary",
    "workfile",
    "federal",
    "lkq",
    "recond",
  ];

  if (noiseTokens.some((token) => lowerContext.includes(token))) return true;

  if (/\b\d+\.\d\b/.test(context)) return true;
  if (/^(PANEL|PART|CLAIM|WORKFILE|FEDERAL|POLICY|PAGE)/i.test(candidate)) return true;

  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

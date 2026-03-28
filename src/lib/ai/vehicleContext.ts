import type { VehicleIdentity } from "./types/analysis";

const KNOWN_MAKES = [
  "Acura",
  "Audi",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Ford",
  "GMC",
  "Honda",
  "Hyundai",
  "Infiniti",
  "Jaguar",
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

const MAKE_ABBREVIATIONS: Record<string, string> = {
  JAGU: "Jaguar",
};

const SOURCE_RANK: Record<NonNullable<VehicleIdentity["source"]>, number> = {
  vin_decoded: 6,
  attachment: 5,
  user: 4,
  inferred: 3,
  session: 2,
  unknown: 1,
};

const VIN_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";
const PLACEHOLDER_VEHICLE_VALUE_PATTERNS = [
  /^(?:unknown|unspecified|n\/a|na|none|null|undefined|tbd)$/i,
  /^not clearly supported(?: in the current material)?\.?$/i,
  /^vehicle details are still limited(?: in the current material)?\.?$/i,
  /^not available\.?$/i,
  /^not provided\.?$/i,
] as const;
const MALFORMED_VEHICLE_DESCRIPTOR_PATTERN =
  /\b(?:2D|3D|4D|UTV|SEDAN|SDN|COUPE|WAGON|WGN|HB|HATCHBACK)\b/i;
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

  const vehicleLine =
    extractLabeledValue(normalized, ["vehicle", "vehicle info", "vehicle information", "vehicle description"]) ??
    extractVehicleLikeLine(normalized);
  const parsedVehicleLine = vehicleLine ? parseVehicleLine(vehicleLine) : null;

  const year =
    parsedVehicleLine?.year ??
    normalizeYear(extractLabeledValue(normalized, ["year", "yr", "model year"]));
  const make =
    parsedVehicleLine?.make ??
    normalizeVehicleMakeToken(cleanVehicleToken(extractLabeledValue(normalized, ["make", "mk"])));
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

  const extractedVehicle =
    mergeVehicleIdentity(
      statedVehicle,
      vin ? decodeVinVehicleIdentity(vin) : null
    ) ?? statedVehicle;

  console.info("[vehicle-label-trace:estimate-parse]", {
    source,
    vehicleLine: vehicleLine ?? null,
    parsedVehicleLine: parsedVehicleLine ?? null,
    extractedVehicle,
  });

  return extractedVehicle;
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
    vin: normalizeAcceptedVin(vehicle.vin),
    trim: cleanVehicleToken(vehicle.trim),
    manufacturer: cleanVehicleToken(vehicle.manufacturer),
    bodyStyle: cleanVehicleToken(vehicle.bodyStyle),
    series: cleanVehicleToken(vehicle.series),
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

  if (!hasNamedVehicleIdentity(normalized)) {
    return "";
  }

  const parts = [
    normalized.year,
    normalized.make,
    normalized.model,
    options?.includeTrim ? normalized.trim : undefined,
  ].filter(Boolean);

  return parts.join(" ").trim();
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

function hasNamedVehicleIdentity(vehicle: VehicleIdentity): boolean {
  return Boolean(vehicle.make || vehicle.model || vehicle.manufacturer);
}

function vehiclePreferenceScore(vehicle: VehicleIdentity): number {
  return (
    vehicleIdentityCompletenessScore(vehicle) +
    (vehicle.confidence ?? 0) +
    SOURCE_RANK[vehicle.source ?? "unknown"] * 0.25
  );
}

function chooseVehicleFieldContender(
  field: (typeof VEHICLE_FIELDS)[number],
  contenders: VehicleIdentity[]
): VehicleIdentity {
  const sorted = [...contenders].sort((left, right) => {
    if (field === "vin") {
      if (isBetterVinCandidate(right.vin, left.vin)) return 1;
      if (isBetterVinCandidate(left.vin, right.vin)) return -1;
    }
    if (isBetterVehicleCandidate(right, left)) return 1;
    if (isBetterVehicleCandidate(left, right)) return -1;
    const scoreDelta = vehicleFieldPreferenceScore(field, right) - vehicleFieldPreferenceScore(field, left);
    if (scoreDelta !== 0) return scoreDelta;
    return vehiclePreferenceScore(right) - vehiclePreferenceScore(left);
  });

  if (field === "vin") {
    return sorted[0];
  }

  const decodedContender = sorted.find((candidate) =>
    (candidate.fieldSources?.[field] ?? candidate.source) === "vin_decoded"
  );

  if (decodedContender && protectsVinDecodedField(field)) {
    return decodedContender;
  }

  return sorted[0];
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

function extractVehicleLikeLine(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => /\b(19\d{2}|20\d{2})\b/.test(line) && Boolean(resolveVehicleMakeMatch(line)));
}

function parseVehicleLine(line: string): {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
} | null {
  const yearMatch = line.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const makeMatch = resolveVehicleMakeMatch(line);
  const make = makeMatch?.make;

  if (!year && !make) {
    return null;
  }

  let model: string | undefined;
  let trim: string | undefined;
  if (makeMatch) {
    const regex = new RegExp(`${escapeRegExp(makeMatch.matchedToken)}\\s+(.+)$`, "i");
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

function normalizeVinShape(value?: string): string | undefined {
  if (!value) return undefined;
  const compact = value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  return compact.match(/^[A-HJ-NPR-Z0-9]{17}$/)?.[0] ?? compact.match(/[A-HJ-NPR-Z0-9]{17}/)?.[0];
}

function normalizeAcceptedVin(value?: string): string | undefined {
  const normalized = normalizeVinShape(value);
  if (!normalized) return undefined;
  if (!isAcceptableVinCandidate(normalized)) return undefined;
  return normalized;
}

function extractVinFromTextBlock(text: string): string | undefined {
  const candidates = [
    extractLabeledValue(text, ["vin", "vin#", "vehicle identification number"]),
    text.match(/(?:^|[^A-Z0-9])((?:[A-HJ-NPR-Z0-9][\s:-]*){17})(?=[^A-Z0-9]|$)/i)?.[1],
    text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0],
  ]
    .map((candidate) => normalizeVinShape(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  let best: string | undefined;
  for (const candidate of candidates) {
    if (isBetterVinCandidate(candidate, best)) {
      best = candidate;
    }
  }

  return best;
}

export function decodeVinVehicleIdentity(vin: string): VehicleIdentity | undefined {
  const normalizedVin = normalizeAcceptedVin(vin);
  if (!normalizedVin) return undefined;

  const wmi = resolveVinManufacturer(normalizedVin);
  const year = decodeVinYear(normalizedVin);
  const checksumValid = validateVinChecksum(normalizedVin);

  const decoded: VehicleIdentity = {
    vin: normalizedVin,
    year,
    make: wmi?.make,
    manufacturer: wmi?.manufacturer,
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
  if (isPlaceholderVehicleValue(cleaned)) return undefined;
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

function normalizeVehicleMakeToken(value?: string): string | undefined {
  if (!value) return undefined;

  const abbreviation = MAKE_ABBREVIATIONS[value.toUpperCase()];
  if (abbreviation) {
    return abbreviation;
  }

  const knownMake = KNOWN_MAKES.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
  return knownMake ?? value;
}

function resolveVehicleMakeMatch(
  line: string
): { make: string; matchedToken: string } | undefined {
  for (const [abbreviation, make] of Object.entries(MAKE_ABBREVIATIONS)) {
    if (new RegExp(`\\b${escapeRegExp(abbreviation)}\\b`, "i").test(line)) {
      return {
        make,
        matchedToken: abbreviation,
      };
    }
  }

  const knownMake = KNOWN_MAKES.find((candidate) =>
    new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(line)
  );
  if (!knownMake) {
    return undefined;
  }

  return {
    make: knownMake,
    matchedToken: knownMake,
  };
}

function isPlaceholderVehicleValue(value?: string): boolean {
  if (!value) return true;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return true;
  return PLACEHOLDER_VEHICLE_VALUE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export function isBetterVehicleCandidate(
  next: VehicleIdentity | null | undefined,
  current: VehicleIdentity | null | undefined
): boolean {
  const normalizedNext = normalizeVehicleIdentity(next);
  if (!normalizedNext) return false;

  const normalizedCurrent = normalizeVehicleIdentity(current);
  if (!normalizedCurrent) return true;

  const nextProtectedDecoded = hasProtectedVinDecodedFields(normalizedNext);
  const currentProtectedDecoded = hasProtectedVinDecodedFields(normalizedCurrent);
  if (nextProtectedDecoded !== currentProtectedDecoded) {
    return nextProtectedDecoded;
  }

  const nextNamedIdentity = hasNamedVehicleIdentity(normalizedNext);
  const currentNamedIdentity = hasNamedVehicleIdentity(normalizedCurrent);
  if (nextNamedIdentity !== currentNamedIdentity) {
    return nextNamedIdentity;
  }

  const nextNoisePenalty = vehicleDescriptorNoisePenalty(normalizedNext);
  const currentNoisePenalty = vehicleDescriptorNoisePenalty(normalizedCurrent);
  if (nextNoisePenalty !== currentNoisePenalty) {
    return nextNoisePenalty < currentNoisePenalty;
  }

  const nextCompleteness = vehicleIdentityCompletenessScore(normalizedNext);
  const currentCompleteness = vehicleIdentityCompletenessScore(normalizedCurrent);
  if (nextCompleteness !== currentCompleteness) {
    return nextCompleteness > currentCompleteness;
  }

  const nextSourceRank = SOURCE_RANK[normalizedNext.source ?? "unknown"];
  const currentSourceRank = SOURCE_RANK[normalizedCurrent.source ?? "unknown"];
  if (nextSourceRank !== currentSourceRank) {
    return nextSourceRank > currentSourceRank;
  }

  const nextConfidence = normalizedNext.confidence ?? 0;
  const currentConfidence = normalizedCurrent.confidence ?? 0;
  if (nextConfidence !== currentConfidence) {
    return nextConfidence > currentConfidence;
  }

  return false;
}

export function isBetterVinCandidate(
  next: string | null | undefined,
  current: string | null | undefined
): boolean {
  const normalizedNext = normalizeVinShape(next ?? undefined);
  if (!normalizedNext || !isAcceptableVinCandidate(normalizedNext)) {
    return false;
  }

  const normalizedCurrent = normalizeVinShape(current ?? undefined);
  if (!normalizedCurrent || !isAcceptableVinCandidate(normalizedCurrent)) {
    return true;
  }

  const nextScore = scoreVinCandidate(normalizedNext);
  const currentScore = scoreVinCandidate(normalizedCurrent);
  if (nextScore !== currentScore) {
    return nextScore > currentScore;
  }

  return false;
}

function vehicleIdentityCompletenessScore(vehicle: VehicleIdentity): number {
  let score = 0;
  if (vehicle.vin) score += 8;
  if (vehicle.year) score += 5;
  if (vehicle.make) score += 5;
  if (vehicle.model) score += 5;
  if (vehicle.trim) score += 2;
  if (vehicle.manufacturer) score += 2;
  if (vehicle.bodyStyle) score += 1;
  if (vehicle.series) score += 1;
  return score;
}

function isAcceptableVinCandidate(vin: string): boolean {
  if (!vin.match(/^[A-HJ-NPR-Z0-9]{17}$/)) {
    return false;
  }

  return validateVinChecksum(vin);
}

function scoreVinCandidate(vin: string): number {
  let score = 0;
  if (validateVinChecksum(vin)) score += 100;
  if (resolveVinManufacturer(vin)?.make) score += 10;
  if (decodeVinYear(vin)) score += 5;
  return score;
}

function vehicleFieldPreferenceScore(
  field: (typeof VEHICLE_FIELDS)[number],
  vehicle: VehicleIdentity
): number {
  let score = vehiclePreferenceScore(vehicle);
  const fieldSource = vehicle.fieldSources?.[field] ?? vehicle.source ?? "unknown";

  if (fieldSource === "vin_decoded" && protectsVinDecodedField(field)) {
    score += 100;
  }

  if (looksMalformedVehicleDescriptor(field, vehicle[field])) {
    score -= 24;
  }

  return score;
}

function protectsVinDecodedField(field: (typeof VEHICLE_FIELDS)[number]): boolean {
  return field === "vin" || field === "year" || field === "make" || field === "manufacturer";
}

function hasProtectedVinDecodedFields(vehicle: VehicleIdentity): boolean {
  return VEHICLE_FIELDS.some((field) =>
    protectsVinDecodedField(field) &&
    Boolean(vehicle[field]) &&
    (vehicle.fieldSources?.[field] ?? vehicle.source) === "vin_decoded"
  );
}

function vehicleDescriptorNoisePenalty(vehicle: VehicleIdentity): number {
  let penalty = 0;
  for (const field of VEHICLE_FIELDS) {
    if (looksMalformedVehicleDescriptor(field, vehicle[field])) {
      penalty += 1;
    }
  }
  return penalty;
}

function looksMalformedVehicleDescriptor(
  field: (typeof VEHICLE_FIELDS)[number],
  value: VehicleIdentity[(typeof VEHICLE_FIELDS)[number]]
): boolean {
  if ((field !== "model" && field !== "trim" && field !== "bodyStyle" && field !== "series") || typeof value !== "string") {
    return false;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  return (
    MALFORMED_VEHICLE_DESCRIPTOR_PATTERN.test(normalized) &&
    /\b(?:AWD|FWD|RWD|4WD|2WD)\b/i.test(normalized)
  );
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

function validateVinChecksum(vin: string): boolean {
  const transliteration: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

  let total = 0;
  for (let index = 0; index < vin.length; index += 1) {
    const char = vin[index];
    const value = /\d/.test(char) ? Number(char) : transliteration[char];
    if (value === undefined) return false;
    total += value * weights[index];
  }

  const remainder = total % 11;
  const expectedCheckDigit = remainder === 10 ? "X" : String(remainder);
  return vin[8] === expectedCheckDigit;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

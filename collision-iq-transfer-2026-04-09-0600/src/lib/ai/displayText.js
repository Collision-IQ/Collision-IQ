const OCR_CONFIDENCE_SUFFIX_PATTERN = /\b([A-Za-z][A-Za-z/&'-]*?)(?:m)?0\.(?:1|2|3|4|5)\b/g;
const RAW_OCR_SUFFIX_PATTERN = /\b[A-Za-z][A-Za-z/&'-]*(?:m)?0\.(?:1|2|3|4|5)\b/g;
const BODY_STYLE_SUFFIX_PATTERN =
  /\b(?:2D|3D|4D|SUV|CUV|UTV|SEDAN|SDN|COUPE|WAGON|WGN|HB|HATCHBACK|VAN|CREW\s+CAB|EXT\s+CAB|REG\s+CAB|CAB)\b/gi;
const UPPER_ACRONYMS = new Set([
  "adas",
  "awd",
  "fwd",
  "rwd",
  "srs",
  "vin",
  "oem",
  "ev",
  "hev",
  "phev",
  "suv",
  "cuv",
  "utv",
  "4wd",
  "2wd",
]);

export function cleanDisplayText(value) {
  if (!value) return "";

  return value
    .replace(/\r/g, "")
    .replace(OCR_CONFIDENCE_SUFFIX_PATTERN, "$1")
    .replace(/\b([A-Za-z][A-Za-z/&'-]+)\s+\1\b/gi, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function cleanDisplayLabel(value) {
  const cleaned = cleanDisplayText(value);
  if (!cleaned) return "";

  const hasSentencePunctuation = /[.!?]/.test(cleaned);
  if (hasSentencePunctuation) {
    return cleaned;
  }

  return cleaned
    .split(/\s+/)
    .map((token) => titleCaseToken(token))
    .join(" ");
}

export function getDisplayVehicleInfo(vehicle) {
  if (!vehicle) {
    return {
      label: undefined,
      trim: undefined,
    };
  }

  const year = vehicle.year;
  const make = cleanDisplayLabel(vehicle.make);
  const model = cleanDisplayLabel(vehicle.model);
  const trim = cleanVehicleTrim(vehicle.trim);
  const label = [year, make, model, trim].filter(Boolean).join(" ").trim() || undefined;

  return {
    label,
    trim,
  };
}

export function assessDisplayQuality(params) {
  const supplementItems = params?.supplementItems ?? [];
  const vehicleLabel = params?.vehicleLabel ?? "";
  const vehicleTrim = params?.vehicleTrim ?? "";
  const combinedSignals = [vehicleLabel, vehicleTrim, ...supplementItems.map((item) => item?.title ?? "")]
    .filter(Boolean)
    .join(" ");
  const rawSuffixMatches = combinedSignals.match(RAW_OCR_SUFFIX_PATTERN) ?? [];
  const malformedVehicle =
    /\b\dD\s+UTV\b/i.test(`${vehicleLabel} ${vehicleTrim}`) ||
    (/\b(?:UTV|4D|2D)\b/i.test(`${vehicleLabel} ${vehicleTrim}`) &&
      /\b(?:AWD|FWD|RWD)\b/i.test(`${vehicleLabel} ${vehicleTrim}`));
  const lowQualityItemCount = supplementItems.filter((item) =>
    looksLikeLowQualityLabel(item?.title)
  ).length;

  return {
    noisy: rawSuffixMatches.length >= 2 || malformedVehicle || lowQualityItemCount >= 2,
    malformedVehicle,
    lowQualityItemCount,
  };
}

function cleanVehicleTrim(value) {
  if (!value) return undefined;

  const cleaned = cleanDisplayText(value)
    .replace(BODY_STYLE_SUFFIX_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return undefined;
  return cleanDisplayLabel(cleaned);
}

function titleCaseToken(token) {
  const lower = token.toLowerCase();
  if (UPPER_ACRONYMS.has(lower)) {
    return lower.toUpperCase();
  }

  if (/^[A-Z0-9]{2,}$/.test(token)) {
    return token;
  }

  if (/^[A-Za-z]{1,4}\d[A-Za-z0-9]*$/.test(token)) {
    return token.toUpperCase();
  }

  if (/^\d+[A-Za-z]*$/.test(token)) {
    return token.toUpperCase();
  }

  const pieces = token.split(/([/-])/);
  return pieces
    .map((piece) => {
      if (!piece) return piece;
      if (piece === "/" || piece === "-") return piece;
      if (UPPER_ACRONYMS.has(piece.toLowerCase())) {
        return piece.toUpperCase();
      }
      return piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase();
    })
    .join("");
}

function looksLikeLowQualityLabel(value) {
  if (!value) return false;
  const cleaned = String(value).trim();
  if (!cleaned) return false;
  if (RAW_OCR_SUFFIX_PATTERN.test(cleaned)) return true;
  if (cleaned.length < 4) return true;
  if ((cleaned.match(/\b[A-Za-z]+\b/g) ?? []).length === 1 && !/[A-Z]/.test(cleaned)) {
    return true;
  }
  return /\b(?:wheel|mirror|battery|panel)\b/i.test(cleaned) && !/\s/.test(cleaned);
}

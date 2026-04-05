const LEAKED_TIME_FRAGMENT_BASES = [
  "battery",
  "wheel",
  "bumper",
  "fender",
  "door",
  "hood",
  "lamp",
  "liner",
  "mirror",
  "panel",
  "grille",
  "fascia",
  "sensor",
  "scan",
  "calibration",
] as const;

const leakedTimeFragmentPattern = new RegExp(
  `\\b(${LEAKED_TIME_FRAGMENT_BASES.join("|")})m\\d+(?:\\.\\d+)?\\b`,
  "gi"
);
const ORPHAN_SECTION_LABEL_PATTERN =
  /(?:^|\n)\s*(?:what looks reasonable|what still needs support|what looks aggressive|what stands out|documented positives|likely remaining gaps|support posture|estimate position)\s*:\s*(?=\n|$)/gim;

export function cleanPresentationText(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(ORPHAN_SECTION_LABEL_PATTERN, "\n")
    .replace(/[Â·]+/g, "·")
    .replace(leakedTimeFragmentPattern, "$1")
    .replace(/\b([A-Z]{2,})\s*[-|/]\s*(scan|module|dtc|fault)\b/gi, "$1")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanPresentationMarkdown(value: string): string {
  return cleanPresentationText(value);
}

export function cleanVehicleSummaryLabel(value: string | null | undefined): string {
  const base = cleanPresentationText(value);
  const cleaned = preserveCanonicalVehicleSummary(base);

  if (!cleaned) return "";
  if (cleaned.length > 60) return "";
  if (!/[A-Za-z]/.test(cleaned)) return "";
  return cleaned;
}

export function cleanVehicleTrimLabel(value: string | null | undefined): string {
  const cleaned = preserveCanonicalVehicleTrim(cleanPresentationText(value));
  if (!cleaned) return "";
  if (cleaned.length > 36) return "";
  if (/(scan|module|dtc|fault|code|title)/i.test(cleaned)) return "";
  return cleaned;
}

function preserveCanonicalVehicleSummary(value: string): string {
  if (!value) return "";

  if (looksLikeCanonicalVehicleSummary(value)) {
    return value;
  }

  return value.replace(/\b(scan|module|dtc|fault|code|title)\b.*$/i, "").trim();
}

function preserveCanonicalVehicleTrim(value: string): string {
  if (!value) return "";

  if (looksLikeCanonicalVehicleTrim(value)) {
    return value;
  }

  return value.replace(/\b(scan|module|dtc|fault|code|title)\b.*$/i, "").trim();
}

function looksLikeCanonicalVehicleSummary(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const hasYear = /\b(?:19|20)\d{2}\b/.test(trimmed);
  const hasMultiWordVehicle =
    /\b[A-Za-z]{2,}\b/.test(trimmed) && trimmed.split(/\s+/).filter(Boolean).length >= 3;
  const hasVinOnly = /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(trimmed);

  return (hasYear && hasMultiWordVehicle) || hasVinOnly;
}

function looksLikeCanonicalVehicleTrim(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (/^(?:[0-9]{1,3}[A-Za-z]{0,2}(?:\s+(?:AWD|FWD|RWD|4WD|2WD))?)$/i.test(trimmed)) {
    return true;
  }

  if (
    /^(?:AWD|FWD|RWD|4WD|2WD|SPORT|LIMITED|PLATINUM|PREMIUM|PERFORMANCE|LONG RANGE)$/i.test(
      trimmed
    )
  ) {
    return true;
  }

  return false;
}

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

export function cleanPresentationText(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(/Ã‚Â·|Â·/g, "·")
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
  const cleaned = cleanPresentationText(value)
    .replace(/\b(scan|module|dtc|fault|code|title)\b.*$/i, "")
    .trim();

  if (!cleaned) return "";
  if (cleaned.length > 60) return "";
  if (!/[A-Za-z]/.test(cleaned)) return "";
  return cleaned;
}

export function cleanVehicleTrimLabel(value: string | null | undefined): string {
  const cleaned = cleanPresentationText(value);
  if (!cleaned) return "";
  if (cleaned.length > 36) return "";
  if (/(scan|module|dtc|fault|code|title)/i.test(cleaned)) return "";
  return cleaned;
}

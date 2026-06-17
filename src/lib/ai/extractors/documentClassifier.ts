export type RepairDocumentType =
  | "estimate"
  | "adas_report"
  | "oem_procedure"
  | "photo"
  | "document"
  | "unknown";

export function classifyDocument(name: string, mime = ""): RepairDocumentType {
  const normalizedName = name.toLowerCase();
  const normalizedMime = mime.toLowerCase();

  if (
    normalizedName.includes("estimate") ||
    normalizedName.includes("supplement") ||
    /\bsor\d*\b/.test(normalizedName) ||
    /\bshop\b/.test(normalizedName) ||
    normalizedName.includes("work auth") ||
    normalizedName.includes("approved repair") ||
    normalizedName.includes("ccc") ||
    normalizedName.includes("mitchell")
  ) {
    return "estimate";
  }

  if (
    normalizedName.includes("adas") ||
    normalizedName.includes("calibration") ||
    normalizedName.includes("scan report")
  ) {
    return "adas_report";
  }

  if (
    normalizedName.includes("procedure") ||
    normalizedName.includes("oem") ||
    normalizedName.includes("repair guideline") ||
    normalizedName.includes("oem guideline") ||
    normalizedName.includes("tsb")
  ) {
    return "oem_procedure";
  }

  if (normalizedMime.startsWith("image/")) {
    return "photo";
  }

  if (normalizedName.endsWith(".pdf") || normalizedMime.includes("pdf")) {
    return "document";
  }

  return "unknown";
}

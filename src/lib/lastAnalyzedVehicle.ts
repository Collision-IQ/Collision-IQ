import type { StoredAnalysisReport } from "@/lib/analysisReportStore";
import type { VehicleProfile } from "@/lib/vehicleMaintenance";

/**
 * The vehicle from the owner's most recent analysis (an estimate or claim they
 * ran in the workspace). It is a reference only: "My Vehicle" keeps the
 * owner's own saved vehicle for recalls and maintenance, and this rides
 * alongside so the panel can show the last vehicle analysed without
 * overwriting the saved one.
 */
export type LastAnalyzedVehicle = {
  reportId: string;
  /** ISO timestamp of the analysis the identity came from. */
  analyzedAt: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  /** "2018 Ford F-150 XLT" — whatever parts are known. */
  label: string;
};

const clean = (value: unknown, max = 60): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const cleanYear = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
};

const cleanVin = (value: unknown): string | null => {
  const vin = clean(value, 32)?.toUpperCase() ?? null;
  return vin && vin.length === 17 ? vin : null;
};

/** Pure: the analysed vehicle from a stored report, or null when the report names no vehicle. */
export function lastAnalyzedVehicleFromReport(
  stored: Pick<StoredAnalysisReport, "id" | "createdAt" | "report"> | null | undefined
): LastAnalyzedVehicle | null {
  if (!stored) return null;
  const identity = stored.report?.vehicle;
  if (!identity) return null;
  const year = cleanYear(identity.year);
  const make = clean(identity.make);
  const model = clean(identity.model);
  const trim = clean(identity.trim);
  const vin = cleanVin(identity.vin);
  if (!vin && !(year || make || model)) return null;
  const label = [year, make, model, trim].filter(Boolean).join(" ").trim() || (vin ? `VIN ${vin}` : "");
  return { reportId: stored.id, analyzedAt: stored.createdAt, year, make, model, trim, vin, label };
}

/**
 * Pure: true when the analysed vehicle is the owner's saved vehicle — the
 * same VIN when both have one, otherwise the same year, make and model.
 */
export function isSameVehicle(
  analyzed: Pick<LastAnalyzedVehicle, "year" | "make" | "model" | "vin"> | null,
  saved: Pick<VehicleProfile, "year" | "make" | "model" | "vin"> | null | undefined
): boolean {
  if (!analyzed || !saved) return false;
  const savedVin = cleanVin(saved.vin);
  if (analyzed.vin && savedVin) return analyzed.vin === savedVin;
  const key = (y: unknown, mk: unknown, md: unknown) =>
    [cleanYear(y), clean(mk)?.toUpperCase(), clean(md)?.toUpperCase()].map((v) => v ?? "").join("|");
  const analyzedKey = key(analyzed.year, analyzed.make, analyzed.model);
  return analyzedKey !== "||" && analyzedKey === key(saved.year, saved.make, saved.model);
}

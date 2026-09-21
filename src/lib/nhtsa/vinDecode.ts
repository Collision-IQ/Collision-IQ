import { fetchJsonWithRetry, type FetchJsonWithRetryOptions } from "./client";
import type { VpicDecodeResult } from "./types";

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues";

interface VpicResponse {
  Results: Array<Record<string, string>>;
}

/** Standard VIN shape: 17 chars, excludes I, O, Q to avoid confusion with 1/0. */
export const VIN_SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/;

function invalid(vin: string, errorText: string): VpicDecodeResult {
  return { vin, make: null, model: null, modelYear: null, trim: null, bodyClass: null, isValid: false, errorText };
}

/**
 * Decodes a VIN with NHTSA's free vPIC API (no key, no account).
 * Docs: https://vpic.nhtsa.dot.gov/api/
 *
 * This is deliberately separate from the offline `decodeVinVehicleIdentity`
 * in `src/lib/ai/vehicleContext.ts`: that decoder yields year and (for
 * unambiguous WMIs) make from the VIN alone, which is what report pipelines
 * need. The recalls API also needs the MODEL, which only a full decode
 * provides, so this is the bridge from "user typed a VIN" to a recall query.
 */
export async function decodeVinViaVpic(
  vin: string,
  options?: FetchJsonWithRetryOptions
): Promise<VpicDecodeResult> {
  const cleanVin = vin.trim().toUpperCase();

  if (!VIN_SHAPE.test(cleanVin)) {
    return invalid(cleanVin, "VIN must be 17 characters and cannot contain I, O, or Q.");
  }

  const url = `${VPIC_BASE}/${encodeURIComponent(cleanVin)}?format=json`;
  const data = await fetchJsonWithRetry<VpicResponse>(url, options);
  const row = data.Results?.[0];

  if (!row) {
    return invalid(cleanVin, "No decode result returned by NHTSA.");
  }

  // ErrorCode "0" means a clean decode. Other codes (check-digit issues,
  // ambiguous plant codes) can still return partial data worth showing, so
  // the only hard failure is a missing Make.
  const errorCodes = (row.ErrorCode ?? "").split(",").map((c) => c.trim());
  const isValid = errorCodes.includes("0") && !!row.Make;

  return {
    vin: cleanVin,
    make: row.Make || null,
    model: row.Model || null,
    modelYear: row.ModelYear || null,
    trim: row.Trim || null,
    bodyClass: row.BodyClass || null,
    isValid,
    errorText: isValid ? null : row.ErrorText || "VIN could not be fully decoded.",
  };
}

/** Makes NHTSA returns in caps that are written in caps by their owners. */
const ALL_CAPS_MAKES = new Set(["BMW", "GMC", "RAM", "MINI", "KIA", "MG", "SRT", "AMC", "GM"]);

/**
 * vPIC returns makes in ALL CAPS ("FORD", "MERCEDES-BENZ", "LAND ROVER").
 * Present them the way the form expects while leaving initialisms alone.
 */
export function formatVpicMake(make: string | null | undefined): string | null {
  const trimmed = (make ?? "").trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (ALL_CAPS_MAKES.has(upper)) return upper;
  return upper
    .split(/(\s+|-)/)
    .map((part) => (/^[A-Z]/.test(part) ? part[0] + part.slice(1).toLowerCase() : part))
    .join("");
}

export interface DecodedVinProfileFields {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

/**
 * The profile fields a successful decode fills in. An invalid decode yields
 * all nulls so a caller never overwrites typed values with partial data.
 */
export function decodedVinToProfileFields(decoded: VpicDecodeResult): DecodedVinProfileFields {
  if (!decoded.isValid) return { year: null, make: null, model: null, trim: null };
  const year = decoded.modelYear ? Number(decoded.modelYear) : NaN;
  return {
    year: Number.isFinite(year) ? year : null,
    make: formatVpicMake(decoded.make),
    model: decoded.model?.trim() || null,
    trim: decoded.trim?.trim() || null,
  };
}

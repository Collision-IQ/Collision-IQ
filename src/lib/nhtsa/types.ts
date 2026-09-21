// NHTSA public data types. Both endpoints used here (vPIC VIN decode and the
// recalls-by-vehicle API) are free, keyless government services.

export interface VpicDecodeResult {
  vin: string;
  make: string | null;
  model: string | null;
  modelYear: string | null;
  trim: string | null;
  bodyClass: string | null;
  isValid: boolean;
  errorText: string | null;
}

export interface NhtsaRecall {
  /** NHTSACampaignNumber, e.g. "24V123000". Stable identifier for "seen" tracking. */
  campaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  /** As returned by NHTSA, e.g. "01/15/2026". */
  reportReceivedDate: string;
  manufacturer: string;
}

/** The only key NHTSA's recalls API accepts: it does NOT take a VIN. */
export interface RecallVehicleIdentity {
  make: string;
  model: string;
  modelYear: string;
}

export type RecallIdentitySource = "vin_decoded" | "profile";

export type VehicleRecallSnapshotStatus = "ok" | "unavailable" | "error";

/**
 * Persisted result of the most recent recall check for a stored vehicle.
 * Lives inside the vehicle profile JSON (server-managed; never client-written).
 */
export interface VehicleRecallSnapshot {
  checkedAt: string;
  status: VehicleRecallSnapshotStatus;
  /** Year/make/model actually sent to NHTSA, or null when none could be resolved. */
  identity: RecallVehicleIdentity | null;
  identitySource: RecallIdentitySource | null;
  vin: string | null;
  campaigns: NhtsaRecall[];
  /** Why the check produced no campaigns when status is not "ok". */
  message: string | null;
  disclaimer: string;
}

/** Wording every recall surface carries; the match is year/make/model, not VIN-exact. */
export const RECALL_MATCH_DISCLAIMER =
  "These recalls are matched by year, make, and model — not your exact VIN. " +
  "Some campaigns cover only certain production dates, plants, or trims. " +
  "Confirm whether a recall applies to your specific vehicle at nhtsa.gov/recalls.";

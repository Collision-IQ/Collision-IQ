// Orchestration for "My Vehicle" safety recalls. Pure helpers are exported
// separately from the I/O entry points so they are testable without a DB.

import type { FetchJsonWithRetryOptions } from "./client";
import { decodeVinViaVpic, VIN_SHAPE } from "./vinDecode";
import { getRecallsForVehicle } from "./recalls";
import {
  RECALL_MATCH_DISCLAIMER,
  type NhtsaRecall,
  type RecallIdentitySource,
  type RecallVehicleIdentity,
  type VehicleRecallSnapshot,
} from "./types";

/** The subset of the stored vehicle profile a recall check reads. */
export interface RecallProfileInput {
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  recalls?: VehicleRecallSnapshot | null;
}

export interface ResolvedRecallIdentity {
  identity: RecallVehicleIdentity;
  source: RecallIdentitySource;
  vin: string | null;
}

export interface RecallCheckOptions extends FetchJsonWithRetryOptions {
  now?: () => Date;
}

function cleanVin(vin: string | null | undefined): string | null {
  const v = (vin ?? "").trim().toUpperCase();
  return VIN_SHAPE.test(v) ? v : null;
}

/** Year/make/model typed into the profile, usable only when all three are present. */
export function identityFromProfile(profile: RecallProfileInput): RecallVehicleIdentity | null {
  const make = (profile.make ?? "").trim();
  const model = (profile.model ?? "").trim();
  const year = profile.year;
  if (!make || !model || typeof year !== "number" || !Number.isFinite(year)) return null;
  return { make, model, modelYear: String(Math.round(year)) };
}

/** Stable grouping key so a fleet with N vehicles but K configurations costs K NHTSA calls. */
export function identityKey(identity: RecallVehicleIdentity): string {
  return [identity.modelYear, identity.make, identity.model]
    .map((part) => part.trim().toUpperCase())
    .join("|");
}

/**
 * Resolves what to ask NHTSA about, in evidence order:
 *  1. a valid VIN decoded by vPIC (make/model/year straight from the VIN),
 *  2. the identity cached from a previous decode of the same VIN (no new call),
 *  3. the year/make/model the user typed into the profile.
 * Returns null when nothing usable exists.
 */
export async function resolveRecallIdentity(
  profile: RecallProfileInput,
  options?: RecallCheckOptions
): Promise<ResolvedRecallIdentity | null> {
  const vin = cleanVin(profile.vin);

  if (vin) {
    const cached = profile.recalls;
    if (cached?.identity && cached.identitySource === "vin_decoded" && cached.vin === vin) {
      return { identity: cached.identity, source: "vin_decoded", vin };
    }
    const decoded = await decodeVinViaVpic(vin, options);
    if (decoded.isValid && decoded.make && decoded.model && decoded.modelYear) {
      return {
        identity: { make: decoded.make, model: decoded.model, modelYear: decoded.modelYear },
        source: "vin_decoded",
        vin,
      };
    }
  }

  const fromProfile = identityFromProfile(profile);
  return fromProfile ? { identity: fromProfile, source: "profile", vin } : null;
}

export function buildRecallSnapshot(args: {
  checkedAt: Date;
  resolved: ResolvedRecallIdentity | null;
  campaigns: NhtsaRecall[];
  status?: VehicleRecallSnapshot["status"];
  message?: string | null;
}): VehicleRecallSnapshot {
  const { checkedAt, resolved, campaigns } = args;
  return {
    checkedAt: checkedAt.toISOString(),
    status: args.status ?? "ok",
    identity: resolved?.identity ?? null,
    identitySource: resolved?.source ?? null,
    vin: resolved?.vin ?? null,
    campaigns,
    message: args.message ?? null,
    disclaimer: RECALL_MATCH_DISCLAIMER,
  };
}

/**
 * On-demand check for one stored vehicle. Never throws on NHTSA failure —
 * the snapshot records the error so the UI can show "could not check" rather
 * than pretending there are no recalls.
 */
export async function checkVehicleRecalls(
  profile: RecallProfileInput,
  options?: RecallCheckOptions
): Promise<VehicleRecallSnapshot> {
  const checkedAt = (options?.now ?? (() => new Date()))();

  let resolved: ResolvedRecallIdentity | null;
  try {
    resolved = await resolveRecallIdentity(profile, options);
  } catch (error) {
    return buildRecallSnapshot({
      checkedAt,
      resolved: null,
      campaigns: [],
      status: "error",
      message: `VIN decode failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }

  if (!resolved) {
    const hasVin = !!(profile.vin ?? "").trim();
    return buildRecallSnapshot({
      checkedAt,
      resolved: null,
      campaigns: [],
      status: "unavailable",
      message: hasVin
        ? "The VIN could not be decoded. Enter the year, make, and model to check recalls."
        : "Enter a VIN, or the year, make, and model, to check recalls.",
    });
  }

  try {
    const campaigns = await getRecallsForVehicle(resolved.identity, options);
    return buildRecallSnapshot({ checkedAt, resolved, campaigns });
  } catch (error) {
    return buildRecallSnapshot({
      checkedAt,
      resolved,
      campaigns: [],
      status: "error",
      message: `NHTSA recall lookup failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}

/** Campaigns the owner has not been told about yet. */
export function selectNewCampaigns(
  campaigns: NhtsaRecall[],
  seenCampaignNumbers: readonly string[] | null | undefined
): NhtsaRecall[] {
  const seen = new Set((seenCampaignNumbers ?? []).map((n) => n.trim().toUpperCase()));
  return campaigns.filter((c) => c.campaignNumber && !seen.has(c.campaignNumber.trim().toUpperCase()));
}

/** Append newly surfaced campaign numbers to the seen list without duplicates. */
export function mergeSeenCampaignNumbers(
  existing: readonly string[] | null | undefined,
  campaigns: readonly NhtsaRecall[]
): string[] {
  const out = [...(existing ?? [])];
  const have = new Set(out.map((n) => n.trim().toUpperCase()));
  for (const c of campaigns) {
    const key = c.campaignNumber.trim().toUpperCase();
    if (key && !have.has(key)) {
      have.add(key);
      out.push(c.campaignNumber);
    }
  }
  return out;
}

export interface GroupedVehicle<T> {
  identity: RecallVehicleIdentity;
  vehicles: T[];
}

/** Group vehicles sharing a year/make/model so each configuration is queried once. */
export function groupByIdentity<T extends { identity: RecallVehicleIdentity }>(
  vehicles: readonly T[]
): GroupedVehicle<T>[] {
  const groups = new Map<string, GroupedVehicle<T>>();
  for (const v of vehicles) {
    const key = identityKey(v.identity);
    const group = groups.get(key);
    if (group) group.vehicles.push(v);
    else groups.set(key, { identity: v.identity, vehicles: [v] });
  }
  return [...groups.values()];
}

/** "2022 JEEP GRAND WAGONEER" for subjects and log lines. */
export function describeIdentity(identity: RecallVehicleIdentity): string {
  return `${identity.modelYear} ${identity.make} ${identity.model}`.replace(/\s+/g, " ").trim();
}

/**
 * Plain-text body for the weekly recall alert. Leads with the answer, keeps
 * the year/make/model caveat, and points at NHTSA's VIN-specific checker.
 */
export function buildRecallAlertText(args: {
  identity: RecallVehicleIdentity;
  campaigns: readonly NhtsaRecall[];
}): string {
  const vehicle = describeIdentity(args.identity);
  const count = args.campaigns.length;
  const lines: string[] = [
    `NHTSA has ${count === 1 ? "a new recall campaign" : `${count} new recall campaigns`} that may apply to your ${vehicle}.`,
    "",
  ];
  for (const c of args.campaigns) {
    lines.push(`Campaign ${c.campaignNumber}${c.reportReceivedDate ? ` (reported ${c.reportReceivedDate})` : ""}`);
    if (c.component) lines.push(`Component: ${c.component}`);
    if (c.summary) lines.push(`Summary: ${c.summary}`);
    if (c.consequence) lines.push(`Risk: ${c.consequence}`);
    if (c.remedy) lines.push(`Remedy: ${c.remedy}`);
    lines.push("");
  }
  lines.push(RECALL_MATCH_DISCLAIMER);
  lines.push("");
  lines.push("Open Collision iQ > My Vehicle to review the full recall list for your vehicle.");
  return lines.join("\n");
}

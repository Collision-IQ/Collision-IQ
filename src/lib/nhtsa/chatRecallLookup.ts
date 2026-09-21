// Live NHTSA recall lookup for the chat surface. A recall question never gets
// answered from model memory: the route runs this lookup and injects the
// result as evidence (NHTSA documentation tier) before the model's first pass.

import { checkVehicleRecalls, type RecallCheckOptions } from "./vehicleRecalls";
import { VIN_SHAPE } from "./vinDecode";
import type { VehicleRecallSnapshot } from "./types";

const VIN_IN_TEXT = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

/** First well-formed VIN in free text, uppercased; null when none. */
export function extractVinFromText(text: string): string | null {
  for (const match of text.toUpperCase().matchAll(VIN_IN_TEXT)) {
    const candidate = match[0];
    // A 17-char run of digits only is a claim/RO number, not a VIN.
    if (VIN_SHAPE.test(candidate) && /[A-Z]/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * True for a request to look up safety recalls. "Recall" the verb ("I don't
 * recall") never fires; the noun does when paired with a lookup cue, a VIN,
 * or a reference to the user's own vehicle.
 */
export function isRecallLookupRequest(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  // "recalled" has only the safety-recall sense ("was the airbag recalled?").
  if (/\brecalled\b/i.test(text)) return true;
  if (!/\b(?:safety\s+)?recalls?\b/i.test(text)) return false;
  if (/\b(?:i|we|you|they)\s+(?:do\s+not|don'?t|can'?t|cannot|didn'?t|did\s+not)?\s*recall\b/i.test(text)) {
    return false;
  }
  const cue =
    /\b(?:nhtsa|check|look\s*up|lookup|search|find|any|open|outstanding|active|campaign|vin|notice|bulletin|affected|subject\s+to)\b/i;
  const ownVehicle = /\b(?:my|our|this|the)\s+(?:vehicle|car|truck|suv|van|jeep|ride)\b/i;
  return cue.test(text) || ownVehicle.test(text) || extractVinFromText(text) !== null;
}

export type RecallVehicleSource = "message_vin" | "case_vehicle" | "stored_vehicle";

export interface ChatRecallLookupResult {
  snapshot: VehicleRecallSnapshot;
  vehicleSource: RecallVehicleSource;
  /** True when the vehicle checked is the user's stored My Vehicle profile. */
  usedStoredVehicle: boolean;
  /** Prompt block for the model; empty when nothing identified a vehicle. */
  context: string;
}

export interface ChatRecallVehicleHints {
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

export interface ChatRecallLookupParams {
  userMessage: string;
  /** Vehicle inferred from the turn (message, attachments, active case). */
  resolvedVehicle?: ChatRecallVehicleHints | null;
  /** The signed-in user's My Vehicle profile, if any. */
  storedProfile?: (ChatRecallVehicleHints & { recalls?: VehicleRecallSnapshot | null }) | null;
  options?: RecallCheckOptions;
}

function cleanVin(vin: string | null | undefined): string | null {
  const v = (vin ?? "").trim().toUpperCase();
  return VIN_SHAPE.test(v) ? v : null;
}

function hasTypedIdentity(v: ChatRecallVehicleHints | null | undefined): boolean {
  return !!(v && v.make?.trim() && v.model?.trim() && typeof v.year === "number");
}

/**
 * Picks the vehicle to check, in evidence order: a VIN in the message, the
 * VIN or year/make/model resolved from the case, then the stored My Vehicle
 * profile. Returns null when nothing identifies a vehicle.
 */
export function selectRecallVehicle(params: ChatRecallLookupParams): {
  input: ChatRecallVehicleHints & { recalls?: VehicleRecallSnapshot | null };
  vehicleSource: RecallVehicleSource;
  usedStoredVehicle: boolean;
} | null {
  const stored = params.storedProfile ?? null;
  const storedVin = cleanVin(stored?.vin);
  const messageVin = extractVinFromText(params.userMessage);
  if (messageVin) {
    const isStored = storedVin === messageVin;
    return {
      input: { vin: messageVin, recalls: isStored ? stored?.recalls ?? null : null },
      vehicleSource: "message_vin",
      usedStoredVehicle: isStored,
    };
  }
  const caseVin = cleanVin(params.resolvedVehicle?.vin);
  if (caseVin) {
    const isStored = storedVin === caseVin;
    return {
      input: { vin: caseVin, recalls: isStored ? stored?.recalls ?? null : null },
      vehicleSource: "case_vehicle",
      usedStoredVehicle: isStored,
    };
  }
  if (hasTypedIdentity(params.resolvedVehicle)) {
    const v = params.resolvedVehicle!;
    return {
      input: { year: v.year, make: v.make, model: v.model },
      vehicleSource: "case_vehicle",
      usedStoredVehicle: false,
    };
  }
  if (storedVin || hasTypedIdentity(stored)) {
    return {
      input: { vin: storedVin, year: stored?.year, make: stored?.make, model: stored?.model, recalls: stored?.recalls ?? null },
      vehicleSource: "stored_vehicle",
      usedStoredVehicle: true,
    };
  }
  return null;
}

const SOURCE_LABEL: Record<RecallVehicleSource, string> = {
  message_vin: "the VIN in the user's message",
  case_vehicle: "the vehicle identified from the case/attachments",
  stored_vehicle: "the user's saved My Vehicle profile",
};

/** Prompt block carrying the live result plus the rules for using it. */
export function buildRecallEvidenceContext(
  snapshot: VehicleRecallSnapshot,
  vehicleSource: RecallVehicleSource
): string {
  const lines: string[] = [
    "LIVE NHTSA RECALL LOOKUP (retrieved this turn; evidence tier: NHTSA documentation)",
    `Vehicle source: ${SOURCE_LABEL[vehicleSource]}.`,
  ];
  if (snapshot.identity) {
    lines.push(
      `Queried as: ${snapshot.identity.modelYear} ${snapshot.identity.make} ${snapshot.identity.model}` +
        (snapshot.identitySource === "vin_decoded" ? " (decoded from the VIN by NHTSA vPIC)." : " (year/make/model as entered).")
    );
  }
  if (snapshot.vin) lines.push(`VIN: ${snapshot.vin}`);
  lines.push(`Checked: ${snapshot.checkedAt}`);

  if (snapshot.status !== "ok") {
    lines.push(`Result: LOOKUP DID NOT COMPLETE — ${snapshot.message ?? "unknown reason"}.`);
    lines.push(
      "Rules: say plainly that the live NHTSA check could not be completed and why. Do NOT list recalls from memory. " +
        "Offer to retry, and point the user to nhtsa.gov/recalls for a VIN-specific check."
    );
    return lines.join("\n");
  }

  if (snapshot.campaigns.length === 0) {
    lines.push("Result: NHTSA returned no recall campaigns for this year/make/model.");
  } else {
    lines.push(`Result: ${snapshot.campaigns.length} recall campaign(s):`);
    for (const c of snapshot.campaigns) {
      lines.push(
        [
          `- Campaign ${c.campaignNumber}`,
          c.reportReceivedDate ? `(reported ${c.reportReceivedDate})` : "",
          c.component ? `| Component: ${c.component}` : "",
          c.summary ? `| Summary: ${c.summary}` : "",
          c.consequence ? `| Risk: ${c.consequence}` : "",
          c.remedy ? `| Remedy: ${c.remedy}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
  }
  lines.push(
    "Rules: answer from this lookup only — never add, remove, or embellish campaigns from memory. Lead with the answer " +
      "(how many campaigns, or none). Cite each campaign by its NHTSA campaign number. State that the match is by " +
      "year/make/model, not the exact VIN, and that some campaigns cover only certain production dates, plants, or trims; " +
      "point the user to nhtsa.gov/recalls to confirm against their exact VIN. If the campaigns are relevant to a " +
      "collision repair in the conversation, say how (e.g. a recalled component in the damage area should be addressed " +
      "before or during the repair), but do not invent repair procedures."
  );
  return lines.join("\n");
}

/**
 * Runs the live lookup for a recall question. Never throws: a failed NHTSA
 * call comes back as an error snapshot the model must report honestly.
 */
export async function runChatRecallLookup(
  params: ChatRecallLookupParams
): Promise<ChatRecallLookupResult | null> {
  const selected = selectRecallVehicle(params);
  if (!selected) return null;
  const snapshot = await checkVehicleRecalls(selected.input, params.options);
  return {
    snapshot,
    vehicleSource: selected.vehicleSource,
    usedStoredVehicle: selected.usedStoredVehicle,
    context: buildRecallEvidenceContext(snapshot, selected.vehicleSource),
  };
}

/** What the model is told when a recall question arrives with no identifiable vehicle. */
export const RECALL_NO_VEHICLE_CONTEXT =
  "LIVE NHTSA RECALL LOOKUP: not run — no VIN or year/make/model was available from the message, the case, or the " +
  "user's saved vehicle. Rules: do NOT list recalls from memory. Ask for the 17-character VIN (or year, make, and " +
  "model), or suggest saving the vehicle under My Vehicle, and note that nhtsa.gov/recalls checks an exact VIN.";

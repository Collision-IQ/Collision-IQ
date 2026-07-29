/**
 * Operation alias table — canonical operation keys for cross-carrier wording.
 *
 * Universality directive §1: this is versioned DATA, carrier/RO-agnostic and
 * ADDITIVE-ONLY. Every alias is wording observed across carriers for the SAME
 * physical operation ("BetaSeal Express Urethane" and "Urethane Kit" are both
 * the windshield urethane adhesive). Removing or renaming an entry silently
 * changes classifications on every past dispute — removals require an explicit
 * migration note in the PR.
 *
 * The matcher treats canon-key equality as a description match with a strong
 * bounded score: it lets differently-worded twins pair (so their VALUE deltas
 * surface instead of a false missing/extra pair), it never overrides part-number
 * identity, and directional (RT/LT) conflicts still disqualify upstream.
 *
 * Deliberately NOT aliased: "Reset operator preferences" vs "Reset electronics"
 * (distinct scopes — pairing them is a curated reviewer decision, never an
 * engine default).
 */

export const OPERATION_ALIASES: Record<string, string[]> = {
  SET_BACK_WIRING: [
    "SET BACK SECURE PROTECT WIRING CONNECTORS",
    "SET BACK SECURE PROTECT WIRING",
    "SET BACK WIRING CONNECTORS",
  ],
  FLEX_ADDITIVE: ["FLEX ADDITIVE PER FLEXIBLE PANEL", "FLEX ADDITIVE"],
  CAVITY_WAX: [
    "CAVITY WAX PLUS 3M 08852 PER 5 OUNCES",
    "CAVITY WAX PLUS 3M 08852",
    "CAVITY WAX",
  ],
  FEATHER_PRIME_BLOCK: [
    "FEATHER PRIME BLOCK",
    "FEATHER PRIME AND BLOCK",
    "PRIME AND BLOCK",
  ],
  TINT_COLOR: ["TINT COLOR TO MATCH", "TINT COLOR", "COLOR TINT"],
  FINISH_SAND_POLISH: [
    "FINISH SAND POLISH",
    "DENIB AND POLISH",
    "DENIB AND FINESSE",
  ],
  MASK_JAMBS: ["MASK JAMBS"],
  URETHANE_ADHESIVE: [
    "BETASEAL EXPRESS URETHANE",
    "URETHANE KIT",
    "WINDSHIELD URETHANE",
  ],
  PRE_REPAIR_SCAN: [
    "PRE REPAIR SCAN",
    "PRE REPAIR DIAGNOSTIC SCAN REPAIR FACILITY",
    "PRE REPAIR DIAGNOSTIC SCAN",
  ],
  POST_REPAIR_SCAN: [
    "POST REPAIR SCAN",
    "POST REPAIR DIAGNOSTIC SCAN REPAIR FACILITY",
    "POST REPAIR DIAGNOSTIC SCAN",
  ],
  MAINTAIN_HV_CHARGE: ["MAINTAIN HV BATTERY STATE OF CHARGE"],
};

const ALIAS_LOOKUP: Map<string, string> = new Map();
for (const [key, aliases] of Object.entries(OPERATION_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_LOOKUP.set(alias, key);
  }
}

/** Normalize a row description for alias lookup: uppercase, punctuation and
 *  qty/hour parentheticals stripped, whitespace collapsed. */
export function normalizeOperationText(description: string): string {
  return description
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical operation key for a description, or null when no alias matches.
 * Exact normalized equality only — fuzzy similarity stays the matcher's job.
 */
export function canonicalOperationKey(description: string): string | null {
  const normalized = normalizeOperationText(description);
  if (!normalized) return null;
  return ALIAS_LOOKUP.get(normalized) ?? null;
}

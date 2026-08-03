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
 *
 * The table itself lives in data/operationAliases.json so estimators can extend
 * it without a code change. Missing vocabulary is not a cosmetic gap: on RO
 * 22185 the carrier wrote "Pre-Diagnostic Scan Charge" and "Clean & Detail for
 * Delivery" where the shop wrote "Pre-repair scan" and "Clean vehicle for
 * delivery", and with no alias the pair failed to match — so the same four
 * operations were reported BOTH as missing from the carrier AND as carrier-only
 * lines, in one PDF.
 */

import ALIAS_DATA from "./data/operationAliases.json";

export const OPERATION_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALIAS_DATA as Record<string, unknown>).filter(
    (entry): entry is [string, string[]] => Array.isArray(entry[1])
  )
);

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

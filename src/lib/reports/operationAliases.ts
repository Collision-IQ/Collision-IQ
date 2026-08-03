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

/** `$`-prefixed keys are file metadata, not operations. `$comment` holds an
 *  ARRAY of prose lines, so an Array.isArray filter alone loads ten English
 *  sentences as aliases of an operation named "$comment". */
export const OPERATION_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALIAS_DATA as Record<string, unknown>).filter(
    (entry): entry is [string, string[]] => !entry[0].startsWith("$") && Array.isArray(entry[1])
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

/** Multi-word alias phrases, longest first so the most specific wording wins
 *  when several could match ("URETHANE KIT" never beats a longer phrase that
 *  contains it). Single-token aliases are excluded: one word inside a longer
 *  description is a coincidence, not an identification. */
const ALIAS_PHRASES: Array<[string, string]> = Object.entries(OPERATION_ALIASES)
  .flatMap(([key, aliases]) => aliases.map((alias): [string, string] => [alias, key]))
  .filter(([alias]) => alias.split(" ").length >= 2)
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Canonical operation key for a description, or null when no alias matches.
 *
 * Exact normalized equality first, then containment of a multi-word alias
 * phrase. Containment is NOT fuzzy similarity — that stays the matcher's job.
 * The phrase either appears as a contiguous run of tokens or it does not, so
 * the result is as deterministic as equality; it only tolerates the note text
 * producers weld onto the operation wording. RO 22059's carrier wrote
 * "Urethane Kit... BETASEAL, 3 KITS" against the shop's "BetaSeal Express
 * Urethane" — both alias wordings are already in the table, and equality alone
 * still reported the pair as one missing operation plus one carrier-only line.
 */
export function canonicalOperationKey(description: string): string | null {
  const normalized = normalizeOperationText(description);
  if (!normalized) return null;
  const exact = ALIAS_LOOKUP.get(normalized);
  if (exact) return exact;
  const padded = ` ${normalized} `;
  for (const [alias, key] of ALIAS_PHRASES) {
    if (padded.includes(` ${alias} `)) return key;
  }
  return null;
}

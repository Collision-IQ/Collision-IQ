/**
 * estimateNormalize — token repair + canonical operation keys for the delta
 * engine. Port of the adjudicated reference implementation (48/48 fixture
 * guards on the RO 22047 pair; see tests/fixtures/22047).
 *
 * WHY: a competing PDF's text layer can be corrupted at the source
 * (R&I -> "R8d", glued words with no case signal, OCR l/I confusion).
 * All matching must run on canonical keys, never raw tokens.
 */

/** Additive, versioned artifact-repair table. NEVER key entries to a carrier or RO. */
export const ARTIFACTS: ReadonlyArray<[string, string]> = [
  ["R8d", "R&I"],
  ["D8iR", "D&R"],
  ["8i", "&"],
  ["Bind", "Blnd"],
  ["AIIPurpose", "AllPurpose"], // OCR I/l confusion
  ["Removai", "Removal"],
];

/** Word-order / name-variant stems -> canonical key. Small and universal. */
const STEMS: ReadonlyArray<[string, string]> = [
  ["SANDPOLISH", "SANDPOLISH"],
  ["DENIB", "SANDPOLISH"],
  ["TINT", "COLORTINT"],
  ["MASKJAMB", "MASKJAMBS"],
  ["PREREPAIR", "PRESCAN"],
  ["POSTREPAIR", "POSTSCAN"],
  ["WHEELALIGNMENT", "ALIGNMENT"],
  ["PERFORMVEHICLEALIGNMENT", "ALIGNMENT"],
  ["CAVITYWAX", "CAVITYWAX"],
  ["MASKINGTAPE", "MASKINGTAPE"],
  ["HAZARDOUSWASTE", "HAZARDOUSWASTE"],
  // "Lift & support vehicle" vs glued "liftandsupportvehicle": the squash drops
  // "&" but keeps a literal "AND", so key on the shared stem.
  ["SUPPORTVEHICLE", "LIFTSUPPORTVEHICLE"],
];

export function repairTokens(value: string): string {
  let out = value;
  for (const [bad, good] of ARTIFACTS) out = out.split(bad).join(good);
  return out;
}

/** Normalized side of a two-sided operation — NEVER a raw vocabulary token. */
export type SideEnum = "left" | "right" | "";
/** Normalized position axis (a side group can be 2-way OR 4-way: LT/RT Front + LT/RT Rear). */
export type PositionEnum = "front" | "rear" | "upper" | "lower" | "inner" | "outer" | "";

/**
 * Side vocabulary across estimating platforms (U-1). Matched on the repaired,
 * uppercased, pre-squash string so punctuation forms ("(L)", "D/S", "Lt.")
 * still carry their boundaries. Bare DRIVER/PASSENGER are NOT side tokens —
 * "Driver assistance camera" is ADAS vocabulary, not a side; only the
 * explicit "<DRIVER|PASSENGER> SIDE" form is directional.
 */
const SIDE_SYNONYMS: ReadonlyArray<[RegExp, SideEnum]> = [
  [/\bLT\.?(?=[\s/,)]|$)/, "left"],
  [/\bLH\b/, "left"],
  [/\bLEFT\b/, "left"],
  [/\(L\)/, "left"],
  [/\bD\/S\b/, "left"],
  [/\bDRIVERS?['’]?S?\s+SIDE\b/, "left"],
  [/\bRT\.?(?=[\s/,)]|$)/, "right"],
  [/\bRH\b/, "right"],
  [/\bRIGHT\b/, "right"],
  [/\(R\)/, "right"],
  [/\bP\/S\b/, "right"],
  [/\bPASSENGERS?['’]?S?\s+SIDE\b/, "right"],
];

/** Position vocabulary; abbreviation forms normalize to the canonical token so
 * "FRT Door" and "Front Door" key identically. */
const POSITION_SYNONYMS: ReadonlyArray<[RegExp, PositionEnum, string]> = [
  [/\bFRONT\b|\bFRT\b/, "front", "FRONT"],
  [/\bREAR\b|\bRR\b/, "rear", "REAR"],
  [/\bUPPER\b|\bUPR\b/, "upper", "UPPER"],
  [/\bLOWER\b|\bLWR\b/, "lower", "LOWER"],
  [/\bINNER\b|\bINR\b/, "inner", "INNER"],
  [/\bOUTER\b|\bOTR\b/, "outer", "OUTER"],
];

/** Detect the normalized side of a raw description (exported for the group
 * layer — presentation grouping must never re-test literal LT/RT strings). */
export function detectSide(rawDesc: string): SideEnum {
  const s = ` ${repairTokens(rawDesc).toUpperCase()} `;
  for (const [pattern, side] of SIDE_SYNONYMS) if (pattern.test(s)) return side;
  // Leading bare L/R (Mitchell-style "L Fender"): first standalone token only.
  const bare = /^\s*[#*\s]*([LR])\s+[A-Z]/.exec(s.trim());
  if (bare) return bare[1] === "L" ? "left" : "right";
  return "";
}

/** Detect the normalized position axis of a raw description. */
export function detectPosition(rawDesc: string): PositionEnum {
  const s = ` ${repairTokens(rawDesc).toUpperCase()} `;
  for (const [pattern, position] of POSITION_SYNONYMS) if (pattern.test(s)) return position;
  return "";
}

export interface CanonKey {
  /** Side-insensitive, position-PRESERVING pairing key: an LT Front row must
   * pair with RT Front, never with LT Rear. */
  key: string;
  /** Side- AND position-insensitive presentation base: a 4-way group
   * (LT/RT × Front/Rear) shares one base and reports as ONE finding. */
  base: string;
  side: SideEnum;
  position: PositionEnum;
}

/**
 * Canonical key: whitespace-INSENSITIVE (glued tokens carry no case signal),
 * op-prefix stripped, part numbers and digits removed, side vocabulary
 * removed via synonym set (U-1 — never a literal LT/RT test), stems last.
 */
export function canonKey(rawDesc: string): CanonKey {
  let s = repairTokens(rawDesc).toUpperCase();
  s = s.replace(/PT\d{8}[A-Z](\d{3})?/g, "");
  s = s.replace(/^\s*[#*]+\s*/, "");
  s = s.replace(/^(R&I|RPR|REPL|BLND|REFN|SUBL|O\/H)\b/, "").trim();
  s = s.replace(/[0-9]+(\.[0-9]+)?/g, "");
  // Side + position enums from the synonym sets, on the pre-squash string
  // (punctuation forms like "(L)" and "D/S" need their boundaries intact).
  let side = detectSide(s);
  const position = detectPosition(s);
  for (const [pattern] of SIDE_SYNONYMS) s = s.replace(new RegExp(pattern.source, "g"), " ");
  s = s.replace(/^\s*[LR]\s+(?=[A-Z])/, " "); // leading bare L/R
  for (const [pattern, , canonical] of POSITION_SYNONYMS) s = s.replace(new RegExp(pattern.source, "g"), canonical);
  s = s.replace(/[^A-Z]/g, ""); // squash — drops spaces, &, punctuation
  s = s.split("INCL").join("");
  // op may still be glued at the front on corrupted docs (e.g. "RIRTBATTERY")
  for (const op of ["RI", "RPR", "REPL", "BLND", "REFN", "SUBL", "OH"]) {
    if (s.startsWith(op) && s.length > op.length + 2) {
      s = s.slice(op.length);
      break;
    }
  }
  for (const [stem, canon] of STEMS) if (s.includes(stem)) return { key: canon, base: canon, side: "", position: "" };
  // Glued corrupted docs ("RTBATTERY" with no boundaries) evade the synonym
  // pass — fall back to the squashed-prefix test.
  if (!side && s.startsWith("RT")) {
    side = "right";
    s = s.slice(2);
  } else if (!side && s.startsWith("LT")) {
    side = "left";
    s = s.slice(2);
  }
  const positionToken = POSITION_SYNONYMS.find(([, p]) => p === position)?.[2] ?? "";
  const base = positionToken ? s.split(positionToken).join("") : s;
  return { key: s, base, side, position };
}

/** Truncate any trailing NOTE text before keying — notes must never enter keys. */
export function stripNote(desc: string): string {
  return desc.split(/\bnote\b/i)[0].trim();
}

/** Precise CCC part pattern; strips a glued qty digit (suffix must be exactly 3 digits). */
export function extractPart(token: string): { part: string | null; trailing: string } {
  const repaired = repairTokens(token);
  const match = /PT\d{8}[A-Z](\d{3})?/.exec(repaired);
  if (!match) return { part: null, trailing: "" };
  const part = match[1] ? match[0] : /PT\d{8}[A-Z]/.exec(match[0])![0];
  return { part, trailing: repaired.slice(match.index + match[0].length) };
}

/** Totals category aliases (name variants across estimating exports). */
export const TOTALS_ALIASES: Record<string, string> = {
  ALUMINUM: "ALUMINUMORSTEELREPAIR",
};

export function canonTotalsCategory(name: string): string {
  const key = canonKey(name).key;
  return TOTALS_ALIASES[key] ?? key;
}

/** Corruption detector: rate of known artifacts per 100 words -> degraded-text tag. */
export function corruptionRate(words: string[]): number {
  let hits = 0;
  for (const word of words) {
    for (const [bad] of ARTIFACTS) {
      if (word.includes(bad)) {
        hits += 1;
        break;
      }
    }
  }
  return words.length ? (hits / words.length) * 100 : 0;
}

export const DEGRADED_THRESHOLD_PCT = 0.5; // tag document + widen fuzzy band above this

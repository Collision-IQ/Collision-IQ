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

export interface CanonKey {
  key: string;
  side: "RT" | "LT" | "";
}

/**
 * Canonical key: whitespace-INSENSITIVE (glued tokens carry no case signal),
 * op-prefix stripped, part numbers and digits removed, stems applied last.
 */
export function canonKey(rawDesc: string): CanonKey {
  let s = repairTokens(rawDesc).toUpperCase();
  s = s.replace(/PT\d{8}[A-Z](\d{3})?/g, "");
  s = s.replace(/^\s*[#*]+\s*/, "");
  s = s.replace(/^(R&I|RPR|REPL|BLND|REFN|SUBL|O\/H)\b/, "").trim();
  s = s.replace(/[0-9]+(\.[0-9]+)?/g, "");
  s = s.replace(/[^A-Z]/g, ""); // squash — drops spaces, &, punctuation
  s = s.split("INCL").join("");
  // op may still be glued at the front on corrupted docs (e.g. "RIRTBATTERY")
  for (const op of ["RI", "RPR", "REPL", "BLND", "REFN", "SUBL", "OH"]) {
    if (s.startsWith(op) && s.length > op.length + 2) {
      s = s.slice(op.length);
      break;
    }
  }
  for (const [stem, canon] of STEMS) if (s.includes(stem)) return { key: canon, side: "" };
  let side: CanonKey["side"] = "";
  if (s.startsWith("RT")) {
    side = "RT";
    s = s.slice(2);
  } else if (s.startsWith("LT")) {
    side = "LT";
    s = s.slice(2);
  }
  return { key: s, side };
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

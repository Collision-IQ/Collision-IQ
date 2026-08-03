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

/**
 * Repair vocabulary (U-4): the tokens a collision estimate is KNOWN to carry —
 * operation codes and structural markers. Confusable repair aligns broken
 * tokens against THIS list; it never grows per-carrier entries.
 */
const REPAIR_VOCABULARY: ReadonlyArray<string> = [
  "R&I",
  "R&R",
  "Rpr",
  "Repl",
  "Blnd",
  "Refn",
  "Subl",
  "O/H",
  "Algn",
  "Add",
  "D&R",
  "Incl.",
  "Incl",
  "Note",
  "SUBTOTALS",
];

/** Document-scoped repairs learned from the file's own vocabulary (U-4).
 * Installed by the parser for the duration of one document's parse. */
let activeDocumentRepairs: ReadonlyArray<[string, string]> = [];

export function withDocumentRepairs<T>(repairs: ReadonlyArray<[string, string]>, run: () => T): T {
  const previous = activeDocumentRepairs;
  activeDocumentRepairs = repairs;
  try {
    return run();
  } finally {
    activeDocumentRepairs = previous;
  }
}

/**
 * Learn confusable repairs from the document's own token stream (U-4): a
 * broken text layer (non-embedded font, no ToUnicode) mangles glyphs
 * CONSISTENTLY, so a frequent unknown token that aligns to a vocabulary word
 * by common prefix/suffix with a short differing middle ("R8d"→"R&I" via
 * "8d"→"&I", "D8iR"→"D&R" via "8i"→"&", "Bind"→"Blnd" via "i"→"l") is that
 * word. Whole-token rules only, minimum 3 occurrences, minimum 3 chars —
 * a one-off description word never becomes a rule.
 */
export function learnConfusableRepairs(tokens: ReadonlyArray<string>): Array<[string, string]> {
  const counts = new Map<string, number>();
  for (const raw of tokens) {
    const token = raw.trim();
    if (token.length < 3 || token.length > 6) continue;
    if (/^[\d.,$%()-]+$/.test(token)) continue; // numeric cells are never op codes
    if (token === token.toLowerCase()) continue; // prose words are never op codes
    if (/^[A-Z]+$/.test(token)) continue; // ALL-CAPS letters = section header vocabulary, not a broken op code
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const vocab = new Set(REPAIR_VOCABULARY.map((word) => word.toUpperCase()));
  const learned: Array<[string, string]> = [];
  for (const [token, count] of counts) {
    if (count < 3) continue;
    if (vocab.has(token.toUpperCase())) continue;
    for (const word of REPAIR_VOCABULARY) {
      if (Math.abs(word.length - token.length) > 1) continue;
      let prefix = 0;
      while (prefix < token.length && prefix < word.length && token[prefix].toUpperCase() === word[prefix].toUpperCase()) prefix += 1;
      let suffix = 0;
      while (
        suffix < token.length - prefix &&
        suffix < word.length - prefix &&
        token[token.length - 1 - suffix].toUpperCase() === word[word.length - 1 - suffix].toUpperCase()
      )
        suffix += 1;
      const tokenMid = token.slice(prefix, token.length - suffix);
      const wordMid = word.slice(prefix, word.length - suffix);
      // Aligned when the shared shell covers at least half the vocab word and
      // the differing middle is a 1–2 glyph perturbation on both sides.
      if (
        prefix + suffix >= Math.ceil(word.length / 2) &&
        tokenMid.length >= 1 &&
        tokenMid.length <= 2 &&
        wordMid.length >= 1 &&
        wordMid.length <= 2 &&
        tokenMid !== wordMid
      ) {
        learned.push([token, word]);
        break;
      }
    }
  }
  return learned;
}

export function repairTokens(value: string): string {
  let out = value;
  for (const [bad, good] of ARTIFACTS) out = out.split(bad).join(good);
  for (const [bad, good] of activeDocumentRepairs) out = out.split(bad).join(good);
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

/**
 * IDENTIFIERS ARE ATOMIC.
 *
 * A description token that ends in a manufacturer prefix — a word stem, a
 * hyphen, then a short alphanumeric brand group carrying a letter
 * ("Adhesive-3M", "Masking Tape-3M", "Seam Sealer-SEM") — begins a product
 * identifier whose number prints as the NEXT token. That number belongs to the
 * identifier and can never be a numeric column: RO 22182 line 118 read the 3M
 * product number 07333 as 7,333.0 body labor hours against a document
 * declaring 85.6 in total.
 *
 * The pattern deliberately excludes bare part numbers ("PT00015376B001",
 * "445539221", "1063943-00-A"): those are complete identifiers on their own,
 * and the token that follows them is the real qty column.
 */
const MANUFACTURER_PREFIXED = /^[A-Za-z][A-Za-z]*-\d*[A-Za-z][A-Za-z0-9]{0,4}$/;

export function isManufacturerPrefixedIdentifier(token: string): boolean {
  return MANUFACTURER_PREFIXED.test(token.trim());
}

/**
 * True when `token` continues an identifier rather than opening a value cell.
 * Two independent grounds, both document-agnostic:
 *  (a) the preceding token ended in a manufacturer prefix, so this is its
 *      product number ("Adhesive-3M" -> "07333");
 *  (b) the token is a leading-zero integer. A quantity, a money amount, and an
 *      hours cell are never printed with a leading zero before a nonzero
 *      digit, so "07333" is catalog notation wherever it appears.
 */
export function continuesIdentifier(previousToken: string | undefined, token: string): boolean {
  if (/^0\d+$/.test(token)) return true;
  if (!previousToken) return false;
  return isManufacturerPrefixedIdentifier(previousToken) && /^\d[\dA-Za-z-]*$/.test(token);
}

/** Precise CCC part pattern; strips a glued qty digit (suffix must be exactly 3 digits). */
export function extractPart(token: string): { part: string | null; trailing: string } {
  const repaired = repairTokens(token);
  const match = /PT\d{8}[A-Z](\d{3})?/.exec(repaired);
  if (!match) return { part: null, trailing: "" };
  const part = match[1] ? match[0] : /PT\d{8}[A-Z]/.exec(match[0])![0];
  return { part, trailing: repaired.slice(match.index + match[0].length) };
}

/**
 * Structural totals-category normalization (U-2): never a literal alias
 * table. (a) casefold + squash, (b) strip noise suffixes iteratively
 * (Labor / Repair / Charges / Or Steel / Fees), (c) MATERIALS ≡ SUPPLIES,
 * (d) map the stripped core onto a canonical CONCEPT. Unresolved labels keep
 * their stripped core and report `concept: false` so the caller can surface
 * an `unmapped_category` warning instead of silently mis-pairing.
 */
const CATEGORY_NOISE_SUFFIXES = ["LABOR", "REPAIR", "CHARGES", "ORSTEEL", "FEES", "REPLACE"] as const;

const CATEGORY_CONCEPTS: Record<string, string> = {
  BODY: "BODY",
  PAINT: "PAINT",
  REFINISH: "PAINT",
  MECHANICAL: "MECHANICAL",
  MECH: "MECHANICAL",
  ELECTRICAL: "ELECTRICAL",
  FRAME: "FRAME",
  STRUCTURAL: "FRAME",
  STRUCTURE: "FRAME",
  ALUMINUM: "ALUMINUM",
  BONDEDORWELDEDPANEL: "BONDEDORWELDEDPANEL",
  BONDEDPANEL: "BONDEDORWELDEDPANEL",
  WELDEDPANEL: "BONDEDORWELDEDPANEL",
  GLASS: "GLASS",
  DIAGNOSTIC: "DIAGNOSTIC",
  DIAG: "DIAGNOSTIC",
  SUBLET: "SUBLET",
  TOWING: "TOWING",
  TOW: "TOWING",
  STORAGE: "STORAGE",
  BETTERMENT: "BETTERMENT",
  APPEARANCEALLOWANCE: "APPEARANCEALLOWANCE",
  PAINTSUPPLIES: "PAINTSUPPLIES",
  REFINISHSUPPLIES: "PAINTSUPPLIES",
  PANDM: "PAINTSUPPLIES",
  PM: "PAINTSUPPLIES",
  SHOPSUPPLIES: "SHOPSUPPLIES",
  BODYSUPPLIES: "SHOPSUPPLIES",
  HAZARDOUSWASTE: "HAZARDOUSWASTE",
  HAZMAT: "HAZARDOUSWASTE",
  PARTS: "PARTS",
  MISCELLANEOUS: "MISCELLANEOUS",
  MISC: "MISCELLANEOUS",
  NONTAXABLE: "NONTAXABLE",
};

export function canonTotalsCategoryDetailed(name: string): { key: string; concept: boolean } {
  let key = repairTokens(name).toUpperCase().replace(/&/g, "AND").replace(/[^A-Z]/g, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of CATEGORY_NOISE_SUFFIXES) {
      if (key.length > suffix.length && key.endsWith(suffix)) {
        key = key.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  key = key.replace(/MATERIALS?$/, "SUPPLIES");
  const concept = CATEGORY_CONCEPTS[key];
  return concept ? { key: concept, concept: true } : { key, concept: false };
}

export function canonTotalsCategory(name: string): string {
  return canonTotalsCategoryDetailed(name).key;
}

/**
 * Fuzzy last-resort category match (U-2 step d): containment of one stripped
 * core in the other, both long enough to be meaningful. Runs only after
 * concept resolution fails on BOTH sides.
 */
export function totalsCategoriesFuzzyMatch(a: string, b: string): boolean {
  const ka = canonTotalsCategoryDetailed(a);
  const kb = canonTotalsCategoryDetailed(b);
  if (ka.key === kb.key) return true;
  if (ka.concept || kb.concept) return false; // concepts either matched exactly or differ
  return ka.key.length >= 5 && kb.key.length >= 5 && (ka.key.includes(kb.key) || kb.key.includes(ka.key));
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

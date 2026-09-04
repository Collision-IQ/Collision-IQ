/**
 * Rekey vocabulary resolvers — Mitchell/platform wording to CCC ONE keying
 * vocabulary and CIECA EMS v2.01 codes (WO-RK1 §3.3).
 *
 * The estimator's rekey time is mostly TRANSLATION, not typing: finding which
 * CCC operation, part type and group a Mitchell line belongs to. These
 * resolvers do that translation once, deterministically, from a data table.
 *
 * Two rules the design turns on:
 *
 * 1. NOTHING IS GUESSED. A term absent from the table resolves to UNMAPPED and
 *    is carried through verbatim with a flag, so the estimator sees the source
 *    wording and decides. Inventing a CCC group for an unrecognized section
 *    would put a line in the wrong place silently — worse than saying so.
 *
 * 2. OPERATIONS ARE ANCHORED AT THE HEAD. "Repair" is an operation when it
 *    opens the description and a description word anywhere else ("Repair kit",
 *    "Bumper repair bracket"). Aliases are tried longest-first, at position 0.
 *
 * The table itself lives in data/rekeyVocabulary.json so estimators can extend
 * it without a code change (same contract as operationAliases.json).
 */

import VOCABULARY from "./data/rekeyVocabulary.json";

export const UNMAPPED = "UNMAPPED" as const;

type OperationEntry = {
  ccc: string;
  laborOpCode: string | null;
  aliases: string[];
  refinishOnly?: boolean;
  sublet?: boolean;
  manualEntry?: boolean;
};

type PartTypeEntry = {
  ccc: string;
  ems: string | null;
  aliases: string[];
  laborOnly?: boolean;
  miscOnly?: boolean;
};

type SectionGroupEntry = {
  group: string;
  aliases: string[];
  conditionalDiagnostics?: boolean;
};

const OPERATIONS = VOCABULARY.operations as OperationEntry[];
const PART_TYPES = VOCABULARY.partTypes as PartTypeEntry[];
const LABOR_TYPES = VOCABULARY.laborTypes as Array<{ ccc: string; aliases: string[] }>;
const SECTION_GROUPS = VOCABULARY.sectionGroups as SectionGroupEntry[];
const KNOWN_CCC_GROUPS = VOCABULARY.knownCccGroups as string[];
const GROUP_ORDER = VOCABULARY.groupOrder as string[];
const DIAGNOSTICS_KEYWORDS = VOCABULARY.diagnosticsKeywords as string[];

/** Uppercase, punctuation collapsed to single spaces, whitespace collapsed. */
export function normalizeVocabularyText(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alias index sorted longest-first so the most specific wording always wins. */
function aliasIndex<T>(entries: T[], aliasesOf: (entry: T) => string[]): Array<[string, T]> {
  return entries
    .flatMap((entry) => aliasesOf(entry).map((alias): [string, T] => [normalizeVocabularyText(alias), entry]))
    .sort((a, b) => b[0].length - a[0].length);
}

const OPERATION_ALIAS_INDEX = aliasIndex(OPERATIONS, (entry) => entry.aliases);
const PART_TYPE_ALIAS_INDEX = aliasIndex(PART_TYPES, (entry) => entry.aliases);
const LABOR_TYPE_ALIAS_INDEX = aliasIndex(LABOR_TYPES, (entry) => entry.aliases);
const SECTION_GROUP_ALIAS_INDEX = aliasIndex(SECTION_GROUPS, (entry) => entry.aliases);

export interface ResolvedOperation {
  /** CCC operation as the estimator keys it, or UNMAPPED. */
  ccc: string;
  /** EMS `LBR_OP` code when the platform defines one for this operation. */
  laborOpCode: string | null;
  /** Source wording that produced the mapping ("Remove / Replace"). */
  sourceLabel: string | null;
  /** Description with the operation phrase removed, when it was read off the head. */
  description: string;
  mapped: boolean;
  refinishOnly: boolean;
  sublet: boolean;
  manualEntry: boolean;
}

/**
 * Resolve a row's operation.
 *
 * A parsed `opCode` means the document already speaks CCC vocabulary (the
 * shared extractor only recognizes CCC op codes), so it passes through as the
 * operation itself and the table is consulted only for the EMS labor-op code.
 * Mitchell prints the operation as words instead, so with no `opCode` the
 * description head is matched against the alias table.
 */
export function resolveOperation(params: {
  opCode?: string | null;
  description: string;
}): ResolvedOperation {
  const description = (params.description ?? "").trim();
  const opCode = (params.opCode ?? "").trim();

  if (opCode) {
    const entry = OPERATION_ALIAS_INDEX.find(([alias]) => alias === normalizeVocabularyText(opCode));
    return {
      ccc: opCode,
      laborOpCode: entry?.[1].laborOpCode ?? null,
      sourceLabel: opCode,
      description,
      mapped: true,
      refinishOnly: entry?.[1].refinishOnly === true,
      sublet: entry?.[1].sublet === true,
      manualEntry: entry?.[1].manualEntry === true,
    };
  }

  const normalized = normalizeVocabularyText(description);
  for (const [alias, entry] of OPERATION_ALIAS_INDEX) {
    if (!alias) continue;
    if (normalized !== alias && !normalized.startsWith(`${alias} `)) continue;
    // Cut the same number of source words the alias consumed, so the remaining
    // description keeps its original punctuation and casing.
    const wordCount = alias.split(" ").length;
    return {
      ccc: entry.ccc,
      laborOpCode: entry.laborOpCode,
      sourceLabel: dropLeadingWords(description, 0, wordCount).consumed,
      description: dropLeadingWords(description, 0, wordCount).rest,
      mapped: true,
      refinishOnly: entry.refinishOnly === true,
      sublet: entry.sublet === true,
      manualEntry: entry.manualEntry === true,
    };
  }

  return {
    ccc: UNMAPPED,
    laborOpCode: null,
    sourceLabel: null,
    description,
    mapped: false,
    refinishOnly: false,
    sublet: false,
    manualEntry: false,
  };
}

/**
 * Consume `count` NORMALIZED words off the head of `text`, returning the raw
 * source span consumed and the remainder. Normalization collapses punctuation
 * ("Remove / Replace" is two words), so the walk counts alphanumeric runs.
 */
function dropLeadingWords(text: string, start: number, count: number): { consumed: string; rest: string } {
  let index = start;
  let words = 0;
  while (index < text.length && words < count) {
    while (index < text.length && !/[A-Za-z0-9]/.test(text[index])) index += 1;
    while (index < text.length && /[A-Za-z0-9]/.test(text[index])) index += 1;
    words += 1;
  }
  return { consumed: text.slice(start, index).trim(), rest: text.slice(index).replace(/^[^A-Za-z0-9]+/, "").trim() };
}

export interface ResolvedPartType {
  ccc: string;
  ems: string | null;
  sourceLabel: string | null;
  mapped: boolean;
  /** "Existing" — the line bills labor against a part already on the vehicle. */
  laborOnly: boolean;
  /** Sublet — booked as a misc amount, never as a part. */
  miscOnly: boolean;
}

/**
 * Resolve a part type from the provenance tokens the shared extractor already
 * reads off the row, falling back to the row text.
 *
 * An absent provenance token is itself a claim on both platforms: a part line
 * with a part number and no qualifier is a NEW OEM part. That inference is the
 * platform's own printing convention, not a guess — but it only applies when
 * the row actually carries a part number.
 */
export function resolvePartType(params: {
  partSourceTokens?: string[] | null;
  rawText?: string | null;
  hasPartNumber: boolean;
}): ResolvedPartType {
  const candidates = [...(params.partSourceTokens ?? []), params.rawText ?? ""]
    .map((candidate) => normalizeVocabularyText(candidate))
    .filter(Boolean);

  // Aliases are tried LONGEST FIRST across every candidate, not
  // candidate-by-candidate: "Aftermarket Certified" and "A/M" both appear on
  // the same row, and the specific one is the true part type. Taking the first
  // candidate's first hit would key a CAPA-certified part as plain
  // aftermarket, which is a different part at a different price.
  for (const [alias, entry] of PART_TYPE_ALIAS_INDEX) {
    if (!alias) continue;
    const hit = candidates.some(
      (candidate) => candidate === alias || ` ${candidate} `.includes(` ${alias} `)
    );
    if (!hit) continue;
    return {
      ccc: entry.ccc,
      ems: entry.ems,
      sourceLabel: alias,
      mapped: true,
      laborOnly: entry.laborOnly === true,
      miscOnly: entry.miscOnly === true,
    };
  }

  if (params.hasPartNumber) {
    const oem = PART_TYPES.find((entry) => entry.ccc === "OEM");
    return {
      ccc: oem?.ccc ?? UNMAPPED,
      ems: oem?.ems ?? null,
      sourceLabel: null,
      mapped: Boolean(oem),
      laborOnly: false,
      miscOnly: false,
    };
  }

  return { ccc: UNMAPPED, ems: null, sourceLabel: null, mapped: false, laborOnly: false, miscOnly: false };
}

/**
 * Remove part-type wording printed at the END of a description.
 *
 * Part type is a COLUMN on both platforms ("Hood Panel Alum · New", "Grille ·
 * Aftermarket Certified"), and a text extraction welds that column onto the
 * description. It is resolved into its own field, so leaving it in the
 * description double-counts it: the same operation reads as two different
 * descriptions across two platforms that print the type differently, and the
 * line is then reported as both missing and extra.
 *
 * Only a TRAILING phrase is removed, and repeatedly, so a stacked qualifier
 * ("Grille A/M CAPA") is fully unwound while a description that merely
 * contains the word keeps it.
 */
export function stripTrailingPartTypeWording(description: string): string {
  let current = (description ?? "").trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const normalized = normalizeVocabularyText(current);
    if (!normalized) return current;
    const alias = PART_TYPE_ALIAS_INDEX.map(([candidate]) => candidate).find(
      (candidate) => candidate && (normalized === candidate || normalized.endsWith(` ${candidate}`))
    );
    if (!alias) return current;
    const wordCount = alias.split(" ").length;
    const trimmed = dropTrailingWords(current, wordCount).trim();
    // Never strip the whole description away — a row described only by its
    // part type still needs a description to key.
    if (!trimmed) return current;
    current = trimmed;
  }
  return current;
}

/** Drop `count` trailing alphanumeric words, preserving the source's spacing. */
function dropTrailingWords(text: string, count: number): string {
  let index = text.length;
  let words = 0;
  while (index > 0 && words < count) {
    while (index > 0 && !/[A-Za-z0-9]/.test(text[index - 1])) index -= 1;
    while (index > 0 && /[A-Za-z0-9]/.test(text[index - 1])) index -= 1;
    words += 1;
  }
  return text.slice(0, index).replace(/[^A-Za-z0-9)\]]+$/, "");
}

/** Body→LAB, Refinish→LAR, Mechanical→LAM. Unknown markers stay unresolved. */
export function resolveLaborType(label: string | null | undefined): string | null {
  const normalized = normalizeVocabularyText(label);
  if (!normalized) return null;
  const entry = LABOR_TYPE_ALIAS_INDEX.find(([alias]) => alias === normalized);
  return entry ? entry[1].ccc : null;
}

export interface ResolvedSectionGroup {
  group: string;
  mapped: boolean;
  /** Source section name, always carried so an UNMAPPED group is still usable. */
  sourceSection: string | null;
}

/**
 * Resolve a source section name to a CCC group.
 *
 * The three catch-all sections ("Additional Costs & Materials", "Additional
 * Operations", "Special / Manual Entry") split on the ROW: scan, calibration
 * and reset operations belong in VEHICLE DIAGNOSTICS, everything else in
 * MISCELLANEOUS OPERATIONS — so the row description is part of the input.
 */
export function resolveSectionGroup(params: {
  section: string | null | undefined;
  description?: string | null;
}): ResolvedSectionGroup {
  const section = (params.section ?? "").trim() || null;
  const normalized = normalizeVocabularyText(section);
  if (!normalized) return { group: UNMAPPED, mapped: false, sourceSection: section };

  for (const [alias, entry] of SECTION_GROUP_ALIAS_INDEX) {
    if (!alias) continue;
    const padded = ` ${normalized} `;
    if (normalized !== alias && !padded.includes(` ${alias} `)) continue;
    if (entry.conditionalDiagnostics && isDiagnosticsOperation(params.description)) {
      return { group: "VEHICLE DIAGNOSTICS", mapped: true, sourceSection: section };
    }
    return { group: entry.group, mapped: true, sourceSection: section };
  }

  // An exact match against a CCC group name is identity, not inference.
  const identity = KNOWN_CCC_GROUPS.find((group) => normalizeVocabularyText(group) === normalized);
  if (identity) return { group: identity, mapped: true, sourceSection: section };

  return { group: UNMAPPED, mapped: false, sourceSection: section };
}

/** Scan / calibration / reset work, which CCC groups under VEHICLE DIAGNOSTICS. */
export function isDiagnosticsOperation(description: string | null | undefined): boolean {
  const normalized = normalizeVocabularyText(description);
  if (!normalized) return false;
  const padded = ` ${normalized} `;
  return DIAGNOSTICS_KEYWORDS.some((keyword) => padded.includes(` ${normalizeVocabularyText(keyword)} `));
}

/** CCC group print order; unmapped and unlisted groups sort last, stably. */
export function groupSortIndex(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

export const REKEY_GROUP_ORDER: ReadonlyArray<string> = GROUP_ORDER;

/* ------------------------------------------------------------------ *
 * MOTOR <-> CEG part nomenclature (WO-RK1 v3)
 *
 * The two estimating databases give the same physical part different
 * names. MOTOR prints "Side support", CEG prints "Frt Bumper Cover
 * Support"; the estimator keyed one line, but the two descriptions key
 * differently, so the verification pass reported the line TWICE — once as
 * never keyed, once as keyed but not in the source. That is the same
 * double-report failure the operation-free description key already exists
 * to prevent, one layer deeper: there the wording differed by operation,
 * here it differs by database.
 *
 * This is deliberately the LAST description-level resolver. Part number
 * and the two description keys run first and are exact; nomenclature only
 * ever sees lines those passes could not place, so it can convert an
 * unmatched line into a pair but can never take a pair away from an exact
 * key.
 *
 * Scope, side and operation gates keep it from inventing pairs — see
 * `nomenclatureMatchScore`. Everything the table knows is in
 * data/rekeyVocabulary.json and every entry names the document that proved
 * it; nothing here is assumed.
 * ------------------------------------------------------------------ */

type NomenclatureEntry = {
  canonical: string;
  synonyms: string[];
  scope?: string;
  fixture?: string;
};

const NOMENCLATURE = VOCABULARY.partNomenclature as {
  sideTokens: string[];
  noiseTokens: string[];
  abbreviations: Record<string, string>;
  entries: NomenclatureEntry[];
};

const NOMENCLATURE_SIDE_TOKENS = new Set(NOMENCLATURE.sideTokens.map(normalizeVocabularyText));
const NOMENCLATURE_NOISE_TOKENS = new Set(NOMENCLATURE.noiseTokens.map(normalizeVocabularyText));
const NOMENCLATURE_ABBREVIATIONS = new Map<string, string>(
  Object.entries(NOMENCLATURE.abbreviations).map(([from, to]) => [
    normalizeVocabularyText(from),
    normalizeVocabularyText(to),
  ])
);

/** Every synonym phrase (and each canonical, implied) indexed to its entry,
 *  longest phrase first so the most specific naming always wins. */
const NOMENCLATURE_PHRASE_INDEX: Array<[string, NomenclatureEntry]> = NOMENCLATURE.entries
  .flatMap((entry): Array<[string, NomenclatureEntry]> =>
    [entry.canonical, ...entry.synonyms].map((phrase) => [normalizeVocabularyText(phrase), entry])
  )
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Remove a trailing print artifact from a description.
 *
 * CCC appends free text after " - " and truncates a parenthetical at the
 * column width ("Mask jambs (0.3 Hours and $3.00 per pane"). Neither is part
 * of the part's name — they are what the PRINT did to it — so both are cut
 * before the name is read. Document-shape only; no carrier wording.
 *
 * Distinct from the delta engine's `stripNote`, which cuts at the word
 * "note"; this cuts the two artifacts the estimate print itself introduces.
 */
export function stripPrintArtifacts(description: string | null | undefined): string {
  return (description ?? "").replace(/\s+-\s+.*$|\s*\(.*$/, "").trim();
}

/** A side word at the head of a description, built from the table's own side
 *  tokens. It must be followed by WHITESPACE: "R&I headlamp" opens with an
 *  operation whose first letter is a side word, and cutting the R off it would
 *  leave the operation unreadable. */
const LEADING_SIDE_WORD = new RegExp(
  `^\\s*(?:${NOMENCLATURE.sideTokens
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((token) => escapeRegExp(token))
    .join("|")})\\s+`,
  "i"
);

/**
 * Reduce a description to the tokens that carry its NAME: print artifacts
 * cut, leading operation removed, side words and noise dropped, abbreviations
 * expanded. "LT R&I headlamp assy" and "L Front Combination Lamp" both come
 * back as the tokens their databases disagree about, and nothing else.
 *
 * The leading side word comes off BEFORE the operation is read, because the
 * platforms print them in that order ("LT R&I headlamp assy") and the
 * operation resolver anchors at the head — with the side word still there it
 * would find no operation at all.
 */
function nomenclatureTokens(description: string | null | undefined): string[] {
  const named = stripPrintArtifacts(description).replace(LEADING_SIDE_WORD, "");
  const withoutOperation = resolveOperation({ description: named }).description;
  return normalizeVocabularyText(withoutOperation)
    .split(" ")
    .filter(Boolean)
    .map((token) => NOMENCLATURE_ABBREVIATIONS.get(token) ?? token)
    .filter((token) => !NOMENCLATURE_SIDE_TOKENS.has(token) && !NOMENCLATURE_NOISE_TOKENS.has(token));
}

/**
 * Rewrite a description's tokens through the nomenclature table.
 *
 * A scope is satisfied when EITHER line's group is the scoped group, or is
 * UNMAPPED — a Mitchell section with no CCC counterpart must not be barred
 * from a table its own group cannot name. With no group on either side there
 * is nothing to gate against, so the scope is not enforced; the rekey ledger
 * always carries a group (UNMAPPED at worst), so that case does not arise
 * here and exists only so a caller without groups still gets an answer.
 */
export function canonicalizeNomenclature(
  description: string | null | undefined,
  group: string | null | undefined,
  otherGroup?: string | null | undefined
): string[] {
  const groups = [group, otherGroup].map((value) => normalizeVocabularyText(value ?? "")).filter(Boolean);
  let phrase = nomenclatureTokens(description).join(" ");
  if (!phrase) return [];
  for (const [synonym, entry] of NOMENCLATURE_PHRASE_INDEX) {
    if (!phrase.includes(synonym)) continue;
    const scope = normalizeVocabularyText(entry.scope ?? "");
    if (scope && groups.length > 0 && !groups.some((value) => value === scope || value === UNMAPPED)) continue;
    phrase = phrase.replace(new RegExp(`(?<![A-Z0-9])${escapeRegExp(synonym)}(?![A-Z0-9])`, "g"), normalizeVocabularyText(entry.canonical));
  }
  return phrase.split(" ").filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Token overlap between two canonicalized names, scored against the SHORTER
 * name and gated by the longer one.
 *
 * Scoring against the shorter name is what lets "Finish sand & polish" pair
 * with "Sand & polish" — one database prints a qualifier the other does not.
 * The gate against the longer name is what stops that generosity from pairing
 * a two-word name with any long description that happens to contain it.
 */
export function nomenclatureOverlap(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  if (shared / Math.max(left.size, right.size) < 0.4) return 0;
  return shared / Math.min(left.size, right.size);
}

/** Overlap at or above which two differently-named lines are the same line. */
export const NOMENCLATURE_MATCH_THRESHOLD = 0.6;

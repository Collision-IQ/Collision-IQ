/**
 * Structured line-item matching for the Delta Citation Density Report.
 *
 * This module parses two collision estimates (a "lower" / source estimate that
 * will be annotated, and a "higher" / comparison estimate) into structured rows,
 * then pairs rows by part number / description / line number and classifies the
 * difference as a missing operation, reduced labor, reduced paint, or a
 * part/price difference.
 *
 * It deliberately does NOT depend on the PDF coordinate machinery or the large
 * annotation file so it can be unit-tested in isolation. The annotation layer
 * adapts already-parsed `EstimateRowAnchor` rows into `EstimateDeltaRow` via
 * `deltaRowFromRawText`, and parses the comparison estimate text via
 * `parseCccEstimateRows`.
 */

export type EstimateDeltaRowSource = "lower" | "higher";

export interface EstimateDeltaRow {
  /** CCC estimate line number when present (not reliable across supplements). */
  lineNumber: number | null;
  /** Operation code (R&I, Repl, Rpr, Blnd, Subl, Refn, Algn, Add, O/H, Overlap). */
  opCode: string | null;
  /** Cleaned human description, e.g. "Windshield GMC w/o video display". */
  description: string;
  /** Normalized description token list used for matching. */
  descriptionTokens: string[];
  /** Part number when present, e.g. "GM1144143", "C25J75". */
  partNumber: string | null;
  /** Section header the row sits under, e.g. "REAR BUMPER". */
  section: string | null;
  qty: number | null;
  /** Extended price in dollars. */
  price: number | null;
  /** Body labor hours; null when the cell reads "Incl."/blank. */
  labor: number | null;
  laborIncluded: boolean;
  /** Paint/refinish hours; null when the cell reads "Incl."/blank. */
  paint: number | null;
  paintIncluded: boolean;
  /**
   * Labor-type column letter printed beside the hours (M=mechanical,
   * D=diagnostic, E=electrical, F=frame, G=glass, S=structural). Null/absent
   * means the default body-labor category.
   */
  laborType?: string | null;
  rawText: string;
  /** Opaque identifier carried through from a source PDF row anchor. */
  anchorId?: string;
  pageNumber?: number | null;
}

export type EstimateDeltaKind =
  | "missing_operation"
  | "expanded_scope"
  | "operation_change"
  | "reduced_labor"
  | "reduced_paint"
  | "part_or_price_difference";

/**
 * Status labels for an OCR-driven confidence downgrade. When the lower estimate
 * is machine-read from an image-only PDF, an unmatched line cannot be a
 * *confirmed* omission — OCR may have dropped or garbled it.
 */
export const OCR_UNCERTAIN_STATUS_LABELS = [
  "OCR_UNCERTAIN",
  "LOWER_ESTIMATE_OCR_LIMITATION",
  "VERIFY_AGAINST_SOURCE",
] as const;

export interface EstimateLineItemDelta {
  kind: EstimateDeltaKind;
  /** Row from the lower estimate, when one was matched. */
  lowerRow: EstimateDeltaRow | null;
  /** Row from the higher estimate that documents more scope. */
  higherRow: EstimateDeltaRow;
  /** How the two rows were paired ("amount" = unique-price misc/sublet pair). */
  matchBasis: "part_number" | "description" | "amount" | "section_only" | "none";
  laborDelta: number | null;
  paintDelta: number | null;
  priceDelta: number | null;
  /** Plain-language summary of the difference. */
  summary: string;
  /**
   * True when the lower estimate is OCR-derived and this line's presence there
   * could not be confirmed — treat as unverified, NOT a confirmed omission.
   */
  ocrUncertain?: boolean;
  /** Status labels to surface (e.g. OCR_UNCERTAIN, VERIFY_AGAINST_SOURCE). */
  statusLabels?: string[];
  /** Fields that differ on a matched line (operation, part, labor, paint, price, qty). */
  changedFields?: string[];
  /**
   * True when a matched pair differs ONLY in its CCC operation token with
   * identical hours/amounts ("Rpr Battery 0.3 M" vs "R&I Battery 0.3 M") —
   * likely a coding/description difference, not a scope change. Reported at
   * low priority, never removed.
   */
  codingOnlyChange?: boolean;
  /**
   * Set when an unmatched "Add for Clear Coat" child was folded into this
   * parent refinish delta because the parent paint-time difference equals the
   * child's hours and the lower estimate shows no separate clear-coat line.
   */
  groupedClearCoatChild?: { lineNumber: number | null; hours: number };
  /**
   * True when this unmatched material/supply line has a bundled or
   * invoice-pending counterpart on the lower estimate (itemized "BetaSeal
   * urethane" vs a "Glass Kit" / "Primer (invoice required)" allowance) — a
   * potential bundled-equivalent difference, NOT confirmed missing scope.
   */
  bundledEquivalentCandidate?: boolean;
  /**
   * Whether this delta should be drawn in the PRIMARY highlight layer. False for
   * OCR-uncertain lines whose description is already present in the OCR'd lower
   * estimate (present-but-poorly-parsed) — these are recorded for a verify tier
   * but must not be highlighted as confirmed changes.
   */
  annotate: boolean;
}

export interface EstimateDeltaMatchResult {
  deltas: EstimateLineItemDelta[];
  lowerRowCount: number;
  higherRowCount: number;
  matchedPairCount: number;
  missingOperationCount: number;
  /** Higher-estimate lines whose category is already present in the lower estimate. */
  expandedScopeCount: number;
  /** Unmatched lines suppressed as OCR-uncertain (present-but-poorly-parsed). */
  ocrUncertainSuppressedCount: number;
  /**
   * Lower-estimate lines with no counterpart on the higher estimate — scope the
   * lower document carries that the higher one does not (including duplicated
   * pay items on the lower side). These have no anchor on the annotated PDF, so
   * they surface as a report section, not per-line highlights.
   */
  lowerOnlyRows: EstimateDeltaRow[];
  /** Every matched (higher, lower) pair, including no-delta pairs — for tests/diagnostics. */
  matchedPairs: Array<{
    higherRow: EstimateDeltaRow;
    lowerRow: EstimateDeltaRow;
    basis: EstimateLineItemDelta["matchBasis"];
  }>;
  /**
   * Residual lower rows whose description+operation duplicate a lower row that
   * ALREADY matched a higher row (SOR prints "Overlap Major Non-Adj. Panel" in
   * two sections while the shop prints one; a second "R&I Storage compart").
   * Possible duplicate billing or a separate access operation — never reported
   * as confirmed lower-only scope.
   */
  potentialDuplicateLowerRows: EstimateDeltaRow[];
  /**
   * How each consumed lower row was reconciled: "direct" (part/description),
   * "semantic" (equivalence alias), "group" (unique-amount pair), "bundle"
   * (backed a bundled-material classification), "duplicate" (twin of a matched
   * row). Rows absent from this list are genuinely lower-only.
   */
  lowerRowReconciliation: Array<{
    lineNumber: number | null;
    description: string;
    matchedAs: "direct" | "semantic" | "group" | "bundle" | "duplicate";
  }>;
}

/**
 * Category keywords used to decide whether an unmatched higher-estimate line is
 * a brand-new operation vs an expansion within a category the lower estimate
 * already covers. Keyword-based so it survives OCR noise and line splits.
 */
const CATEGORY_KEYWORDS = [
  "bumper", "grille", "grill", "fascia", "lamp", "headlamp", "headlight", "taillamp",
  "tail lamp", "light", "signal", "reflector", "hood", "fender", "quarter", "door",
  "roof", "rail", "pillar", "rocker", "windshield", "glass", "cowl", "wheel", "tire",
  "suspension", "steering", "panel", "liner", "molding", "applique", "mirror",
  "spoiler", "deck", "tailgate", "liftgate", "radiator", "support", "apron", "seat",
  "instrument", "battery", "sensor", "calibration", "scan", "frame", "trim", "emblem",
  "nameplate", "handle", "weatherstrip", "grommet", "bracket",
];

function extractCategoryKeywords(row: EstimateDeltaRow): string[] {
  const haystack = `${row.section ?? ""} ${(row.descriptionTokens ?? []).join(" ")} ${row.description ?? ""}`.toLowerCase();
  return CATEGORY_KEYWORDS.filter((kw) => haystack.includes(kw));
}

function extractCategoryKeywordsFromText(text: string): string[] {
  const haystack = (text ?? "").toLowerCase();
  return CATEGORY_KEYWORDS.filter((kw) => haystack.includes(kw));
}

/** Uppercase, strip punctuation, collapse spaces — for section-header presence. */
function normalizeCategoryText(value: string): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OP_CODES = [
  "R&I",
  "R & I",
  "R&R",
  "Repl",
  "Rpr",
  "Blnd",
  "Subl",
  "Refn",
  "Algn",
  "Add",
  "O/H",
  "Overlap",
] as const;

// Op code may be GLUED to the description with no space ("RprHood",
// "ReplBumper cover") in no-delimiter CCC text, so a plain \b never fires
// between "Repl" and "Bumper". The primary pattern is case-sensitive and
// matches when followed by end, non-letter, or an UPPERCASE letter — but never
// a lowercase continuation ("Replace", "Additional"). The fallback keeps the
// old case-insensitive word-boundary behavior for spaced text.
const ESCAPED_OP_CODES = OP_CODES.map((code) =>
  code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")
).join("|");
const OP_CODE_PATTERN = new RegExp(`^(${ESCAPED_OP_CODES})(?=$|[^a-z&])`);
const OP_CODE_PATTERN_CI = new RegExp(`^(${ESCAPED_OP_CODES})\\b`, "i");

// Labor-category markers (S01/S02) and component markers (m, M, T, X, s, etc.).
const LABOR_CATEGORY_PATTERN = /^S\d{2}$/i;
const COLUMN_MARKER_PATTERN = /^(?:m|s|t|x|d|e|f|g|b|p)$/i;

// Stopwords / generic tokens stripped before description matching.
const DESCRIPTION_STOPWORDS = new Set([
  "the",
  "for",
  "and",
  "with",
  "w",
  "o",
  "wo",
  "a",
  "an",
  "of",
  "to",
  "add",
  "incl",
  "included",
  // OCR misreads of "Incl." and the S01 supplement marker leak into
  // descriptions ("RT Backuplamp Ind.", "SOI Masking Tape") and inflate the
  // token set enough to push a same-operation pair below the match ratio.
  "ind",
  "soi",
  "note",
  "rcy",
  "lkq",
  "used",
  "oem",
  "opt",
  "alt",
  "am",
]);

/**
 * True for non-estimate content that must never become a row OR an annotation
 * anchor: rate/totals table lines, page footers with timestamps, carwise/legal
 * boilerplate, and column-header lines.
 */
export function isNonEstimateContentRow(rawText: string): boolean {
  const text = (rawText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  return (
    // Single abbreviation-legend fragments ("RPR=REPAIR", "Blnd=Blend.",
    // "R&I=Remove"): fragmented extractions split the legend footer into
    // per-pair lines, so the >= 2 "=" rule below never fires — but a real
    // operation row never opens with "<short token>=".
    /^[A-Za-z&/.'"_ -]{1,20}=/.test(text) ||
    // NOTE: totals lines glue words to digits ("SUBTOTALS23,918.00"), and \b
    // does not fire between a letter and a digit — use bare substrings.
    /hrs?\s*@|@\s*\$|\/hr\b/i.test(text) ||
    /(subtotal|estimate totals|grand total|sales tax|total cost of repair|net cost of|workfile total|total adjustments|totals summary|cumulative effects|total supplement|supplement adjustments)/i.test(text) ||
    /^(parts|miscellaneous|deductible)\s*\$?[\d,]/i.test(text) || // totals-table rows
    // Cumulative-supplement summary lines ("Estimate5,477.96 JOHN RUSSO",
    // "Supplement S014,131.58", "Additional Supplement Taxes0.01").
    /^estimate\s*\$?[\d,]+\.\d{2}/i.test(text) ||
    /^supplement s\d/i.test(text) ||
    /^additional supplement/i.test(text) ||
    /\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/.test(text) || // page footer timestamps
    /page\s+\d+\s*$/i.test(text) ||
    /^line\s*oper|^line\s+description/i.test(text) || // column headers
    // Abbreviation-legend footer lines ("BLND=BLEND CAPA=CERTIFIED …",
    // "Rpr=Repair. RT=Right."). Real operation rows never carry "=" pairs.
    (text.match(/=/g) ?? []).length >= 2 ||
    /get live updates|carwise\.com/i.test(text) ||
    /^(any person who knowingly|the following is a list|estimate based on motor|the attached estimate)/i.test(text)
  );
}

/** True for ALL-CAPS CCC section headers like "REAR BUMPER", "VEHICLE DIAGNOSTICS". */
export function isSectionHeader(rawText: string): boolean {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return false;
  // Section headers carry no decimal labor/paint columns and no op code.
  if (/\d+\.\d/.test(text)) return false;
  // Strip a leading line number used by some CCC layouts — including glued
  // no-delimiter forms ("43FENDER").
  const body = text.replace(/^\d{1,4}\s*(?=[A-Z])/, "").trim();
  if (body.length < 3 || body.length > 48) return false;
  if (/[a-z]/.test(body)) return false; // must be upper-case only
  return /^[A-Z][A-Z0-9 &/.'-]+$/.test(body);
}

/** Extract the numeric "Net Cost of Repairs" / "Total Cost of Repairs" total. */
export function parseEstimateNetTotal(text: string): number | null {
  if (!text) return null;
  const patterns = [
    /net\s+cost\s+of\s+repairs?\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /total\s+cost\s+of\s+repairs?\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /workfile\s+total\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /grand\s+total\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i,
  ];
  for (const pattern of patterns) {
    const matches = [...text.matchAll(new RegExp(pattern, "gi"))];
    if (matches.length > 0) {
      // Use the largest match (cumulative totals can repeat through the doc).
      const values = matches
        .map((match) => Number(match[1].replace(/,/g, "")))
        .filter((value) => Number.isFinite(value));
      if (values.length > 0) return Math.max(...values);
    }
  }
  return null;
}

// Industry-synonym token folding: the same operation prints under different
// shop/CCC vocabulary ("Color Sand/Buff" ≡ "Finish sand & polish"). Both sides
// canonicalize so the wording difference never reads as a missing operation.
const DESCRIPTION_TOKEN_SYNONYMS: Record<string, string> = {
  buff: "polish",
  buffing: "polish",
};

/**
 * Narrow equivalence alias group for interior protection/covering operations:
 * "Interior Protection kit" (shop) and "Cover car/bag" / "Cover interior"
 * (carrier) bill the same protect-the-interior scope under different wording
 * and different allowances (RO 22108: $3.22/0.1 vs $10.00/0.3). These pair as
 * a CHANGED line — never as lower-only/missing scope. The group applies only
 * to descriptions that normalize to one of these exact phrases; it never
 * extends to other operations.
 */
const PROTECTION_COVER_ALIASES = new Set([
  "INTERIOR PROTECTION KIT",
  "INTERIOR PROTECTION",
  "COVER INTERIOR",
  "COVERINTERIOR", // glued extraction of "Cover interior"
  "COVER CAR BAG",
  "CAR BAG",
  "VEHICLE PROTECTION KIT",
]);

function isProtectionCoverAlias(row: EstimateDeltaRow): boolean {
  return PROTECTION_COVER_ALIASES.has(normalizeCategoryText(row.description));
}

function tokenizeDescription(description: string): string[] {
  return description
    // Fragmented/glued extractions weld words together with only the case
    // boundary surviving ("WindshieldTesla", "BindHood", "SOISet", "RTTail").
    // Split camel seams BEFORE lowercasing so both extractions of the same
    // row tokenize identically.
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\+\d+%/g, " ")
    // Canonicalize alpha↔digit transitions ("gle350" ≡ "gle 350") so glued and
    // spaced extractions of the same row produce identical token sets.
    .replace(/([a-z])(?=\d)/g, "$1 ")
    .replace(/(\d)(?=[a-z])/g, "$1 ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !DESCRIPTION_STOPWORDS.has(token))
    .map((token) => DESCRIPTION_TOKEN_SYNONYMS[token] ?? token);
}

// ---------------------------------------------------------------------------
// No-delimiter CCC text: some extractions glue EVERY column together
// ("7*ReplBumper cover1678806106999911,308.00Incl.2.6"). Without splitting,
// prices/hours parse as null, descriptions carry digit debris, matching fails,
// and every line gets falsely flagged. explodeGluedRow() restores column
// boundaries; it is idempotent on already-spaced text.
// ---------------------------------------------------------------------------

// A trailing "column blob": digits, money, hours, qty, markers (m/M/s/T/X),
// "Incl.", commas, minus signs. Never ordinary words.
function isColumnBlob(value: string): boolean {
  if (!value || !/\d/.test(value)) return false;
  // A part dimension ("8.2x12.2", "8.0x5-0.9") is description text, not
  // column data — its "x" would otherwise read as the taxed-charge marker and
  // the dimension digits would explode into phantom qty/hour columns
  // (a wrapped "8.2x12.2" tail produced a false +1.0 paint-hour finding).
  if (/\d\s*[xX]\s*\d/.test(value)) return false;
  return /^(?:Incl\.|[\d,.\-\s]|[mMsSTXbBpP](?![a-z]))+$/.test(value);
}

/**
 * Split a glued digit run into [partNumber?, qty?, money]. CCC prints
 * part+qty+price contiguously ("16788507081598.00" = 1678850708 / 1 / 598.00).
 * Preference order mirrors real estimates: a qty of "1" wins, then any other
 * single-digit qty with the longest remaining part, then 2-digit qty, then a
 * bare money value.
 */
interface GluedMoneyCandidate {
  part: string;
  qty: string;
  money: string;
  value: number;
}

function enumerateGluedMoneyCandidates(run: string): GluedMoneyCandidate[] {
  const candidates: GluedMoneyCandidate[] = [];
  const moneyRe = /(\d{1,3}(?:,\d{3})+\.\d{2}|\d{1,6}\.\d{2})$/;
  // Enumerate money suffixes by shrinking the run from the left.
  for (let start = 0; start < run.length; start += 1) {
    const suffix = run.slice(start);
    const match = suffix.match(moneyRe);
    if (!match || match[1] !== suffix) continue;
    // CCC never prints leading-zero prices ("09.60") and always comma-groups
    // $1,000+ — a bare "96539.60" is a mis-split, not a real amount.
    if (/^0\d/.test(suffix)) continue;
    const value = Number(suffix.replace(/,/g, ""));
    if (!Number.isFinite(value) || value > 99999.99) continue;
    if (value >= 1000 && !suffix.includes(",")) continue;
    const head = run.slice(0, start);
    for (const qtyLen of [1, 2, 0]) {
      if (head.length < qtyLen) continue;
      const qty = qtyLen ? head.slice(-qtyLen) : "";
      if (qty && !/^[1-9]\d?$/.test(qty)) continue;
      const part = head.slice(0, head.length - qtyLen);
      // Short leftovers ("450" from "GLE4501890.00") are description tails,
      // not part numbers — still valid splits, scored without a part bonus.
      if (part && !/^[A-Za-z0-9-]+$/.test(part)) continue;
      candidates.push({ part, qty, money: suffix, value });
    }
  }
  return candidates;
}

function splitGluedMoneyRun(run: string): string[] | null {
  const candidates = enumerateGluedMoneyCandidates(run);
  if (candidates.length === 0) return null;
  // Preference order (validated against real CCC part+qty+price runs):
  // 1. qty "1" (dominant in CCC), then any single-digit qty, then 2-digit;
  // 2. a plausible part: empty (description-glued) or >= 10 chars (OEM), then
  //    full-length 7-9 char parts (Mopar/GM print 7-8), then 5-6 chars,
  //    penalizing runt fragments ("Valve stem207335529.80" = 2073355 / 2 /
  //    9.80, not 20733 / 5 / 529.80);
  // 3. more digits kept in the money value ("…41"+"1"+"125.00" beats
  //    "…411"+"1"+"25.00");
  // 4. longer part as the final tiebreaker.
  // A 1-2 digit pure-numeric leftover "part" is never a real description tail
  // (those are words or model codes like "450") — a qty-1 read that strands
  // one ("214.16" → "2"+1+4.16) loses its qty-1 dominance so "2"+14.16 wins.
  const strandsDigitRunt = (part: string) => /^\d{1,2}$/.test(part);
  const score = (c: { part: string; qty: string; money: string }) =>
    (c.qty === "1" && !strandsDigitRunt(c.part)
      ? 4000
      : c.qty.length === 1
        ? 2000
        : c.qty.length === 2
          ? 1000
          : 0) +
    (c.part === "" || c.part.length >= 10 ? 600 : c.part.length >= 7 ? 450 : c.part.length >= 5 ? 300 : 0) +
    c.money.replace(/\D/g, "").length * 20 +
    c.part.length;
  candidates.sort((a, b) => score(b) - score(a));
  const best = candidates[0];
  return [best.part, best.qty, best.money].filter(Boolean);
}

/**
 * All prices a row's glued part/qty/price run could plausibly have split into.
 * Only rows whose columns came from a no-delimiter run are ambiguous: a long
 * numeric part number, or a part-less qty+price pair. When the counterpart
 * row's price appears in this set, the "difference" is a split artifact, not a
 * real price change.
 */
function priceSplitAlternates(row: EstimateDeltaRow): Set<number> {
  const alternates = new Set<number>();
  if (row.price === null) return alternates;
  const part = (row.partNumber ?? "").replace(/-/g, "");
  const ambiguous = /^\d{6,}$/.test(part) || (part === "" && row.qty !== null);
  if (!ambiguous) return alternates;
  const money = row.price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const run = `${part}${row.qty ?? ""}${money}`;
  for (const candidate of enumerateGluedMoneyCandidates(run)) {
    alternates.add(candidate.value);
  }
  return alternates;
}

/** Restore spaces between glued estimate-row columns (idempotent). */
export function explodeGluedRow(rawText: string): string {
  let text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return text;

  // "~" is MOTOR's not-included-operation marker; glued into a row it welds
  // the description to the part/qty/price run ("+25%~41035906311,223.75…").
  text = text.replace(/~/g, " ");

  // Description words glue onto part numbers with no delimiter
  // ("BLACK68534268AH", "Striker68294124AA", "swb7BC10TZZAC"). Split an
  // alpha word (3+ letters) from a digit-led 7+ alphanumeric tail — short
  // model tails like "GLE350" or "R19" never qualify.
  text = text.replace(/([A-Za-z]{3,})(?=\d[A-Za-z0-9]{6,})/g, "$1 ");

  // "Incl." glued straight onto the description, a part number, or a price
  // ("fender linerIncl.", "6VF90DX8ABIncl.", "29.80Incl.").
  text = text.replace(/([A-Za-z0-9)])(Incl\.)/g, "$1 $2");

  // Aftermarket catalog part numbers print with an interior dot
  // ("3012.0113") and glue straight onto the qty/price run — split the
  // catalog number off the digits that follow.
  text = text.replace(/(\d{4}\.\d{4})(?=\d)/g, "$1 ");

  // A part DIMENSION glues straight onto the part number in fragmented
  // extractions ("grommet 8.2x12.2110492600B", "8.0x5-0.9110433500B"). The
  // dimension stays description text; without the split the part number never
  // parses and the whole grommet/gasket cluster cross-pairs.
  text = text.replace(/(\dx\d{1,2}(?:\.\d)?(?:-\d{1,2}(?:\.\d)?)?)(?=\d{5,})/g, "$1 ");

  // 1. Find the earliest description→column-blob boundary (a letter/'%'/')'
  //    followed by digits, a minus-number, or a marker+digit) where everything
  //    after is column content only. Interior alphanumerics (GLE350, 50R19)
  //    never qualify because the remainder contains ordinary words.
  for (let i = 1; i < text.length; i += 1) {
    const prev = text[i - 1];
    const cur = text[i];
    const nxt = text[i + 1] ?? "";
    // prev-class deliberately EXCLUDES "." (it would split inside decimals)
    // and the marker set excludes s/S (it would split plural words).
    const boundary =
      /[A-Za-z)%'"&]/.test(prev) &&
      (/\d/.test(cur) ||
        (cur === "-" && /\d/.test(nxt)) ||
        (/[mMTX]/.test(cur) && /\d/.test(nxt)));
    if (!boundary) continue;
    // A digit-x-digit seam is a part DIMENSION ("8.2x12.2", "8.0x5-0.9"),
    // not a description→column boundary — splitting there turned the
    // dimension tail into phantom qty/hour columns.
    if (/[xX]/.test(prev) && /\d/.test(text[i - 2] ?? "")) continue;
    const remainder = text.slice(i);
    // Never split INSIDE an alphanumeric part number ("GM1144143", "C25J75"):
    // the rest of that token must itself look like glued column data — a
    // decimal value or a 9+ digit run — before the boundary is real.
    const tokenEnd = text.indexOf(" ", i);
    const withinToken = tokenEnd === -1 ? text.slice(i) : text.slice(i, tokenEnd);
    const splittable =
      /\.\d/.test(withinToken) ||
      withinToken.replace(/\D/g, "").length >= 9 ||
      // Tiny glued tails ("scan1m", "flare2") are qty/marker columns — but
      // only after a WORD (2+ letters). After a mixed alnum fragment the
      // digits are a part-number interior ("C25J75" must not split at "J7").
      (withinToken.length <= 3 && /[A-Za-z]{2}$/.test(text.slice(0, i)));
    if (!splittable) continue;
    if (isColumnBlob(remainder)) {
      const head = text.slice(0, i);
      // 2. Explode the blob itself.
      let blob = remainder
        .replace(/(Incl\.)/gi, " $1 ")
        // A comma before 4+ digits is a description tail ("350,") glued to a
        // part/qty/price run — money grouping is always exactly 3 digits.
        .replace(/,(?=\d{4,})/g, ", ")
        // money → the NEXT VALUE ("166.500.6" → "166.50 0.6"); the follower
        // must itself look like a decimal value so the split never fires
        // inside a dotted A/M catalog part ("3012.0113" stays intact). A bare
        // ".d" follower means the "2 decimals" were really two glued
        // 1-decimal hour values ("Hood1.03.2"), handled below.
        .replace(/(\.\d{2})(?=-?\d{1,4}[.,]\d)/g, "$1 ")
        .replace(/([mMsTX])(?=-?[\d.])/g, "$1 ") // marker → number
        .replace(/(\d)([mMsTXbBpP])(?=\s|$)/g, "$1 $2"); // number → trailing marker
      // Hour columns glue to each other ("2.41.8" → "2.4 1.8"). Hours carry
      // exactly ONE decimal, so only split when a FULL hour number follows —
      // never inside a 2-decimal money value ("11,308.00" stays intact).
      let previous = "";
      while (previous !== blob) {
        previous = blob;
        blob = blob.replace(/(\d\.\d)(?=-?\d+\.\d)/g, "$1 ");
      }
      // Part/qty/price runs ("16788507081598.00" → "1678850708 1 598.00").
      // When a separate qty token already precedes the money ("1 125.00"),
      // leave the money alone; a glued run carries its own qty prefix
      // ("125.00" → "1 25.00"), matching how CCC prints qty before price.
      const blobTokens = blob.split(" ").filter(Boolean);
      const blobHasMoney = blobTokens.some((token) => /\.\d{2}(?:$|\D)/.test(token));
      blob = blobTokens
        .map((token, index) => {
          // Qty glued to a lone HOURS value ("10.5" = qty 1 + 0.5 hr, "31.5" =
          // qty 3 + 1.5 hr) — only on rows that PRINT a qty column: manual
          // "#" entries and Repl rows. Rpr/R&I/Blnd/etc. carry no qty, so
          // "22.0" there is 22.0 hours, never qty 2 + 2.0.
          // NOTE: no \b before "Repl" — it never fires between a digit and a
          // letter ("18Repl…"), the usual glued-CCC shape.
          const qtyHours =
            !blobHasMoney &&
            /#|Repl/i.test(rawText) &&
            token.match(/^([1-9])(\d{1,2}\.\d)$/);
          if (qtyHours) {
            return `${qtyHours[1]} ${qtyHours[2]}`;
          }
          if (!/^[A-Za-z0-9,-]*\d[,\d]*\.\d{2}$/.test(token)) return token;
          const previousToken = blobTokens[index - 1] ?? "";
          if (/^[1-9]\d?$/.test(previousToken)) return token; // qty already separate
          const split = splitGluedMoneyRun(token);
          return split ? split.join(" ") : token;
        })
        .join(" ");
      text = `${head} ${blob}`.replace(/\s+/g, " ").trim();
      break;
    }
  }

  // Space-separated long money runs (from wrapped-row rejoins) still need the
  // part/qty/price split: a "price" with 7+ integer digits is a glued run,
  // never a real dollar amount. Runs that glue money to trailing HOURS
  // ("41035906311,223.751.73.1") never end in ".dd", so pre-split pure-numeric
  // tokens at money→value and hour→hour seams first (dotted A/M catalog parts
  // excluded — their interior ".dddd" is not a money seam).
  const finalTokens: string[] = [];
  for (const token of text.split(" ").filter(Boolean)) {
    if (/^[\d,.]+\d$/.test(token) && !/^\d{4}\.\d{4}$/.test(token)) {
      let expanded = token.replace(/(\.\d{2})(?=-?\d{1,4}[.,]\d)/g, "$1 ");
      let previousPass = "";
      while (previousPass !== expanded) {
        previousPass = expanded;
        expanded = expanded.replace(/(\d\.\d)(?=-?\d+\.\d)/g, "$1 ");
      }
      finalTokens.push(...expanded.split(" "));
      continue;
    }
    finalTokens.push(token);
  }
  text = finalTokens
    .map((token, index) => {
      if (!/^[A-Za-z0-9,-]*\d[,\d]*\.\d{2}$/.test(token)) return token;
      const integerDigits = token.split(".")[0].replace(/\D/g, "").length;
      // A no-comma "price" of $1,000+ is impossible in CCC output ($1,000+ is
      // always comma-grouped) — such a token is a glued qty+price ("1163.08").
      const value = Number(token.replace(/,/g, ""));
      const commaMissingGlue = !token.includes(",") && value >= 1000 && value <= 9999999;
      if (integerDigits < 7 && !/[A-Za-z]/.test(token) && !commaMissingGlue) return token;
      const previousToken = finalTokens[index - 1] ?? "";
      if (/^[1-9]\d?$/.test(previousToken)) return token;
      const split = splitGluedMoneyRun(token);
      return split ? split.join(" ") : token;
    })
    .join(" ");

  return text;
}

function stripLeadingMetadata(rawText: string): { body: string; lineNumber: number | null } {
  let body = rawText.replace(/\s+/g, " ").trim();
  let lineNumber: number | null = null;

  // Leading optional "Line" keyword.
  body = body.replace(/^line\s+/i, "");

  // Leading line number — including glued no-delimiter forms ("6Repl…",
  // "8S02 Repl…") where no \b exists between the digit and the letter.
  const lineMatch = body.match(/^(\d{1,4})(?=\D|$)\s*/);
  if (lineMatch) {
    lineNumber = Number(lineMatch[1]);
    body = body.slice(lineMatch[0].length);
  }

  // Strip symbol tokens (#, *, **, <>) and labor-category tokens (S01/S02)
  // that sit between the line number and the operation/description. CCC/Audatex
  // frequently CONCATENATE these with each other and with the operation
  // ("13*S01RprWindshield"), so markers are stripped even without a trailing
  // space — otherwise equivalent shop/carrier lines tokenize differently and an
  // operation present in both is wrongly reported as present-only.
  let changed = true;
  while (changed) {
    changed = false;
    const symbolMatch = body.match(/^(?:#|\*{1,2}|<>)\s*/);
    if (symbolMatch && symbolMatch[0].length > 0) {
      body = body.slice(symbolMatch[0].length);
      changed = true;
      continue;
    }
    // Concatenated labor-category code (e.g. "S01RprWindshield"). OCR reads
    // "S01" as "SOI"/"S0I"/"SOl" (0<->O, 1<->I/l); left in place the marker
    // pollutes the description ("SOI Masking Tape") and blocks matching. The
    // lookahead requires a space, end, glued word start ("SOISet"), or "R&I"
    // so ALL-CAPS words like "SOLID" never lose their head.
    const concatLaborMatch = body.match(/^S(?:\d{2}|[0Oo][1IiLl])(?=$|\s|[A-Z][a-z]|R&I)/);
    if (concatLaborMatch) {
      body = body.slice(concatLaborMatch[0].length);
      changed = true;
      continue;
    }
    // Space-separated labor-category token.
    const firstToken = body.split(" ")[0] ?? "";
    if (LABOR_CATEGORY_PATTERN.test(firstToken)) {
      body = body.slice(firstToken.length).trim();
      changed = true;
    }
  }

  return { body: body.trim(), lineNumber };
}

function extractTrailingColumns(body: string): {
  descriptionBody: string;
  partNumber: string | null;
  qty: number | null;
  price: number | null;
  labor: number | null;
  laborIncluded: boolean;
  paint: number | null;
  paintIncluded: boolean;
  laborType: string | null;
} {
  const tokens = body.split(" ").filter(Boolean);
  // The labor-TYPE column letter prints right after the labor hours ("isolate
  // high voltage 1 0.5 M", "Lift gate 7.0 M 3.5"). Uppercase only: lowercase
  // "m"/"s" are component markers that print BEFORE the hours, and T/X are
  // taxed/non-taxed charge markers, never a labor category.
  const LABOR_TYPE_LETTER = /^[DEFGMS]$/;

  // Find the extended-price token: a number with exactly two decimal places,
  // optionally with a leading $ and thousands separators.
  let priceIndex = -1;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (/^\$?[\d,]+\.\d{2}$/.test(tokens[index])) {
      priceIndex = index;
      break;
    }
  }

  if (priceIndex === -1) {
    // No money column (R&I / Rpr / Add-for rows). Still pull trailing hour
    // columns and Incl. markers so labor/paint deltas compare correctly.
    let end = tokens.length;
    const trailing: string[] = [];
    let noPriceLaborType: string | null = null;
    while (end > 0) {
      const token = tokens[end - 1];
      if (COLUMN_MARKER_PATTERN.test(token)) {
        // Scanning right-to-left: a type letter seen before the paint hours
        // ("7.0 M 3.5") or as the trailing token ("0.5 M") sits beside the
        // labor value.
        if (LABOR_TYPE_LETTER.test(token) && trailing.length <= 1) {
          noPriceLaborType = token;
        }
        end -= 1;
        continue;
      }
      if (/^incl\.?$/i.test(token) || /^-?\d{1,2}\.\d$/.test(token)) {
        trailing.unshift(token);
        end -= 1;
        continue;
      }
      // User-defined labor-category digit ("Rpr LT Fender primed 1.0 1 2.0" —
      // the "1" is the aluminum-repair category marker, like "D" or "M").
      // Only between two hour values: a qty prints BEFORE the hours, never
      // between them, so this cannot swallow a real qty column.
      if (
        /^[1-4]$/.test(token) &&
        trailing.length > 0 &&
        end >= 2 &&
        /^-?\d{1,2}\.\d$/.test(tokens[end - 2])
      ) {
        end -= 1;
        continue;
      }
      break;
    }
    let labor: number | null = null;
    let laborIncluded = false;
    let paint: number | null = null;
    let paintIncluded = false;
    // The qty column prints just before the hours ("Tint color 1 0.5") —
    // consume it so it never leaks into the description. Some carrier rows
    // are qty-ONLY ("Pre-repair scan 1 m": present but unpriced) — the bare
    // qty is still real operation data and must not vanish.
    let qty: number | null = null;
    if (end > 1 && /^[1-9]\d?$/.test(tokens[end - 1])) {
      qty = Number(tokens[end - 1]);
      end -= 1;
    }
    // Some layouts print the part number even on price-less rows
    // ("R&I RT Striker 68294124AA 0.2"). Pull it out so the description
    // matches its counterpart on documents that omit the part column.
    let noPricePartNumber: string | null = null;
    if (end > 1 && isPartNumberToken(tokens[end - 1])) {
      noPricePartNumber = tokens[end - 1];
      end -= 1;
    }
    if ((trailing.length > 0 || qty !== null) && end > 0) {
      const [first, second] = trailing;
      if (first !== undefined) {
        if (/^incl\.?$/i.test(first)) laborIncluded = true;
        else labor = Number(first);
      }
      if (second !== undefined) {
        if (/^incl\.?$/i.test(second)) paintIncluded = true;
        else paint = Number(second);
      }
      return {
        descriptionBody: tokens.slice(0, end).join(" ").trim(),
        partNumber: noPricePartNumber,
        qty,
        price: null,
        labor,
        laborIncluded,
        paint,
        paintIncluded,
        laborType: labor !== null ? noPriceLaborType : null,
      };
    }
    return {
      descriptionBody: body,
      partNumber: null,
      qty: null,
      price: null,
      labor: null,
      laborIncluded: false,
      paint: null,
      paintIncluded: false,
      laborType: null,
    };
  }

  const price = Number(tokens[priceIndex].replace(/[$,]/g, ""));

  // Labor + paint columns come after the price (skipping markers / Incl.).
  let labor: number | null = null;
  let laborIncluded = false;
  let paint: number | null = null;
  let paintIncluded = false;
  let columnSlot = 0; // 0 → labor, 1 → paint
  let laborType: string | null = null;
  for (let index = priceIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (COLUMN_MARKER_PATTERN.test(token)) {
      // The type letter right after the labor hours ("… 15.40 T 0.2 M") names
      // that labor's category; letters before the hours are charge markers.
      if (LABOR_TYPE_LETTER.test(token) && columnSlot === 1 && laborType === null) {
        laborType = token;
      }
      continue;
    }
    if (/^incl\.?$/i.test(token) || /^included$/i.test(token)) {
      if (columnSlot === 0) {
        laborIncluded = true;
        columnSlot = 1;
      } else {
        paintIncluded = true;
      }
      continue;
    }
    const numeric = token.match(/^-?\d+(?:\.\d+)?$/);
    if (numeric) {
      const value = Number(token);
      if (columnSlot === 0) {
        labor = value;
        columnSlot = 1;
      } else if (columnSlot === 1) {
        paint = value;
        columnSlot = 2;
        break;
      }
    }
  }

  // Qty: the integer token immediately before the price.
  let qty: number | null = null;
  let qtyIndex = -1;
  for (let index = priceIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (COLUMN_MARKER_PATTERN.test(token)) continue;
    if (/^\d{1,3}$/.test(token)) {
      qty = Number(token);
      qtyIndex = index;
    }
    break;
  }

  // Part number: alphanumeric token before qty (letters+digits, or a long
  // dealer/recycler number). Excludes the qty and price tokens.
  let partNumber: string | null = null;
  let partIndex = -1;
  const partBoundary = qtyIndex >= 0 ? qtyIndex : priceIndex;
  for (let index = partBoundary - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (isPartNumberToken(token)) {
      partNumber = token.toUpperCase();
      partIndex = index;
    }
    break;
  }

  const descriptionEnd = partIndex >= 0 ? partIndex : qtyIndex >= 0 ? qtyIndex : priceIndex;
  const descriptionBody = tokens.slice(0, descriptionEnd).join(" ").trim();

  return {
    descriptionBody,
    partNumber,
    qty,
    price,
    labor,
    laborIncluded,
    paint,
    paintIncluded,
    laborType: labor !== null ? laborType : null,
  };
}

function isPartNumberToken(token: string): boolean {
  const value = token.replace(/[.,]$/, "");
  if (value.length < 5) return false;
  if (/^\$?[\d,]+\.\d{2}$/.test(value)) return false; // money
  const hasLetter = /[A-Za-z]/.test(value);
  const hasDigit = /\d/.test(value);
  if (hasLetter && hasDigit && /^[A-Za-z0-9-]+$/.test(value)) return true;
  // Pure numeric part numbers are usually >= 6 digits (e.g. 84394021, 9132667),
  // optionally dash-grouped ("167-880-44-09"). Aftermarket catalog numbers
  // print with an interior dot ("3012.0113").
  if (!hasLetter && /^\d{6,}$/.test(value)) return true;
  if (!hasLetter && /^\d{4}\.\d{4}$/.test(value)) return true;
  if (!hasLetter && /^\d[\d-]{5,}\d$/.test(value) && value.replace(/-/g, "").length >= 6) return true;
  return false;
}

/**
 * Parse a single CCC estimate row's raw text into a structured delta row.
 * Returns null when the text is not an annotatable estimate operation row
 * (section headers, totals, boilerplate, blank lines).
 */
export function parseCccEstimateRow(
  rawText: string,
  context?: { section?: string | null; anchorId?: string; pageNumber?: number | null }
): EstimateDeltaRow | null {
  if (isNonEstimateContentRow(rawText ?? "")) return null;
  // Estimate notes are prose attached to a row, never a row themselves.
  if (/^note\b/i.test((rawText ?? "").trim())) return null;
  // Restore column boundaries first — no-delimiter CCC extractions glue the
  // description, part number, qty, price, and hours into one run.
  let text = explodeGluedRow(rawText ?? "");
  if (!text) return null;
  if (isSectionHeader(text)) return null;

  // A print-wrapped description can rejoin AFTER the value columns ("Capture
  // image to confirm 0.3 M adjustments were made correctly", "LT Door glass
  // Tesla w/o 0.8 laminated", "Finish sand & polish (0.5 Refinish 8 3.0 per
  // panel)", or a merged note tail "1 1.0 1 avoid damage to newly painted
  // components (2 techs)"). Move the word tail back before the whole trailing
  // qty/hour/marker cluster so the columns parse; rows that end in their
  // value/marker are untouched because the tail group requires words after it.
  // The tail must END in a word character (letter/quote/paren/period), never a
  // number — otherwise a marker+hours pair ("D 2.0") reads as a "tail" — and
  // may carry digits only inside a parenthesized note ("(2 techs)"): a bare
  // digit or money value in the tail means those are real columns ("3 Ft 1
  // 7.08 T"), not wrapped prose, and the row must stay untouched.
  text = text.replace(
    /^(.*?\S)((?: -?\d{1,2}\.\d(?: [MDEFGS])?| Incl\.| [1-9]\d?)+) ([A-Za-z][A-Za-z0-9'"&/()., -]*[A-Za-z)."'])$/,
    (full, head, cluster, tail) => {
      const tailOutsideParens = tail.replace(/\([^)]*\)/g, " ");
      if (/\d/.test(tailOutsideParens)) return full;
      return `${head} ${tail}${cluster}`;
    }
  );

  const { body, lineNumber } = stripLeadingMetadata(text);
  if (!body) return null;

  // Operation code is optional; capture it when present (glued or spaced).
  let opCode: string | null = null;
  let descriptionSource = body;
  const opMatch = body.match(OP_CODE_PATTERN) ?? body.match(OP_CODE_PATTERN_CI);
  if (opMatch) {
    opCode = normalizeOpCode(opMatch[1]);
    descriptionSource = body.slice(opMatch[0].length).trim();
  }

  const columns = extractTrailingColumns(descriptionSource);
  const description = cleanDescription(columns.descriptionBody || descriptionSource);
  if (!description) return null;
  // A "description" that is pure column content (".50T", "0.3") is a stray
  // value-continuation fragment, never a real operation line.
  if (isColumnBlob(description)) return null;

  const descriptionTokens = tokenizeDescription(description);
  // Require a usable description: at least one meaningful token, OR a part number.
  if (descriptionTokens.length === 0 && !columns.partNumber) return null;

  // A real estimate operation row carries an op code, a part number, or numeric
  // cost columns. Prose, equipment lists, disclaimers, and legal boilerplate
  // carry none of these and must never be treated as annotatable rows.
  const hasOperationData =
    opCode !== null ||
    columns.partNumber !== null ||
    columns.price !== null ||
    columns.labor !== null ||
    columns.paint !== null ||
    columns.laborIncluded ||
    columns.paintIncluded ||
    // A bare qty is real operation data: carrier layouts print unpriced
    // rows as "<desc> 1 m" (present but left open for invoice review).
    // Dropping them turned shared operations into false "missing" findings.
    (columns.qty !== null && lineNumber !== null);
  if (!hasOperationData) return null;

  return {
    lineNumber,
    opCode,
    description,
    descriptionTokens,
    partNumber: columns.partNumber,
    section: context?.section ?? null,
    qty: columns.qty,
    price: columns.price,
    labor: columns.labor,
    laborIncluded: columns.laborIncluded,
    paint: columns.paint,
    paintIncluded: columns.paintIncluded,
    laborType: columns.laborType,
    rawText: text,
    anchorId: context?.anchorId,
    pageNumber: context?.pageNumber ?? null,
  };
}

/**
 * Parse a full estimate's plain text into structured rows, tracking the active
 * CCC section header so each row knows which section it belongs to.
 */
export interface WrappedEstimateLineGroup {
  /** The rebuilt logical row text (wrapped lines re-joined). */
  text: string;
  /** Indexes into the input array of the lines this group merged. */
  sourceIndexes: number[];
}

/**
 * Rebuild logical estimate rows from print-wrapped lines. Every CCC estimate
 * row STARTS with its line number; wrapped descriptions and value columns
 * continue on following lines ("100*ReplGear assy GLE350, GLE450," /
 * "GLE580, GLE450e w/o activ bdy" / "cntrl14,994.00m1.3"). Continuations are
 * appended to the last numbered line; "Note:" lines end the row (their wraps
 * never merge). Shared by raw-text parsing and PDF anchor-row grouping.
 */
export function groupWrappedEstimateLines(lines: string[]): WrappedEstimateLineGroup[] {
  const groups: WrappedEstimateLineGroup[] = [];
  let open: WrappedEstimateLineGroup | null = null;
  // A row start is a line number NOT followed by more digits or a decimal
  // point — "12.50T0.3" and "0.3 Paint Hours)" are continuations, not rows.
  const startsRow = (line: string) => /^\d{1,4}(?=$|[^.\d])/.test(line);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    // Short unnumbered ALL-CAPS lines inside an open row are wrapped option
    // codes ("WSD", "PX8"), not section headers — real headers carry a line
    // number or a full section name.
    const shortCapsContinuation =
      open !== null && line.length <= 5 && !/^\d/.test(line) && !/[a-z]/.test(line);
    if ((isSectionHeader(line) && !shortCapsContinuation) || /^note\b/i.test(line)) {
      groups.push({ text: line, sourceIndexes: [index] });
      open = null;
      continue;
    }
    // Pure value continuations glue directly (they were glued in print) —
    // checked BEFORE row-start detection because they can begin with digits.
    if (open && isColumnBlob(line) && !isNonEstimateContentRow(line)) {
      open.text = `${open.text}${line}`;
      open.sourceIndexes.push(index);
      continue;
    }
    // A description ending in "Per" wraps its measurement to the next line
    // ("Trim Masking Tape-3M 06347-Per" / "3 Ft") — the leading digits there
    // are the measurement, never a new row's line number.
    if (open && /\bper$/i.test(open.text) && !isNonEstimateContentRow(line)) {
      open.text = `${open.text} ${line}`;
      open.sourceIndexes.push(index);
      continue;
    }
    if (startsRow(line)) {
      open = { text: line, sourceIndexes: [index] };
      groups.push(open);
      continue;
    }
    if (open && !isNonEstimateContentRow(line)) {
      // Description continuations join with a space.
      open.text = `${open.text} ${line}`;
      open.sourceIndexes.push(index);
      continue;
    }
    groups.push({ text: line, sourceIndexes: [index] });
    open = null;
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Fragmented (one-token-per-line) PDF text: pdf-parse extracts some CCC PDFs
// with every text run on its own line ("4" / "R&IR&I" / "bumper" / "cover" /
// "1.4"). Line-based row grouping then recovers almost nothing — on a real
// SOR the parser yielded 26 "rows" (half of them abbreviation-legend
// fragments) out of ~150 line items, so nearly every counterpart line looked
// "missing" and the delta report was flooded with false findings.
// reflowFragmentedEstimateText() rebuilds logical rows from the token stream
// using CCC's sequential line numbers as row boundaries.
// ---------------------------------------------------------------------------

/** True when extracted text is shredded to ~one token per line. */
export function isFragmentedEstimateText(text: string): boolean {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 60) return false;
  const singleToken = lines.filter((line) => !/\s/.test(line)).length;
  return singleToken / lines.length >= 0.7;
}

/**
 * Rebuild logical estimate lines from a fragmented token stream.
 *
 * - Row detection starts at the "Line Oper Description…" column header and
 *   splits before a 1-4 digit integer (bare or glued to a following capital,
 *   "11AIR") that is the NEXT expected CCC line number (a small forward
 *   window tolerates a missed boundary). Qty/hour tokens never qualify: they
 *   are either out of window or carry a decimal point.
 * - Page footers ("7/21/2026 8:07:43 AM … Page 5") switch to skip mode until
 *   the next row boundary, dropping repeated page-header chrome.
 * - The ESTIMATE TOTALS block is re-lined at category starters so
 *   parseCccEstimateTotals() can read rates/hours; glued category names
 *   ("MechanicalLabor") are re-spaced.
 * - Glued keywords ("SUPPLEMENTSUMMARY", "ESTIMATETOTALS", "SUBTOTALS") are
 *   emitted as their own spaced lines so downstream boundaries still fire.
 */
export function reflowFragmentedEstimateText(text: string): string {
  const tokens = (text ?? "").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current: string[] | null = null;
  let mode: "scan" | "rows" | "totals" = "scan";
  let skipChrome = false;
  let lastLine = 0;
  const WINDOW = 30;

  const flush = () => {
    if (current && current.length) out.push(current.join(" "));
    current = null;
  };
  const emitKeywordLine = (line: string) => {
    flush();
    current = [line];
    skipChrome = false;
  };

  const TOTALS_STARTER =
    /^(?:Parts|Body|Paint|Mechanical(?:Labor)?|Diagnostic(?:Labor)?|Structural|Frame|Electrical|Glass|Miscellaneous|Subtotal|Sales|Deductible|Total|Net|Grand|Workfile)$/;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1] ?? "";

    // Page-footer chrome: a date followed by a clock time starts the footer +
    // repeated page header; drop everything until the next structural
    // boundary. Date alone is NOT chrome — row text can carry dates ("Seat
    // assy white from 05/06/2021").
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(token) && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(next)) {
      flush();
      skipChrome = true;
      continue;
    }

    // Structural keywords (also glued forms).
    if (/^SUBTOTALS?$/i.test(token)) {
      emitKeywordLine("SUBTOTALS");
      continue;
    }
    if (/^ESTIMATETOTALS?$/i.test(token) || (/^ESTIMATE$/i.test(token) && /^TOTALS?$/i.test(next))) {
      emitKeywordLine("ESTIMATE TOTALS");
      if (!/^ESTIMATETOTALS?$/i.test(token)) index += 1;
      mode = "totals";
      continue;
    }
    if (/^SUPPLEMENTSUMMARY$/i.test(token) || (/^SUPPLEMENT$/i.test(token) && /^SUMMARY$/i.test(next))) {
      emitKeywordLine("SUPPLEMENT SUMMARY");
      if (!/^SUPPLEMENTSUMMARY$/i.test(token)) index += 1;
      mode = "scan";
      continue;
    }
    if (/^TOTALSSUMMARY$/i.test(token)) {
      emitKeywordLine("TOTALS SUMMARY");
      continue;
    }

    // Column header gates row mode ("Line Oper Description …").
    if (/^Line$/i.test(token) && /^Oper/i.test(next)) {
      flush();
      mode = "rows";
      skipChrome = true; // drop the header tokens until the first row number
      lastLine = lastLine || 0;
      continue;
    }

    if (mode === "rows") {
      // Row boundary: the next expected line number, bare ("45") or glued to
      // a capital/symbol ("11AIR", "52SOI", "135#").
      const glued = token.match(/^(\d{1,4})(?=[A-Z#*&(])/);
      const bare = /^\d{1,4}$/.test(token) ? token : null;
      const candidate = bare ?? glued?.[1] ?? null;
      if (candidate !== null) {
        const value = Number(candidate);
        if (value > lastLine && value <= lastLine + WINDOW) {
          flush();
          lastLine = value;
          skipChrome = false;
          current = [candidate];
          const rest = glued ? token.slice(candidate.length) : "";
          if (rest) current.push(rest);
          continue;
        }
      }
      if (skipChrome) continue;
      if (current) current.push(token);
      continue;
    }

    if (mode === "totals") {
      if (skipChrome) continue;
      // Re-space glued category names ("MechanicalLabor" -> "Mechanical Labor").
      const respaced = token.replace(/([a-z])([A-Z])/g, "$1 $2");
      if (TOTALS_STARTER.test(token) || TOTALS_STARTER.test(respaced.split(" ")[0] ?? "")) {
        flush();
        current = respaced.split(" ");
        continue;
      }
      if (current) current.push(...respaced.split(" "));
      else current = respaced.split(" ");
      continue;
    }

    // scan mode: not inside a recognized region — drop chrome, ignore prose.
  }
  flush();
  return out.join("\n");
}

export function parseCccEstimateRows(text: string): EstimateDeltaRow[] {
  if (!text) return [];
  if (isFragmentedEstimateText(text)) {
    text = reflowFragmentedEstimateText(text);
  }
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const rows: EstimateDeltaRow[] = [];
  let section: string | null = null;
  for (const group of groupWrappedEstimateLines(lines)) {
    const line = group.text;
    // "Supplement of Record with Summary" prints a SUPPLEMENT SUMMARY recap
    // after the line items: Changed/Deleted items carry ORIGINAL-estimate line
    // numbers with NEGATIVE hours, and Added items repeat rows already parsed.
    // Treating recap rows as line items creates false deltas (an R&I at -0.5
    // paired against the counterpart's +0.5).
    if (rows.length > 0 && /^supplement\s*summary$/i.test(line)) break;
    if (isSectionHeader(line)) {
      section = line.replace(/^\d{1,4}\s*(?=[A-Z])/, "").trim();
      continue;
    }
    const row = parseCccEstimateRow(line, { section });
    if (row) rows.push(row);
  }

  // CCC line numbers are unique per estimate, but multi-page prints repeat
  // supplement summary pages — keep the first (usually fullest) copy.
  const seenLineNumbers = new Set<number>();
  return rows.filter((row) => {
    if (row.lineNumber === null) return true;
    if (seenLineNumbers.has(row.lineNumber)) return false;
    seenLineNumbers.add(row.lineNumber);
    return true;
  });
}

/** Build a delta row from already-extracted source PDF row text + metadata. */
export function deltaRowFromRawText(params: {
  rawText: string;
  section?: string | null;
  anchorId?: string;
  pageNumber?: number | null;
}): EstimateDeltaRow | null {
  return parseCccEstimateRow(params.rawText, {
    section: params.section ?? null,
    anchorId: params.anchorId,
    pageNumber: params.pageNumber ?? null,
  });
}

function normalizeOpCode(opCode: string): string {
  const compact = opCode.replace(/\s+/g, "").toUpperCase();
  if (compact === "R&I") return "R&I";
  if (compact === "R&R") return "R&R";
  if (compact === "O/H") return "O/H";
  // Title-case the rest (Repl, Rpr, Blnd, Subl, Refn, Algn, Add, Overlap).
  return opCode.charAt(0).toUpperCase() + opCode.slice(1).toLowerCase();
}

function cleanDescription(value: string): string {
  return value
    .replace(/\bNOTE\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token set plus adjacent-bigram concatenations. Compound words survive glued
 * in one extraction and split in the other ("Fenderliner" vs "Fender liner",
 * "Wheelhouseliner" vs "Wheelhouse liner") — the bigram of the split side
 * equals the glued side's token, so the pair still counts as shared.
 */
function tokenSetWithBigrams(tokens: string[]): Set<string> {
  const set = new Set(tokens);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    set.add(`${tokens[index]}${tokens[index + 1]}`);
  }
  return set;
}

/** Bounded Levenshtein distance (early-exits above `max`). */
function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * OCR-tolerant token equality: one extraction reads "Upper" as "Lipper" or
 * "moulding" for "molding". Two content tokens (>= 5 chars) within edit
 * distance 2 that agree on the first character or the final three characters
 * are the same word; short tokens and larger edits never qualify.
 */
function isFuzzyTokenMatch(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5) return false;
  if (a[0] !== b[0] && a.slice(-3) !== b.slice(-3)) return false;
  return boundedEditDistance(a, b, 2) <= 2;
}

function tokenOverlap(
  a: string[],
  b: string[]
): { ratio: number; shared: number; maxSharedLen: number; sharedTokens: string[] } {
  if (a.length === 0 || b.length === 0) return { ratio: 0, shared: 0, maxSharedLen: 0, sharedTokens: [] };
  const setA = new Set(a);
  const expandedB = tokenSetWithBigrams(b);
  const bigramsOnlyA = new Set([...tokenSetWithBigrams(a)].filter((token) => !setA.has(token)));
  let shared = 0;
  let maxSharedLen = 0;
  const sharedTokens: string[] = [];
  const unmatchedA: string[] = [];
  for (const token of setA) {
    if (expandedB.has(token)) {
      shared += 1;
      maxSharedLen = Math.max(maxSharedLen, token.length);
      sharedTokens.push(token);
    } else {
      unmatchedA.push(token);
    }
  }
  // Reverse direction: a glued B token that equals an A bigram represents two
  // fused A tokens ("fenderliner" on B vs "fender"+"liner" on A).
  const unmatchedB: string[] = [];
  for (const token of new Set(b)) {
    if (!setA.has(token) && bigramsOnlyA.has(token)) {
      shared += 1;
      maxSharedLen = Math.max(maxSharedLen, token.length);
      sharedTokens.push(token);
    } else if (!setA.has(token)) {
      unmatchedB.push(token);
    }
  }
  // OCR-tolerant pass over the leftovers ("upper" ~ "lipper").
  for (const tokenA of unmatchedA) {
    const fuzzyIndex = unmatchedB.findIndex((tokenB) => isFuzzyTokenMatch(tokenA, tokenB));
    if (fuzzyIndex === -1) continue;
    unmatchedB.splice(fuzzyIndex, 1);
    shared += 1;
    maxSharedLen = Math.max(maxSharedLen, tokenA.length);
    sharedTokens.push(tokenA);
  }
  const smaller = Math.min(setA.size, new Set(b).size);
  return {
    ratio: smaller === 0 ? 0 : Math.min(1, shared / smaller),
    shared,
    maxSharedLen,
    sharedTokens,
  };
}

/**
 * Two rows describe the same operation when they share several tokens, OR they
 * share a single distinctive token (e.g. "headliner", "spoiler") at near-total
 * overlap. The distinctive-token rule is gated on token length to avoid pairing
 * unrelated rows that happen to share one short, common word.
 */
function isDescriptionMatch(overlap: ReturnType<typeof tokenOverlap>): boolean {
  if (overlap.shared >= DESCRIPTION_MATCH_MIN_SHARED && overlap.ratio >= DESCRIPTION_MATCH_MIN_RATIO) {
    // Exactly 2 shared tokens at a sub-0.75 ratio is weak evidence — "LT Lower
    // absorber" vs "LT Lower cntrl arm" shares only the generic {lt, lower}.
    // Two shared CONTENT words (>= 4 chars, non-directional, non-numeric) are
    // real evidence though: "Mask jambs" ~ "Mask Openings/Jambs", "Isolate
    // high voltage" ~ OCR'd "isolate high violate".
    if (overlap.shared === 2 && overlap.ratio < 0.75) {
      const contentTokens = overlap.sharedTokens.filter(
        (token) => token.length >= 4 && !DIRECTIONAL_TOKENS.has(token) && !/^\d+$/.test(token)
      );
      if (contentTokens.length < 2) return false;
    }
    return true;
  }
  if (overlap.shared >= 1 && overlap.ratio >= 0.85 && overlap.maxSharedLen >= 5) return true;
  // Single-word operations ("Rpr Hood" vs "Rpr Hood") — full overlap of one
  // 4-letter panel name is still an exact description.
  return overlap.shared >= 1 && overlap.ratio >= 1 && overlap.maxSharedLen >= 4;
}

const DESCRIPTION_MATCH_MIN_RATIO = 0.6;
const DESCRIPTION_MATCH_MIN_SHARED = 2;
const MATERIAL_LABOR_DELTA = 0.3;
const MATERIAL_PAINT_DELTA = 0.3;
const MATERIAL_PRICE_DELTA = 25;

type ScoredMatch = {
  row: EstimateDeltaRow;
  index: number;
  basis: EstimateLineItemDelta["matchBasis"];
  score: number;
};

const DIRECTIONAL_TOKENS = new Set([
  "lt",
  "rt",
  "ft",
  "rr",
  "front",
  "rear",
  "upper",
  "lower",
  "inner",
  "outer",
]);

// Axis + polarity per directional token. Rows conflict only when they carry
// OPPOSING polarities on the same axis ("LT" vs "RT", "Ft" vs "rear") — a
// token present on one side and absent on the other is not a conflict, so an
// OCR-garbled twin ("LT Upper bracket" vs "LT Lipper bracket") can still pair.
const DIRECTIONAL_AXIS: Record<string, [axis: string, polarity: string]> = {
  lt: ["side", "L"],
  rt: ["side", "R"],
  ft: ["long", "F"],
  front: ["long", "F"],
  rr: ["long", "R"],
  rear: ["long", "R"],
  upper: ["vert", "U"],
  lower: ["vert", "D"],
  inner: ["depth", "I"],
  outer: ["depth", "O"],
};

function directionalPolarities(tokens: string[]): Map<string, Set<string>> {
  const byAxis = new Map<string, Set<string>>();
  for (const token of tokens) {
    const entry = DIRECTIONAL_AXIS[token];
    if (!entry) continue;
    const [axis, polarity] = entry;
    const set = byAxis.get(axis) ?? new Set<string>();
    set.add(polarity);
    byAxis.set(axis, set);
  }
  return byAxis;
}

/** True when the two rows carry opposing side/position tokens on some axis. */
function hasDirectionalConflict(a: string[], b: string[]): boolean {
  const axesA = directionalPolarities(a);
  const axesB = directionalPolarities(b);
  for (const [axis, polaritiesA] of axesA) {
    const polaritiesB = axesB.get(axis);
    if (!polaritiesB || polaritiesB.size === 0) continue;
    const overlapExists = [...polaritiesA].some((polarity) => polaritiesB.has(polarity));
    if (!overlapExists) return true;
  }
  return false;
}

function findBestLowerMatch(
  higherRow: EstimateDeltaRow,
  lowerRows: EstimateDeltaRow[],
  used: Set<number>,
  options?: { exactOnly?: boolean; candidateFilter?: (lowerRow: EstimateDeltaRow) => boolean }
): ScoredMatch | null {
  let best: ScoredMatch | null = null;
  for (let index = 0; index < lowerRows.length; index += 1) {
    if (used.has(index)) continue;
    const lowerRow = lowerRows[index];
    if (options?.candidateFilter && !options.candidateFilter(lowerRow)) continue;
    let score = 0;
    let basis: EstimateLineItemDelta["matchBasis"] = "none";
    let exact = false;

    if (
      higherRow.partNumber &&
      lowerRow.partNumber &&
      higherRow.partNumber === lowerRow.partNumber
    ) {
      // Same part on OPPOSING sides is still a different line — "RT Tail lamp
      // gasket" and "LT Tail lamp gasket" share one part number, and pairing
      // across sides orphans the true counterpart and cascades mispairs
      // through the whole grommet/gasket cluster.
      if (hasDirectionalConflict(higherRow.descriptionTokens, lowerRow.descriptionTokens)) {
        continue;
      }
      // Must outrank any description-based score: sibling rows with identical
      // descriptions but different parts ("RT W'strip on body" 68498156AD /
      // 68498157AD) otherwise cross-pair and report two false part changes.
      // Description overlap breaks ties between same-part siblings ("RT Tail
      // lamp grommet" must pick the tail-lamp row, not the backup-lamp row).
      const partOverlap = tokenOverlap(higherRow.descriptionTokens, lowerRow.descriptionTokens);
      score = 200 + partOverlap.shared * 5 + Math.round(partOverlap.ratio * 10);
      basis = "part_number";
      exact = true;
    } else {
      // Side/position tokens are hard discriminators: "LT Rr fender liner"
      // is never the same line as "LT Ft fender liner", however many other
      // tokens they share. Only OPPOSING tokens on the same axis conflict.
      if (hasDirectionalConflict(higherRow.descriptionTokens, lowerRow.descriptionTokens)) {
        continue;
      }
      const overlap = tokenOverlap(higherRow.descriptionTokens, lowerRow.descriptionTokens);
      if (isDescriptionMatch(overlap)) {
        score = 40 + overlap.shared * 10 + Math.round(overlap.ratio * 20);
        basis = "description";
        // Exact token-set matches beat superset rows: "LT Hub assy" must pair
        // with "LT Hub assy", never "LT Hub assy mount bolt".
        const higherSize = new Set(higherRow.descriptionTokens).size;
        const lowerSize = new Set(lowerRow.descriptionTokens).size;
        if (overlap.ratio >= 1 && higherSize === lowerSize) {
          score += 25;
          exact = true;
        } else {
          // Penalize size mismatch so sibling rows (nut/bolt variants) lose to
          // the true counterpart when both share all of the smaller side.
          score -= Math.min(10, Math.abs(higherSize - lowerSize) * 3);
        }
        // Same-section pairs beat cross-section pairs — generic rows ("Add for
        // Clear Coat", "Mask for primer") repeat in many sections and must pair
        // within their own panel, not the first unused twin elsewhere.
        const higherSection = normalizeCategoryText(higherRow.section ?? "");
        const lowerSection = normalizeCategoryText(lowerRow.section ?? "");
        if (higherSection && lowerSection) {
          score += higherSection === lowerSection ? 10 : -5;
        }
        // Same line number is a useful tiebreaker but never the sole basis.
        if (
          higherRow.lineNumber !== null &&
          lowerRow.lineNumber !== null &&
          higherRow.lineNumber === lowerRow.lineNumber
        ) {
          score += 8;
        }
        // Penalize obviously different operations (e.g. Repl vs Blnd).
        if (
          higherRow.opCode &&
          lowerRow.opCode &&
          higherRow.opCode.toUpperCase() !== lowerRow.opCode.toUpperCase()
        ) {
          score -= 6;
        }
      }
    }

    if (options?.exactOnly && !exact) continue;
    if (score > 0 && (!best || score > best.score)) {
      best = { row: lowerRow, index, basis, score };
    }
  }
  return best;
}

/**
 * Pair rows across the two estimates and classify each material difference where
 * the higher estimate documents more scope than the lower estimate.
 */
export function matchEstimateLineItems(params: {
  lowerRows: EstimateDeltaRow[];
  higherRows: EstimateDeltaRow[];
  /**
   * True when the lower estimate text was recovered via OCR (image-only PDF).
   * Softens "absent" language because OCR may have dropped or garbled lines.
   */
  lowerIsOcr?: boolean;
  /**
   * Raw lower-estimate text (e.g. the full OCR dump). Used to seed category
   * presence when OCR flattens the table so row parsing yields few rows — the
   * category headers ("FRONT BUMPER & GRILLE", "RADIATOR SUPPORT") still appear
   * in the text, so an added line in that category reads as expanded scope
   * rather than a false missing operation.
   */
  lowerCategoryText?: string;
}): EstimateDeltaMatchResult {
  const { lowerRows, higherRows, lowerIsOcr = false, lowerCategoryText } = params;
  const used = new Set<number>();
  const deltas: EstimateLineItemDelta[] = [];
  // Reconciliation ledger: every consumed lower row records HOW it was
  // consumed so the lower-only detector (which runs LAST) can exclude every
  // reconciled line — a row must never be both a bundle counterpart and a
  // lower-only line in the same report.
  const lowerRowReconciliation: EstimateDeltaMatchResult["lowerRowReconciliation"] = [];
  const bundleConsumedLowerIndexes = new Set<number>();
  const recordLowerConsumption = (
    index: number,
    matchedAs: EstimateDeltaMatchResult["lowerRowReconciliation"][number]["matchedAs"]
  ) => {
    const row = lowerRows[index];
    if (!row) return;
    lowerRowReconciliation.push({ lineNumber: row.lineNumber, description: row.description, matchedAs });
  };
  // Some carrier layouts print no part-number column at all; that layout
  // difference must never read as per-line "part added" changes.
  // "Has a part column" means the column actually prints — a handful of stray
  // part-shaped tokens in a part-less layout must not flip this on.
  const lowerPartCount = lowerRows.filter((row) => Boolean(row.partNumber)).length;
  const lowerHasPartColumn =
    lowerPartCount >= Math.max(3, Math.ceil(lowerRows.length * 0.1));
  let matchedPairCount = 0;
  let missingOperationCount = 0;
  let expandedScopeCount = 0;
  let ocrUncertainSuppressedCount = 0;

  // Categories the lower estimate already covers (keyword-based so OCR noise and
  // line splits don't hide a present category). Seed from parsed rows AND the raw
  // lower text, because OCR can flatten the table so few rows parse while the
  // category headers still appear in the text.
  const lowerCategoryKeywords = new Set<string>();
  for (const row of lowerRows) {
    for (const kw of extractCategoryKeywords(row)) lowerCategoryKeywords.add(kw);
  }
  if (lowerCategoryText) {
    for (const kw of extractCategoryKeywordsFromText(lowerCategoryText)) {
      lowerCategoryKeywords.add(kw);
    }
  }

  // Also confirm a category by matching the higher row's own section header text
  // against the lower text — so headers like ELECTRICAL, VEHICLE DIAGNOSTICS, or
  // MISCELLANEOUS OPERATIONS confirm even when no fixed keyword applies.
  const normalizedLowerText = normalizeCategoryText(lowerCategoryText ?? "");
  // Canonicalize part numbers for OCR-tolerant comparison: OCR routinely confuses
  // S<->5, O/Q<->0, I/L<->1, B<->8, Z<->2, G<->6, so a part present in the lower
  // estimate can read slightly differently. Collapsing both sides to one canonical
  // form stops those misreads from looking like added/changed parts.
  const normalizedLowerParts = ocrCanonicalizePart(lowerCategoryText ?? "");
  const sectionPresentInLower = (section: string | null): boolean => {
    const s = normalizeCategoryText(section ?? "");
    return s.length >= 3 && normalizedLowerText.includes(s);
  };
  // OCR discriminator: is this higher line genuinely absent from the lower
  // estimate, or merely present-but-poorly-parsed by OCR? A part number missing
  // from the OCR text is a strong "genuinely added" signal; a distinctive
  // description phrase already in the OCR text means the line is present (so an
  // unmatched row is an OCR parse gap, not a real add).
  const partPresentInLower = (partNumber: string | null): boolean => {
    const p = ocrCanonicalizePart(partNumber ?? "");
    return p.length >= 4 && normalizedLowerParts.includes(p);
  };
  const descriptionPresentInLower = (row: EstimateDeltaRow): boolean => {
    // Match on the alphabetic core of the description (drop stray number/labor
    // tokens that OCR or column bleed can append) so a present line is still
    // recognized as present.
    const phrase = normalizeCategoryText(row.description)
      .split(" ")
      .filter((w) => w.length >= 2 && !/\d/.test(w))
      .join(" ");
    return phrase.length >= 5 && normalizedLowerText.includes(phrase);
  };
  const isGenuinelyAddedVsOcr = (row: EstimateDeltaRow): boolean => {
    const hasPart = (row.partNumber ?? "").replace(/[^A-Z0-9]/gi, "").length >= 4;
    if (hasPart && !partPresentInLower(row.partNumber)) return true; // part# not in OCR => added
    return !descriptionPresentInLower(row); // description phrase not in OCR => added
  };

  // Pass 1: exact matches (part number, or identical token set) claim their
  // lower rows FIRST, so a fuzzy sibling earlier in the estimate ("RT Lower
  // ball joint nut upper") cannot steal the row an exact twin needs ("LT Lower
  // ball joint nut upper").
  //
  // Staged by value agreement: repeated generic rows ("Add for Clear Coat"
  // prints once per panel) are token-identical across panels, so a purely
  // sequential claim pairs the ROOF clear coat with the LIFT GATE row and the
  // truly-shared rows then read as differences. Rows that agree on hours AND
  // section claim first, then rows that agree on hours, then any exact twin.
  const rowValuesEqual = (a: EstimateDeltaRow, b: EstimateDeltaRow) =>
    a.labor === b.labor &&
    a.paint === b.paint &&
    a.laborIncluded === b.laborIncluded &&
    a.paintIncluded === b.paintIncluded;
  const rowSectionsEqual = (a: EstimateDeltaRow, b: EstimateDeltaRow) => {
    const sectionA = normalizeCategoryText(a.section ?? "");
    const sectionB = normalizeCategoryText(b.section ?? "");
    return sectionA.length > 0 && sectionA === sectionB;
  };
  const preclaimed = new Map<number, ScoredMatch>();
  const preclaimStages: Array<(higherRow: EstimateDeltaRow, lowerRow: EstimateDeltaRow) => boolean> = [
    (higherRow, lowerRow) => rowValuesEqual(higherRow, lowerRow) && rowSectionsEqual(higherRow, lowerRow),
    (higherRow, lowerRow) => rowValuesEqual(higherRow, lowerRow),
    () => true,
  ];
  for (const stage of preclaimStages) {
    higherRows.forEach((higherRow, higherIndex) => {
      if (preclaimed.has(higherIndex)) return;
      const exactMatch = findBestLowerMatch(higherRow, lowerRows, used, {
        exactOnly: true,
        candidateFilter: (lowerRow) => stage(higherRow, lowerRow),
      });
      if (exactMatch) {
        preclaimed.set(higherIndex, exactMatch);
        used.add(exactMatch.index);
        recordLowerConsumption(exactMatch.index, "direct");
      }
    });
  }

  // Bundled-material equivalence: shops itemize glass/repair consumables
  // (BetaSeal urethane, BetaPrime, nozzles, acid brushes, cavity wax, masking
  // tape) while carriers bundle them ("Glass Kit", "Primer (invoice
  // required)", a generic "Cavity wax" allowance). An unmatched itemized
  // material with a bundled counterpart on the lower estimate is a potential
  // bundled-equivalent or invoice-dependent difference — never a confirmed
  // "not present" operation.
  // Consume the lower row that backs a bundled classification: once a line
  // like "Glass Kit" serves as the bundle counterpart for itemized shop
  // materials, it is reconciled — the lower-only detector must never also
  // list it as scope the shop omitted.
  const consumeBundleRow = (pattern: RegExp) => {
    for (let index = 0; index < lowerRows.length; index += 1) {
      if (used.has(index) || bundleConsumedLowerIndexes.has(index)) continue;
      if (pattern.test(normalizeCategoryText(lowerRows[index].description))) {
        bundleConsumedLowerIndexes.add(index);
        recordLowerConsumption(index, "bundle");
        return;
      }
    }
  };
  const bundledCounterpartFor = (higherRow: EstimateDeltaRow): string | null => {
    if (higherRow.partNumber) return null;
    const description = ` ${normalizeCategoryText(higherRow.description)} `;
    // "Mask for primer" / "Mask jambs" are labor OPERATIONS naming a material
    // as their target — never bundled-material lines.
    if (/\bMASK(?!ING TAPE)/.test(description)) return null;
    if (/(URETHANE|PRIMER|BETAPRIME|BETASEAL|NOZZLE|ACID BRUSH)/.test(description)) {
      // "(invoice required)" may reach us glued ("INVOICEREQUIRED") or
      // OCR-garbled ("INVOICEREUIRED") — match the stable head only.
      if (/GLASS KIT/.test(normalizedLowerText)) {
        consumeBundleRow(/GLASS KIT/);
        return "a bundled Glass Kit allowance";
      }
      if (/INVOICE ?RE/.test(normalizedLowerText)) return "an invoice-pending materials line";
    }
    if (/CAVITY WAX/.test(description) && /CAVITY WAX/.test(normalizedLowerText)) {
      consumeBundleRow(/CAVITY WAX/);
      return "a generic cavity-wax allowance";
    }
    if (/(MASKING|TAPE)/.test(description) && /MASKING TAPE/.test(normalizedLowerText)) {
      consumeBundleRow(/MASKING TAPE/);
      return "a generic masking-tape allowance";
    }
    return null;
  };
  const buildBundledEquivalentSummary = (higherRow: EstimateDeltaRow, counterpart: string): string =>
    `Higher estimate itemizes "${describeRow(higherRow)}"${costFragment(higherRow)}; the lower estimate carries ${counterpart} instead of this itemized line. Treat as a potential bundled-equivalent / invoice-dependent difference — reconcile against material invoices, not as confirmed missing scope.`;

  const classifyUnmatched = (higherRow: EstimateDeltaRow) => {
    // OCR-present-but-poorly-parsed: the line's part number / description is
    // already in the OCR'd lower text, so a non-match is an OCR parse gap, not
    // a real change. Record it as OCR-uncertain and DO NOT highlight it — this
    // is what stops unchanged rows (repeaters, scans, latches) being flagged
    // just because fuzzy matching failed against the OCR estimate.
    if (lowerIsOcr && !isGenuinelyAddedVsOcr(higherRow)) {
      ocrUncertainSuppressedCount += 1;
      deltas.push({
        kind: "missing_operation",
        lowerRow: null,
        higherRow,
        matchBasis: "none",
        laborDelta: higherRow.labor,
        paintDelta: higherRow.paint,
        priceDelta: higherRow.price,
        summary: buildMissingSummary(higherRow, true),
        ocrUncertain: true,
        statusLabels: [...OCR_UNCERTAIN_STATUS_LABELS],
        annotate: false,
      });
      return;
    }

    // Itemized-vs-bundled materials: reconcile against invoices, never report
    // as confirmed missing/expanded scope.
    const bundledCounterpart = bundledCounterpartFor(higherRow);
    if (bundledCounterpart) {
      expandedScopeCount += 1;
      deltas.push({
        kind: "expanded_scope",
        lowerRow: null,
        higherRow,
        matchBasis: "section_only",
        laborDelta: higherRow.labor,
        paintDelta: higherRow.paint,
        priceDelta: higherRow.price,
        summary: buildBundledEquivalentSummary(higherRow, bundledCounterpart),
        bundledEquivalentCandidate: true,
        statusLabels: ["POSSIBLE_BUNDLED_EQUIVALENT", "OPEN_TO_INVOICE"],
        annotate: true,
      });
      return;
    }

    // Genuinely absent from the lower estimate. Distinguish a brand-new
    // operation from an expansion within a category the lower estimate has.
    const categoryPresent =
      extractCategoryKeywords(higherRow).some((kw) => lowerCategoryKeywords.has(kw)) ||
      sectionPresentInLower(higherRow.section);
    if (categoryPresent) {
      expandedScopeCount += 1;
      deltas.push({
        kind: "expanded_scope",
        lowerRow: null,
        higherRow,
        matchBasis: "section_only",
        laborDelta: higherRow.labor,
        paintDelta: higherRow.paint,
        priceDelta: higherRow.price,
        summary: buildExpandedScopeSummary(higherRow, lowerIsOcr),
        annotate: true,
        ...(lowerIsOcr ? { statusLabels: ["LOWER_ESTIMATE_OCR_LIMITATION", "VERIFY_AGAINST_SOURCE"] } : {}),
      });
    } else {
      missingOperationCount += 1;
      deltas.push({
        kind: "missing_operation",
        lowerRow: null,
        higherRow,
        matchBasis: "none",
        laborDelta: higherRow.labor,
        paintDelta: higherRow.paint,
        priceDelta: higherRow.price,
        summary: buildMissingSummary(higherRow, lowerIsOcr),
        annotate: true,
        // OCR confidence: even a genuinely-added line (part# absent) stays a
        // verify item against an OCR-derived lower estimate.
        ...(lowerIsOcr
          ? { ocrUncertain: true, statusLabels: [...OCR_UNCERTAIN_STATUS_LABELS] }
          : {}),
      });
    }
  };

  const matchedPairs: EstimateDeltaMatchResult["matchedPairs"] = [];
  const classifyMatchedPair = (
    higherRow: EstimateDeltaRow,
    lowerRow: EstimateDeltaRow,
    basis: EstimateLineItemDelta["matchBasis"]
  ) => {
    matchedPairs.push({ higherRow, lowerRow, basis });
    const laborDelta = numericDelta(higherRow.labor, lowerRow.labor);
    const paintDelta = numericDelta(higherRow.paint, lowerRow.paint);
    const priceDelta = numericDelta(higherRow.price, lowerRow.price);

    if (laborDelta !== null && laborDelta >= MATERIAL_LABOR_DELTA) {
      deltas.push({
        kind: "reduced_labor",
        lowerRow,
        higherRow,
        matchBasis: basis,
        laborDelta,
        paintDelta,
        priceDelta,
        summary: buildReducedSummary(higherRow, lowerRow, "labor", laborDelta),
        changedFields: ["labor"],
        annotate: true,
      });
    } else if (paintDelta !== null && paintDelta >= MATERIAL_PAINT_DELTA) {
      deltas.push({
        kind: "reduced_paint",
        lowerRow,
        higherRow,
        matchBasis: basis,
        laborDelta,
        paintDelta,
        priceDelta,
        summary: buildReducedSummary(higherRow, lowerRow, "paint", paintDelta),
        changedFields: ["paint"],
        annotate: true,
      });
    } else if (
      priceDelta !== null &&
      priceDelta >= MATERIAL_PRICE_DELTA &&
      (higherRow.partNumber ?? null) !== (lowerRow.partNumber ?? null) &&
      // Glued part/qty/price runs split ambiguously; when the counterpart's
      // price is a plausible alternate split of this row's run (or vice
      // versa), the "difference" is a split artifact, not a price change.
      !(lowerRow.price !== null && priceSplitAlternates(higherRow).has(lowerRow.price)) &&
      !(higherRow.price !== null && priceSplitAlternates(lowerRow).has(higherRow.price))
    ) {
      deltas.push({
        kind: "part_or_price_difference",
        lowerRow,
        higherRow,
        matchBasis: basis,
        laborDelta,
        paintDelta,
        priceDelta,
        summary: buildPriceSummary(higherRow, lowerRow, priceDelta),
        changedFields: ["part_number", "price"],
        annotate: true,
      });
    } else {
      // Matched line with no material labor/paint/price delta — still a real
      // change if the OPERATION or PART TYPE changed (e.g. Blnd->Rpr on a fender,
      // R&I->Repl on an instrument panel). These are the escalations a value-only
      // diff misses.
      const changedFields = matchedFieldChanges(higherRow, lowerRow, { lowerHasPartColumn });
      if (changedFields.length > 0) {
        // Coding-only change: identical hours and amounts, only the CCC
        // operation token differs between the disconnect/handling family
        // ("Rpr Battery 0.3 M" vs "R&I Battery 0.3 M" — the shop note reads
        // "D&R 12 Volt and isolate terminal end"). Still reported, but as a
        // low-priority coding/description difference, not a scope change.
        // Repl and Blnd are excluded — those escalations are real scope.
        const codingFamily = new Set(["R&I", "RPR"]);
        const codingOnly =
          changedFields.length === 1 &&
          changedFields[0] === "operation" &&
          higherRow.labor === lowerRow.labor &&
          higherRow.paint === lowerRow.paint &&
          (higherRow.price ?? null) === (lowerRow.price ?? null) &&
          codingFamily.has((higherRow.opCode ?? "").toUpperCase()) &&
          codingFamily.has((lowerRow.opCode ?? "").toUpperCase());
        deltas.push({
          kind: "operation_change",
          lowerRow,
          higherRow,
          matchBasis: basis,
          laborDelta,
          paintDelta,
          priceDelta,
          summary: codingOnly
            ? `The estimates use different operation labels (${lowerRow.opCode} vs ${higherRow.opCode}) for the same${higherRow.labor !== null ? ` ${formatHours(higherRow.labor)}-hour` : ""} "${higherRow.description}" handling scope. Verify whether this is only a CCC coding difference before treating it as a scope change.`
            : buildOperationChangeSummary(higherRow, lowerRow, changedFields),
          changedFields,
          ...(codingOnly
            ? { codingOnlyChange: true, statusLabels: ["CODING_OR_DESCRIPTION_CHANGE"] }
            : {}),
          annotate: true,
        });
      }
    }
  };

  const unmatchedHigherRows: EstimateDeltaRow[] = [];
  for (let higherIndex = 0; higherIndex < higherRows.length; higherIndex += 1) {
    const higherRow = higherRows[higherIndex];
    const match = preclaimed.get(higherIndex) ?? findBestLowerMatch(higherRow, lowerRows, used);
    if (!match) {
      unmatchedHigherRows.push(higherRow);
      continue;
    }
    if (!used.has(match.index)) {
      used.add(match.index);
      recordLowerConsumption(match.index, "direct");
    }
    matchedPairCount += 1;
    classifyMatchedPair(higherRow, match.row, match.basis);
  }

  // Amount-unique fallback: a differently-worded misc/sublet counterpart
  // ("Subl Paid out" vs "Towing", "Interior Protection kit" vs "COVER
  // INTERIOR") shares no description tokens but carries the same extended
  // price. When that price is UNIQUE among the still-unmatched, part-less rows
  // on both sides, the two rows are the same pay item, not a missing one.
  const unmatchedPriceCounts = new Map<number, number>();
  for (const row of unmatchedHigherRows) {
    if (row.price !== null && row.price > 0 && !row.partNumber) {
      unmatchedPriceCounts.set(row.price, (unmatchedPriceCounts.get(row.price) ?? 0) + 1);
    }
  }
  for (const higherRow of unmatchedHigherRows) {
    let amountMatchIndex: number | null = null;
    if (
      higherRow.price !== null &&
      higherRow.price > 0 &&
      !higherRow.partNumber &&
      unmatchedPriceCounts.get(higherRow.price) === 1
    ) {
      const candidates: number[] = [];
      for (let index = 0; index < lowerRows.length; index += 1) {
        if (used.has(index)) continue;
        const lowerRow = lowerRows[index];
        if (lowerRow.partNumber || lowerRow.price !== higherRow.price) continue;
        // Price alone is not identity — the hours must agree too, or "Mask for
        // refinishing $10.00 / 0.5 hr" amount-pairs with "Cover car/bag
        // $10.00 / 0.3 hr" and a real omission disappears.
        if (lowerRow.labor !== higherRow.labor || lowerRow.paint !== higherRow.paint) continue;
        candidates.push(index);
      }
      if (candidates.length === 1) amountMatchIndex = candidates[0];
    }
    if (amountMatchIndex !== null) {
      used.add(amountMatchIndex);
      recordLowerConsumption(amountMatchIndex, "group");
      matchedPairCount += 1;
      classifyMatchedPair(higherRow, lowerRows[amountMatchIndex], "amount");
      continue;
    }
    // Equivalence-alias pass (protection/covering scope only): "Interior
    // Protection kit" and "Cover car/bag" are the same pay item under
    // different wording AND different allowances, so neither the amount
    // fallback (values differ) nor token matching (no shared words) pairs
    // them. Pair as a CHANGED line, never lower-only/missing.
    if (isProtectionCoverAlias(higherRow)) {
      let aliasIndex = -1;
      for (let index = 0; index < lowerRows.length; index += 1) {
        if (used.has(index)) continue;
        if (isProtectionCoverAlias(lowerRows[index])) {
          aliasIndex = index;
          break;
        }
      }
      if (aliasIndex !== -1) {
        const lowerRow = lowerRows[aliasIndex];
        used.add(aliasIndex);
        recordLowerConsumption(aliasIndex, "semantic");
        matchedPairCount += 1;
        matchedPairs.push({ higherRow, lowerRow, basis: "description" });
        const changedFields = [
          "description",
          ...((higherRow.price ?? null) !== (lowerRow.price ?? null) ? ["price"] : []),
          ...((higherRow.labor ?? null) !== (lowerRow.labor ?? null) ? ["labor"] : []),
        ];
        const describeValues = (row: EstimateDeltaRow) =>
          [
            row.price !== null ? `$${row.price.toFixed(2)}` : null,
            row.labor !== null ? `${formatHours(row.labor)} hr` : null,
          ].filter(Boolean).join(" / ") || "no amount shown";
        deltas.push({
          kind: "operation_change",
          lowerRow,
          higherRow,
          matchBasis: "description",
          laborDelta: numericDelta(higherRow.labor, lowerRow.labor),
          paintDelta: numericDelta(higherRow.paint, lowerRow.paint),
          priceDelta: numericDelta(higherRow.price, lowerRow.price),
          summary: `"${describeRow(higherRow)}" (${describeValues(higherRow)}) and the lower estimate's "${describeRow(lowerRow)}" (${describeValues(lowerRow)}) describe the same protection/covering scope with different wording. Treat as a changed line — description, amount, and labor differ — not as scope missing from either estimate.`,
          changedFields,
          statusLabels: ["EQUIVALENT_DESCRIPTION_PAIR"],
          annotate: true,
        });
        continue;
      }
    }
    classifyUnmatched(higherRow);
  }

  // Parent/child refinish reconciliation: fold an unmatched "Add for Clear
  // Coat" child into its adjacent parent refinish delta (or mark both as
  // possibly overlapping) so the same per-panel hours never read as two
  // independent confirmed gaps.
  const removedChildDeltas = reconcileClearCoatChildDeltas(deltas, lowerRows);
  for (const removed of removedChildDeltas) {
    if (removed.kind === "expanded_scope") expandedScopeCount -= 1;
    if (removed.kind === "missing_operation") missingOperationCount -= 1;
  }

  // Lines only the LOWER estimate carries — computed LAST, after every
  // reconciliation pass (direct, semantic alias, unique-amount group, bundle
  // consumption), so a reconciled line can never double as lower-only.
  // Real estimate rows always carry a line number — number-less strays are
  // adjustment/betterment or summary spillover, not operations.
  const residualLowerRows = lowerRows.filter(
    (row, index) =>
      !used.has(index) &&
      !bundleConsumedLowerIndexes.has(index) &&
      row.lineNumber !== null &&
      (row.price !== null || row.labor !== null || row.paint !== null || row.opCode !== null)
  );
  // Partition residuals: a row whose description+operation duplicates a lower
  // row that ALREADY matched a higher row (same op printed in two sections —
  // "Overlap Major Non-Adj. Panel" under ROOF and LIFT GATE, a second "R&I
  // Storage compart") is possible duplicate billing or a separate access
  // operation, NOT confirmed lower-only scope. Opposing-side twins (RT vs LT)
  // are different lines and stay genuinely lower-only.
  const duplicatesMatchedRow = (row: EstimateDeltaRow): boolean => {
    // A residual protection/covering alias duplicates the protection scope
    // when a protection pair already matched (RO 22108: SOR bills BOTH
    // "Cover interior" — the exact twin of the shop's Interior Protection
    // kit — AND "Repl Cover car/bag").
    if (
      isProtectionCoverAlias(row) &&
      matchedPairs.some((pair) => isProtectionCoverAlias(pair.lowerRow) || isProtectionCoverAlias(pair.higherRow))
    ) {
      return true;
    }
    return matchedPairs.some((pair) => {
      if ((pair.lowerRow.opCode ?? "") !== (row.opCode ?? "")) return false;
      if (hasDirectionalConflict(pair.lowerRow.descriptionTokens, row.descriptionTokens)) return false;
      const overlap = tokenOverlap(pair.lowerRow.descriptionTokens, row.descriptionTokens);
      return (
        overlap.ratio >= 1 &&
        new Set(pair.lowerRow.descriptionTokens).size === new Set(row.descriptionTokens).size
      );
    });
  };
  const lowerOnlyRows: EstimateDeltaRow[] = [];
  const potentialDuplicateLowerRows: EstimateDeltaRow[] = [];
  for (const row of residualLowerRows) {
    if (duplicatesMatchedRow(row)) {
      potentialDuplicateLowerRows.push(row);
      const index = lowerRows.indexOf(row);
      if (index !== -1) recordLowerConsumption(index, "duplicate");
    } else {
      lowerOnlyRows.push(row);
    }
  }

  return {
    deltas,
    lowerRowCount: lowerRows.length,
    higherRowCount: higherRows.length,
    matchedPairCount,
    missingOperationCount,
    expandedScopeCount,
    ocrUncertainSuppressedCount,
    lowerOnlyRows,
    matchedPairs,
    potentialDuplicateLowerRows,
    lowerRowReconciliation,
  };
}

/**
 * "Add for Clear Coat" is a CHILD of the immediately preceding refinishable
 * parent line (same section, within 3 line numbers). When the parent's paint
 * time already differs by EXACTLY the child's hours and the lower estimate
 * shows no separate clear-coat line in that section, the lower estimate's
 * time may be a combined allowance — reporting the parent difference AND the
 * child as independent gaps could double-count the same hours (RO 22108 roof
 * rails: 2.0+0.4 vs 1.6 per side). Fold the child into one grouped parent
 * finding in that exact-match case; otherwise keep both but mark them
 * POSSIBLE_OVERLAP so they are never summed as independent confirmed hours.
 * Returns the child deltas that were removed (for caller count bookkeeping).
 */
function reconcileClearCoatChildDeltas(
  deltas: EstimateLineItemDelta[],
  lowerRows: EstimateDeltaRow[]
): EstimateLineItemDelta[] {
  const removed: EstimateLineItemDelta[] = [];
  const children = deltas.filter(
    (delta) =>
      delta.lowerRow === null &&
      /\bclear coat\b/i.test(delta.higherRow.description) &&
      delta.higherRow.labor !== null &&
      delta.higherRow.lineNumber !== null
  );
  for (const child of children) {
    const childSection = normalizeCategoryText(child.higherRow.section ?? "");
    let parent: EstimateLineItemDelta | null = null;
    for (const candidate of deltas) {
      if (candidate.kind !== "reduced_paint" || candidate.lowerRow === null) continue;
      if (candidate.groupedClearCoatChild) continue;
      if (candidate.higherRow.lineNumber === null) continue;
      if (normalizeCategoryText(candidate.higherRow.section ?? "") !== childSection) continue;
      const gap = (child.higherRow.lineNumber ?? 0) - candidate.higherRow.lineNumber;
      if (gap <= 0 || gap > 3) continue;
      if (!parent || candidate.higherRow.lineNumber > (parent.higherRow.lineNumber ?? 0)) {
        parent = candidate;
      }
    }
    if (!parent || !parent.lowerRow) continue;
    // If the lower estimate DOES itemize a clear-coat line in this section,
    // its parent time is base-only and the two findings are independent.
    const lowerSection = normalizeCategoryText(parent.lowerRow.section ?? "");
    const lowerHasChild = lowerRows.some(
      (row) =>
        /\bclear coat\b/i.test(row.description) &&
        normalizeCategoryText(row.section ?? "") === lowerSection
    );
    if (lowerHasChild) continue;
    if (parent.paintDelta !== null && parent.paintDelta === child.higherRow.labor) {
      parent.groupedClearCoatChild = {
        lineNumber: child.higherRow.lineNumber,
        hours: child.higherRow.labor,
      };
      parent.statusLabels = [...new Set([...(parent.statusLabels ?? []), "GROUPED_CLEAR_COAT"])];
      parent.summary = `"${describeRow(parent.higherRow)}": refinish package differs by ${formatHours(parent.paintDelta)} paint hr (${formatHours(parent.higherRow.paint)} vs ${formatHours(parent.lowerRow.paint)}). The higher estimate separately itemizes ${formatHours(child.higherRow.labor)} hr "${describeRow(child.higherRow)}" (L${child.higherRow.lineNumber}); the lower estimate does not separately display it. Do not count the parent-time difference and the clear-coat line as separate financial gaps without confirming the lower estimate's time basis.`;
      const childIndex = deltas.indexOf(child);
      if (childIndex !== -1) {
        deltas.splice(childIndex, 1);
        removed.push(child);
      }
    } else {
      parent.statusLabels = [...new Set([...(parent.statusLabels ?? []), "POSSIBLE_OVERLAP"])];
      child.statusLabels = [...new Set([...(child.statusLabels ?? []), "POSSIBLE_OVERLAP"])];
      child.summary += ` NOTE: this clear-coat line may overlap the adjacent "${describeRow(parent.higherRow)}" refinish difference — do not sum them as independent confirmed hours without confirming the lower estimate's time basis.`;
      parent.summary += ` NOTE: the adjacent clear-coat line (L${child.higherRow.lineNumber}) may overlap this difference — do not sum them as independent confirmed hours.`;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Rate / totals lane: the ESTIMATE TOTALS block is where rate and hour-subtotal
// differences live — the single largest driver of cost gaps between two
// estimates, invisible to line-item matching.
// ---------------------------------------------------------------------------

export interface EstimateTotalsCategory {
  /** As printed: "Body Labor", "Paint Supplies", "Parts", "Miscellaneous". */
  category: string;
  hours: number | null;
  rate: number | null;
  cost: number | null;
}

export interface EstimateTotalsSummary {
  categories: EstimateTotalsCategory[];
  subtotal: number | null;
  salesTax: number | null;
  grandTotal: number | null;
}

/**
 * Parse the ESTIMATE TOTALS block ("Body Labor40.5 hrs@$ 75.00 /hr3,037.50",
 * "Parts16,930.28", "Grand Total30,673.27"). Uses the LAST totals block in the
 * document — supplement prints repeat earlier cumulative blocks.
 */
export function parseCccEstimateTotals(text: string): EstimateTotalsSummary | null {
  if (!text) return null;
  if (isFragmentedEstimateText(text)) {
    text = reflowFragmentedEstimateText(text);
  }
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^estimate totals\b/i.test(lines[index])) start = index;
  }
  if (start === -1) return null;

  const summary: EstimateTotalsSummary = {
    categories: [],
    subtotal: null,
    salesTax: null,
    grandTotal: null,
  };
  const money = (value: string) => Number(value.replace(/[$,]/g, ""));
  for (let index = start + 1; index < Math.min(lines.length, start + 25); index += 1) {
    const line = lines[index];
    if (!line) continue;
    const labor = line.match(
      /^([A-Za-z][A-Za-z ]*?)\s*(\d{1,3}(?:\.\d)?)\s*hrs?\s*@\s*\$\s*([\d,]+\.\d{2})\s*\/\s*hr\s*([\d,]+\.\d{2})$/i
    );
    if (labor) {
      summary.categories.push({
        category: labor[1].trim(),
        hours: Number(labor[2]),
        rate: money(labor[3]),
        cost: money(labor[4]),
      });
      continue;
    }
    const tax = line.match(/^sales tax\b.*?([\d,]+\.\d{2})$/i);
    if (tax) {
      summary.salesTax = money(tax[1]);
      continue;
    }
    const grand = line.match(/^(grand total|total cost of repairs?|workfile total:?)\s*\$?\s*([\d,]+\.\d{2})$/i);
    if (grand) {
      summary.grandTotal = money(grand[2]);
      continue;
    }
    const sub = line.match(/^subtotal\s*\$?\s*([\d,]+\.\d{2})$/i);
    if (sub) {
      summary.subtotal = money(sub[1]);
      continue;
    }
    const amountOnly = line.match(/^(parts|miscellaneous|other charges)\s*\$?\s*([\d,]+\.\d{2})$/i);
    if (amountOnly) {
      summary.categories.push({
        category: amountOnly[1].replace(/\b[a-z]/g, (c) => c.toUpperCase()),
        hours: null,
        rate: null,
        cost: money(amountOnly[2]),
      });
      continue;
    }
    if (/^(deductible|total adjustments|net cost)/i.test(line)) break;
  }
  return summary.categories.length > 0 || summary.grandTotal !== null ? summary : null;
}

export type EstimateTotalsDeltaKind =
  | "rate_difference"
  | "hours_difference"
  | "category_amount_difference"
  | "category_missing_on_lower"
  | "category_only_on_lower"
  | "total_difference";

export interface EstimateTotalsDelta {
  kind: EstimateTotalsDeltaKind;
  category: string;
  higher: EstimateTotalsCategory | null;
  lower: EstimateTotalsCategory | null;
  summary: string;
}

const fmtMoney = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtHours = (value: number) => `${Math.round(value * 10) / 10} hr`;

/**
 * Compare the two ESTIMATE TOTALS blocks and emit headline differences: rate
 * gaps, hour-subtotal gaps, category amount gaps, and categories one estimate
 * carries that the other does not. Pair-agnostic — works for any higher/lower
 * estimate pairing.
 */
export function compareEstimateTotals(params: {
  higher: EstimateTotalsSummary | null;
  lower: EstimateTotalsSummary | null;
}): EstimateTotalsDelta[] {
  const { higher, lower } = params;
  if (!higher || !lower) return [];
  const deltas: EstimateTotalsDelta[] = [];
  const lowerByName = new Map(lower.categories.map((c) => [c.category.toLowerCase(), c]));
  const higherNames = new Set(higher.categories.map((c) => c.category.toLowerCase()));

  for (const higherCategory of higher.categories) {
    const lowerCategory = lowerByName.get(higherCategory.category.toLowerCase()) ?? null;
    if (!lowerCategory) {
      deltas.push({
        kind: "category_missing_on_lower",
        category: higherCategory.category,
        higher: higherCategory,
        lower: null,
        summary: `${higherCategory.category} (${higherCategory.cost !== null ? fmtMoney(higherCategory.cost) : "amount unknown"}) is billed on the higher estimate but has no category on the lower estimate's totals.`,
      });
      continue;
    }
    const rateDiff =
      higherCategory.rate !== null && lowerCategory.rate !== null
        ? Math.round((higherCategory.rate - lowerCategory.rate) * 100) / 100
        : null;
    const hoursDiff =
      higherCategory.hours !== null && lowerCategory.hours !== null
        ? Math.round((higherCategory.hours - lowerCategory.hours) * 10) / 10
        : null;
    if (rateDiff !== null && Math.abs(rateDiff) >= 0.5) {
      const hourPart =
        hoursDiff !== null && Math.abs(hoursDiff) >= 0.1
          ? ` and ${fmtHours(higherCategory.hours ?? 0)} vs ${fmtHours(lowerCategory.hours ?? 0)} (${hoursDiff > 0 ? "+" : ""}${fmtHours(hoursDiff)})`
          : "";
      deltas.push({
        kind: "rate_difference",
        category: higherCategory.category,
        higher: higherCategory,
        lower: lowerCategory,
        summary: `${higherCategory.category} rate is ${fmtMoney(higherCategory.rate ?? 0)}/hr on the higher estimate vs ${fmtMoney(lowerCategory.rate ?? 0)}/hr on the lower estimate (${rateDiff > 0 ? "+" : ""}${fmtMoney(rateDiff)}/hr)${hourPart} — category total ${fmtMoney(higherCategory.cost ?? 0)} vs ${fmtMoney(lowerCategory.cost ?? 0)}.`,
      });
      continue;
    }
    if (hoursDiff !== null && Math.abs(hoursDiff) >= 0.5) {
      deltas.push({
        kind: "hours_difference",
        category: higherCategory.category,
        higher: higherCategory,
        lower: lowerCategory,
        summary: `${higherCategory.category} subtotal is ${fmtHours(higherCategory.hours ?? 0)} on the higher estimate vs ${fmtHours(lowerCategory.hours ?? 0)} on the lower estimate (${hoursDiff > 0 ? "+" : ""}${fmtHours(hoursDiff)}) at the same ${fmtMoney(lowerCategory.rate ?? 0)}/hr rate.`,
      });
      continue;
    }
    const costDiff =
      higherCategory.cost !== null && lowerCategory.cost !== null
        ? Math.round((higherCategory.cost - lowerCategory.cost) * 100) / 100
        : null;
    if (
      costDiff !== null &&
      Math.abs(costDiff) >= 100 &&
      higherCategory.rate === null // rate categories already covered above
    ) {
      deltas.push({
        kind: "category_amount_difference",
        category: higherCategory.category,
        higher: higherCategory,
        lower: lowerCategory,
        summary: `${higherCategory.category} totals ${fmtMoney(higherCategory.cost ?? 0)} on the higher estimate vs ${fmtMoney(lowerCategory.cost ?? 0)} on the lower estimate (${costDiff > 0 ? "+" : ""}${fmtMoney(costDiff)}).`,
      });
    }
  }

  for (const lowerCategory of lower.categories) {
    if (!higherNames.has(lowerCategory.category.toLowerCase())) {
      deltas.push({
        kind: "category_only_on_lower",
        category: lowerCategory.category,
        higher: null,
        lower: lowerCategory,
        summary: `${lowerCategory.category} (${lowerCategory.cost !== null ? fmtMoney(lowerCategory.cost) : "amount unknown"}${lowerCategory.hours !== null ? `, ${fmtHours(lowerCategory.hours)} @ ${fmtMoney(lowerCategory.rate ?? 0)}/hr` : ""}) appears only on the lower estimate's totals.`,
      });
    }
  }

  if (higher.grandTotal !== null && lower.grandTotal !== null) {
    const totalDiff = Math.round((higher.grandTotal - lower.grandTotal) * 100) / 100;
    if (Math.abs(totalDiff) >= 1) {
      deltas.push({
        kind: "total_difference",
        category: "Grand Total",
        higher: null,
        lower: null,
        summary: `Grand total ${fmtMoney(higher.grandTotal)} vs ${fmtMoney(lower.grandTotal)} — a ${fmtMoney(Math.abs(totalDiff))} difference.`,
      });
    }
  }

  return deltas;
}

/** Fields that differ between two matched rows (operation code / part number). */
function matchedFieldChanges(
  higher: EstimateDeltaRow,
  lower: EstimateDeltaRow,
  options?: { lowerHasPartColumn?: boolean }
): string[] {
  const changed: string[] = [];
  if (
    higher.opCode &&
    lower.opCode &&
    normalizeOpCode(higher.opCode) !== normalizeOpCode(lower.opCode)
  ) {
    changed.push("operation");
  }
  const higherPart = ocrCanonicalizePart(higher.partNumber ?? "");
  const lowerPart = ocrCanonicalizePart(lower.partNumber ?? "");
  if (higherPart && lowerPart && higherPart !== lowerPart) {
    changed.push("part_number");
  } else if (higherPart && !lowerPart && options?.lowerHasPartColumn !== false) {
    // Only meaningful when the lower estimate PRINTS part numbers at all —
    // some carrier layouts (e.g. supplement-of-record summaries) omit the part
    // column entirely, and that layout difference is not a line change.
    changed.push("part_added");
  }
  return changed;
}

/**
 * Canonical part-number form for OCR-tolerant comparison. Strips non-alphanumerics
 * and folds the character pairs OCR most often confuses (S/5, O·Q/0, I·L/1, B/8,
 * Z/2, G/6) so a slightly misread part still matches its counterpart.
 */
function ocrCanonicalizePart(value: string): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[SOQILBZG]/g, (c) =>
      c === "S" ? "5" : c === "O" || c === "Q" ? "0" : c === "I" || c === "L" ? "1" : c === "B" ? "8" : c === "Z" ? "2" : "6"
    );
}

function numericDelta(higher: number | null, lower: number | null): number | null {
  if (higher === null) return null;
  const lowerValue = lower ?? 0;
  return Math.round((higher - lowerValue) * 100) / 100;
}

function formatHours(value: number | null): string {
  if (value === null) return "0";
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

/**
 * The labor noun for a row, from its labor-type column letter. Estimate lines
 * marked M bill at the mechanical rate (often ~2x body) — calling them "body
 * labor" misstates the money at stake (RO 22108: HV isolation, calibrations,
 * firmware, DTC research are all M @ $175 vs $90 body).
 */
export function laborTypeNoun(laborType: string | null | undefined): string {
  switch ((laborType ?? "").toUpperCase()) {
    case "M": return "mechanical labor";
    case "D": return "diagnostic labor";
    case "E": return "electrical labor";
    case "F": return "frame labor";
    case "G": return "glass labor";
    case "S": return "structural labor";
    default: return "body labor";
  }
}

function costFragment(row: EstimateDeltaRow): string {
  const cost: string[] = [];
  // "Add for Clear Coat" hours are refinish time by definition; a single
  // trailing hour column parses into `labor`, but calling it body labor would
  // misstate the category (it reconciles against the PAINT subtotal).
  const hourNoun =
    /\bclear coat\b/i.test(row.description) && row.paint === null
      ? "refinish"
      : laborTypeNoun(row.laborType);
  if (row.labor !== null && row.labor > 0) cost.push(`${formatHours(row.labor)} ${hourNoun} hr`);
  if (row.paint !== null && row.paint > 0) cost.push(`${formatHours(row.paint)} paint hr`);
  if (row.price !== null && row.price > 0) cost.push(`$${row.price.toFixed(2)} parts`);
  return cost.length ? ` (${cost.join(", ")})` : "";
}

function buildMissingSummary(higherRow: EstimateDeltaRow, lowerIsOcr = false): string {
  const label = describeRow(higherRow);
  const tail = lowerIsOcr
    ? "this line is not located on the lower estimate as read. The lower estimate was machine-read from an image-only PDF (OCR_UNCERTAIN / LOWER_ESTIMATE_OCR_LIMITATION), so OCR may have dropped or garbled it — treat this as unverified, NOT a confirmed omission, and VERIFY_AGAINST_SOURCE before relying on it."
    : "this operation is not present on the lower estimate.";
  return `Higher estimate documents "${label}"${costFragment(higherRow)} in the ${higherRow.section ?? "estimate"}; ${tail}`;
}

function buildOperationChangeSummary(
  higherRow: EstimateDeltaRow,
  lowerRow: EstimateDeltaRow,
  changedFields: string[]
): string {
  const label = describeRow(higherRow);
  const parts: string[] = [];
  if (changedFields.includes("operation")) {
    parts.push(`operation ${lowerRow.opCode ?? "?"} -> ${higherRow.opCode ?? "?"}`);
  }
  if (changedFields.includes("part_number")) {
    parts.push(`part ${lowerRow.partNumber ?? "?"} -> ${higherRow.partNumber ?? "?"}`);
  }
  if (changedFields.includes("part_added")) {
    parts.push(`part added (${higherRow.partNumber})`);
  }
  return `"${label}": same line is present on both estimates but changed — ${parts.join("; ")}. Verify the operation/part change against OEM procedure and repair records.`;
}

function buildExpandedScopeSummary(higherRow: EstimateDeltaRow, lowerIsOcr = false): string {
  const label = describeRow(higherRow);
  const section = higherRow.section ?? "this category";
  const ocrNote = lowerIsOcr
    ? " (lower estimate is OCR-extracted, so exact line matching is limited)"
    : "";
  return `"${label}"${costFragment(higherRow)}: the ${section} category is already present on the lower estimate, so this reads as expanded/added scope within an existing category${ocrNote} — not a brand-new operation. Verify whether it is a teardown addition, a changed part/labor line, or supporting material against the lower estimate's ${section} lines.`;
}

function buildReducedSummary(
  higherRow: EstimateDeltaRow,
  lowerRow: EstimateDeltaRow,
  field: "labor" | "paint",
  delta: number
): string {
  const label = describeRow(higherRow);
  const higherValue = field === "labor" ? higherRow.labor : higherRow.paint;
  const lowerValue = field === "labor" ? lowerRow.labor : lowerRow.paint;
  const noun =
    field === "labor"
      ? laborTypeNoun(higherRow.laborType ?? lowerRow.laborType)
      : "paint";
  return `"${label}": higher estimate allows ${formatHours(higherValue)} ${noun} hr vs ${formatHours(lowerValue)} hr here (+${formatHours(delta)} hr difference).`;
}

function buildPriceSummary(
  higherRow: EstimateDeltaRow,
  lowerRow: EstimateDeltaRow,
  delta: number
): string {
  const label = describeRow(higherRow);
  const higherPart = higherRow.partNumber ? ` (part ${higherRow.partNumber})` : "";
  const lowerPart = lowerRow.partNumber ? ` (part ${lowerRow.partNumber})` : "";
  return `"${label}": higher estimate prices this part${higherPart} at $${(higherRow.price ?? 0).toFixed(2)} vs $${(lowerRow.price ?? 0).toFixed(2)}${lowerPart} here (+$${delta.toFixed(2)}).`;
}

function describeRow(row: EstimateDeltaRow): string {
  const op = row.opCode ? `${row.opCode} ` : "";
  return `${op}${row.description}`.trim();
}

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
  rawText: string;
  /** Opaque identifier carried through from a source PDF row anchor. */
  anchorId?: string;
  pageNumber?: number | null;
}

export type EstimateDeltaKind =
  | "missing_operation"
  | "reduced_labor"
  | "reduced_paint"
  | "part_or_price_difference";

export interface EstimateLineItemDelta {
  kind: EstimateDeltaKind;
  /** Row from the lower estimate, when one was matched. */
  lowerRow: EstimateDeltaRow | null;
  /** Row from the higher estimate that documents more scope. */
  higherRow: EstimateDeltaRow;
  /** How the two rows were paired. */
  matchBasis: "part_number" | "description" | "section_only" | "none";
  laborDelta: number | null;
  paintDelta: number | null;
  priceDelta: number | null;
  /** Plain-language summary of the difference. */
  summary: string;
}

export interface EstimateDeltaMatchResult {
  deltas: EstimateLineItemDelta[];
  lowerRowCount: number;
  higherRowCount: number;
  matchedPairCount: number;
  missingOperationCount: number;
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

const OP_CODE_PATTERN = new RegExp(
  `^(${OP_CODES.map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")).join("|")})\\b`,
  "i"
);

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
  "note",
  "rcy",
  "lkq",
  "used",
  "oem",
  "opt",
  "alt",
  "am",
]);

/** True for ALL-CAPS CCC section headers like "REAR BUMPER", "VEHICLE DIAGNOSTICS". */
export function isSectionHeader(rawText: string): boolean {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return false;
  // Section headers carry no decimal labor/paint columns and no op code.
  if (/\d+\.\d/.test(text)) return false;
  // Strip a leading line number used by some CCC layouts.
  const body = text.replace(/^\d{1,4}\s+/, "").trim();
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

function tokenizeDescription(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/\+\d+%/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !DESCRIPTION_STOPWORDS.has(token));
}

function stripLeadingMetadata(rawText: string): { body: string; lineNumber: number | null } {
  let body = rawText.replace(/\s+/g, " ").trim();
  let lineNumber: number | null = null;

  // Leading optional "Line" keyword.
  body = body.replace(/^line\s+/i, "");

  // Leading line number.
  const lineMatch = body.match(/^(\d{1,4})\b\s*/);
  if (lineMatch) {
    lineNumber = Number(lineMatch[1]);
    body = body.slice(lineMatch[0].length);
  }

  // Strip symbol tokens (#, *, **, <>) and labor-category tokens (S01/S02)
  // that sit between the line number and the operation/description.
  let changed = true;
  while (changed) {
    changed = false;
    const symbolMatch = body.match(/^(?:#|\*{1,2}|<>)\s+/);
    if (symbolMatch) {
      body = body.slice(symbolMatch[0].length);
      changed = true;
      continue;
    }
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
} {
  const tokens = body.split(" ").filter(Boolean);

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
    // No money column → treat the whole body as description (note rows, etc.).
    return {
      descriptionBody: body,
      partNumber: null,
      qty: null,
      price: null,
      labor: null,
      laborIncluded: false,
      paint: null,
      paintIncluded: false,
    };
  }

  const price = Number(tokens[priceIndex].replace(/[$,]/g, ""));

  // Labor + paint columns come after the price (skipping markers / Incl.).
  let labor: number | null = null;
  let laborIncluded = false;
  let paint: number | null = null;
  let paintIncluded = false;
  let columnSlot = 0; // 0 → labor, 1 → paint
  for (let index = priceIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (COLUMN_MARKER_PATTERN.test(token)) continue;
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
  };
}

function isPartNumberToken(token: string): boolean {
  const value = token.replace(/[.,]$/, "");
  if (value.length < 5) return false;
  if (/^\$?[\d,]+\.\d{2}$/.test(value)) return false; // money
  const hasLetter = /[A-Za-z]/.test(value);
  const hasDigit = /\d/.test(value);
  if (hasLetter && hasDigit && /^[A-Za-z0-9-]+$/.test(value)) return true;
  // Pure numeric part numbers are usually >= 6 digits (e.g. 84394021, 9132667).
  if (!hasLetter && /^\d{6,}$/.test(value)) return true;
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
  const text = (rawText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (isSectionHeader(text)) return null;

  const { body, lineNumber } = stripLeadingMetadata(text);
  if (!body) return null;

  // Operation code is optional; capture it when present.
  let opCode: string | null = null;
  let descriptionSource = body;
  const opMatch = body.match(OP_CODE_PATTERN);
  if (opMatch) {
    opCode = normalizeOpCode(opMatch[1]);
    descriptionSource = body.slice(opMatch[0].length).trim();
  }

  const columns = extractTrailingColumns(descriptionSource);
  const description = cleanDescription(columns.descriptionBody || descriptionSource);
  if (!description) return null;

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
    columns.paintIncluded;
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
    rawText: text,
    anchorId: context?.anchorId,
    pageNumber: context?.pageNumber ?? null,
  };
}

/**
 * Parse a full estimate's plain text into structured rows, tracking the active
 * CCC section header so each row knows which section it belongs to.
 */
export function parseCccEstimateRows(text: string): EstimateDeltaRow[] {
  if (!text) return [];
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const rows: EstimateDeltaRow[] = [];
  let section: string | null = null;
  for (const line of lines) {
    if (isSectionHeader(line)) {
      section = line.replace(/^\d{1,4}\s+/, "").trim();
      continue;
    }
    const row = parseCccEstimateRow(line, { section });
    if (row) rows.push(row);
  }
  return rows;
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

function tokenOverlap(
  a: string[],
  b: string[]
): { ratio: number; shared: number; maxSharedLen: number } {
  if (a.length === 0 || b.length === 0) return { ratio: 0, shared: 0, maxSharedLen: 0 };
  const setB = new Set(b);
  let shared = 0;
  let maxSharedLen = 0;
  const seen = new Set<string>();
  for (const token of a) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (setB.has(token)) {
      shared += 1;
      maxSharedLen = Math.max(maxSharedLen, token.length);
    }
  }
  const smaller = Math.min(new Set(a).size, new Set(b).size);
  return { ratio: smaller === 0 ? 0 : shared / smaller, shared, maxSharedLen };
}

/**
 * Two rows describe the same operation when they share several tokens, OR they
 * share a single distinctive token (e.g. "headliner", "spoiler") at near-total
 * overlap. The distinctive-token rule is gated on token length to avoid pairing
 * unrelated rows that happen to share one short, common word.
 */
function isDescriptionMatch(overlap: ReturnType<typeof tokenOverlap>): boolean {
  if (overlap.shared >= DESCRIPTION_MATCH_MIN_SHARED && overlap.ratio >= DESCRIPTION_MATCH_MIN_RATIO) {
    return true;
  }
  return overlap.shared >= 1 && overlap.ratio >= 0.85 && overlap.maxSharedLen >= 5;
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

function findBestLowerMatch(
  higherRow: EstimateDeltaRow,
  lowerRows: EstimateDeltaRow[],
  used: Set<number>
): ScoredMatch | null {
  let best: ScoredMatch | null = null;
  for (let index = 0; index < lowerRows.length; index += 1) {
    if (used.has(index)) continue;
    const lowerRow = lowerRows[index];
    let score = 0;
    let basis: EstimateLineItemDelta["matchBasis"] = "none";

    if (
      higherRow.partNumber &&
      lowerRow.partNumber &&
      higherRow.partNumber === lowerRow.partNumber
    ) {
      score = 100;
      basis = "part_number";
    } else {
      const overlap = tokenOverlap(higherRow.descriptionTokens, lowerRow.descriptionTokens);
      if (isDescriptionMatch(overlap)) {
        score = 40 + overlap.shared * 10 + Math.round(overlap.ratio * 20);
        basis = "description";
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
}): EstimateDeltaMatchResult {
  const { lowerRows, higherRows } = params;
  const used = new Set<number>();
  const deltas: EstimateLineItemDelta[] = [];
  let matchedPairCount = 0;
  let missingOperationCount = 0;

  for (const higherRow of higherRows) {
    const match = findBestLowerMatch(higherRow, lowerRows, used);

    if (!match) {
      // Present in the higher estimate, absent from the lower estimate.
      missingOperationCount += 1;
      deltas.push({
        kind: "missing_operation",
        lowerRow: null,
        higherRow,
        matchBasis: "none",
        laborDelta: higherRow.labor,
        paintDelta: higherRow.paint,
        priceDelta: higherRow.price,
        summary: buildMissingSummary(higherRow),
      });
      continue;
    }

    used.add(match.index);
    matchedPairCount += 1;
    const lowerRow = match.row;

    const laborDelta = numericDelta(higherRow.labor, lowerRow.labor);
    const paintDelta = numericDelta(higherRow.paint, lowerRow.paint);
    const priceDelta = numericDelta(higherRow.price, lowerRow.price);

    if (laborDelta !== null && laborDelta >= MATERIAL_LABOR_DELTA) {
      deltas.push({
        kind: "reduced_labor",
        lowerRow,
        higherRow,
        matchBasis: match.basis,
        laborDelta,
        paintDelta,
        priceDelta,
        summary: buildReducedSummary(higherRow, lowerRow, "labor", laborDelta),
      });
    } else if (paintDelta !== null && paintDelta >= MATERIAL_PAINT_DELTA) {
      deltas.push({
        kind: "reduced_paint",
        lowerRow,
        higherRow,
        matchBasis: match.basis,
        laborDelta,
        paintDelta,
        priceDelta,
        summary: buildReducedSummary(higherRow, lowerRow, "paint", paintDelta),
      });
    } else if (
      priceDelta !== null &&
      priceDelta >= MATERIAL_PRICE_DELTA &&
      (higherRow.partNumber ?? null) !== (lowerRow.partNumber ?? null)
    ) {
      deltas.push({
        kind: "part_or_price_difference",
        lowerRow,
        higherRow,
        matchBasis: match.basis,
        laborDelta,
        paintDelta,
        priceDelta,
        summary: buildPriceSummary(higherRow, lowerRow, priceDelta),
      });
    }
  }

  return {
    deltas,
    lowerRowCount: lowerRows.length,
    higherRowCount: higherRows.length,
    matchedPairCount,
    missingOperationCount,
  };
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

function buildMissingSummary(higherRow: EstimateDeltaRow): string {
  const label = describeRow(higherRow);
  const cost: string[] = [];
  if (higherRow.labor !== null && higherRow.labor > 0) cost.push(`${formatHours(higherRow.labor)} body labor hr`);
  if (higherRow.paint !== null && higherRow.paint > 0) cost.push(`${formatHours(higherRow.paint)} paint hr`);
  if (higherRow.price !== null && higherRow.price > 0) cost.push(`$${higherRow.price.toFixed(2)} parts`);
  const costText = cost.length ? ` (${cost.join(", ")})` : "";
  return `Higher estimate documents "${label}"${costText} in the ${higherRow.section ?? "estimate"}; this operation is not present on the lower estimate.`;
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
  const noun = field === "labor" ? "body labor" : "paint";
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

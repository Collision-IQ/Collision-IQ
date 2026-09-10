/**
 * Estimating-platform routing for the delta pipeline.
 *
 * WHY THIS EXISTS. Test 99 (RO 22132) handed the pipeline a Mitchell Cloud
 * supplement with a clean, embedded text layer — every one of its 52 lines,
 * every rate and the whole totals block recoverable on the first try — and
 * the run parsed none of it. The comparison lane only ever called the CCC
 * readers; the Mitchell reader that already serves the rekey sheet
 * (`rekey/mitchellEstimateReader.ts`) was never wired into the report. The
 * coverage gate then did its job and suppressed every line verdict, so the
 * report shipped with no totals, no rates, no gap and no findings.
 *
 * This module is the one place the delta pipeline decides which reader a
 * document gets. Detection keys on what the PLATFORM prints — its page
 * footer and its row anchor shape — never on a filename, a carrier or a
 * claim, so the same routing serves every future pair.
 *
 * Nothing here duplicates a reader. The Mitchell reader is reused as-is; the
 * only Mitchell-specific logic added is the adapter from its totals shape to
 * the shared `EstimateTotalsSummary`, plus the sublet-booked-as-parts
 * reclassification the Test 99 review specified.
 */
import {
  looksLikeMitchellLayout,
  parseMitchellEstimateTotals,
  readMitchellEstimate,
} from "@/lib/rekey/mitchellEstimateReader";
import {
  parseCccEstimateRows,
  parseCccEstimateTotals,
  type EstimateDeltaRow,
  type EstimateTotalsSummary,
  type ParseEstimateRowsOptions,
} from "./estimateDeltaMatcher";

export type EstimatePlatform = "ccc" | "mitchell" | "audatex";

/**
 * Footer / header markers each platform prints on every page. These are the
 * producer's own words about itself, which is the strongest evidence
 * available short of the row grammar.
 */
const MITCHELL_MARKERS = /mitchell\s+(?:cloud\s+)?estimating|mitchell\s+international|mitchell\s+service\s+code/i;
const CCC_MARKERS = /ccc\s+one\b|ccc\s+information\s+services|workfile\s+id|line\s+oper(?:ation)?\s+description/i;
const AUDATEX_MARKERS = /\baudatex\b|\bsolera\b/i;

/**
 * Which estimating platform produced this text, or null when the text
 * carries no platform evidence at all (a scanned image, a support document).
 *
 * The Mitchell decision is made TWICE, on independent evidence: the footer
 * marker OR the printed row anchor (`looksLikeMitchellLayout`, three or more
 * `<line><6-digit code>` rows). Either alone is sufficient — a text layer
 * that lost its footers still prints its rows, and a header page with no
 * rows still prints its footer.
 */
export function detectEstimatePlatform(text: string | null | undefined): EstimatePlatform | null {
  const value = text ?? "";
  if (!value.trim()) return null;
  if (MITCHELL_MARKERS.test(value) || looksLikeMitchellLayout(value)) return "mitchell";
  if (CCC_MARKERS.test(value)) return "ccc";
  if (AUDATEX_MARKERS.test(value)) return "audatex";
  // A CCC print with its header stripped still prints "ESTIMATE TOTALS" and
  // CCC operation codes; that is CCC-shaped enough to route to the CCC reader,
  // which is also the reader every other unknown layout has always had.
  if (/\bestimate totals\b/i.test(value) && /\b(?:repl|r&i|rpr|blnd|refn|subl)\b/i.test(value)) return "ccc";
  return null;
}

/** A row the print books as a purchased part that is really a vendor sublet. */
const SUBLET_NOTE_SHAPE = /\b(?:per\s+.{0,40}invoice|invoice\s+(?:obtained|attached)|sublet)\b/i;
const SUBLET_DESCRIPTION_SHAPE = /\b(?:tow(?:ing)?\b|calibrat|adas|scan\b|report\b|diagnos|unit\s+check|sublet)/i;
const MANUAL_ENTRY_SECTION = /special|manual\s+entry|additional\s+costs?/i;

/**
 * Mitchell books dealer sublets as taxable PARTS: a "Special / Manual Entry"
 * line typed `New`, with no part number, priced from a vendor invoice
 * ("Calibrate park assist camera — Per Keystone Volvo invoice", "Tow to
 * dealer"). On RO 22132 that put $917.40 of sublet work into the parts
 * column, and a parts-vs-parts comparison against the shop's true parts
 * would have been wrong by exactly that amount.
 *
 * Reclassified here, from the document's own evidence: the section it sits
 * in, the absence of a part number, and either a note naming an invoice or a
 * description naming sublet work. The row keeps its price and its line; only
 * its part-source vocabulary changes, so downstream it reads as a sublet the
 * counterpart carries — `counterpart_only` sublet, never a parts delta.
 */
export function reclassifyMitchellSubletsBookedAsParts(
  rows: EstimateDeltaRow[],
  notes: Map<number, string[]>
): { rows: EstimateDeltaRow[]; reclassified: Array<{ line: number | null; description: string; price: number | null }> } {
  const reclassified: Array<{ line: number | null; description: string; price: number | null }> = [];
  const out = rows.map((row) => {
    if (row.partNumber) return row;
    if (!(row.partSource ?? []).some((source) => /^NEW/i.test(source))) return row;
    if (!(row.price !== null && row.price > 0)) return row;
    if (!MANUAL_ENTRY_SECTION.test(row.section ?? "")) return row;
    const note = (row.lineNumber !== null ? notes.get(row.lineNumber) ?? [] : []).join(" ");
    if (!SUBLET_NOTE_SHAPE.test(note) && !SUBLET_DESCRIPTION_SHAPE.test(row.description)) return row;
    reclassified.push({ line: row.lineNumber, description: row.description, price: row.price });
    return {
      ...row,
      partSource: ["SUBLET"],
      rawText: `${row.rawText} [sublet booked as parts — reclassified from the document's own note/section]`,
    };
  });
  return { rows: out, reclassified };
}

export interface PlatformRowRead {
  platform: EstimatePlatform | null;
  rows: EstimateDeltaRow[];
  /** Mitchell coded notes keyed to the line they follow; empty for CCC. */
  notes: Map<number, string[]>;
  /** Sublet lines the platform had booked as parts (Mitchell only). */
  subletsBookedAsParts: Array<{ line: number | null; description: string; price: number | null }>;
}

/**
 * Parse line items with the reader the document's own platform calls for.
 * Unknown platforms take the CCC reader, which is the behaviour every
 * existing caller already had — this only ADDS a route for Mitchell.
 */
export function parseEstimateRowsForPlatform(
  text: string,
  options?: ParseEstimateRowsOptions
): PlatformRowRead {
  const platform = detectEstimatePlatform(text);
  if (platform === "mitchell") {
    const read = readMitchellEstimate(text);
    const { rows, reclassified } = reclassifyMitchellSubletsBookedAsParts(read.rows, read.notes);
    return { platform, rows, notes: read.notes, subletsBookedAsParts: reclassified };
  }
  return {
    platform,
    rows: parseCccEstimateRows(text, options),
    notes: new Map(),
    subletsBookedAsParts: [],
  };
}

/**
 * Parse the totals block with the reader the platform calls for, returning
 * the shared summary shape. The Mitchell reader's `tax` becomes `salesTax`;
 * its deductible (a figure CCC's block does not carry) rides along so the
 * report can state the net-to-shop gap.
 */
export function parseEstimateTotalsForPlatform(text: string): EstimateTotalsSummary | null {
  const platform = detectEstimatePlatform(text);
  if (platform === "mitchell") {
    const totals = parseMitchellEstimateTotals(text);
    if (!totals) return null;
    return {
      categories: totals.categories.map((category) => ({
        category: category.category,
        hours: category.hours,
        rate: category.rate,
        cost: category.cost,
      })),
      subtotal: totals.subtotal,
      salesTax: totals.tax,
      grandTotal: totals.grandTotal,
      taxLanes: totals.taxLanes,
      deductible: totals.deductible,
    };
  }
  return parseCccEstimateTotals(text);
}

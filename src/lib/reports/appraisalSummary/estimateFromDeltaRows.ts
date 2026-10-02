/**
 * Adapter: the delta pipeline's rows and reconciliation → `Estimate`.
 *
 * The rows are the SAME rows the pairing used (typed word-layer rows when both
 * sides had one, else the platform text reader), and the totals are the SAME
 * reconciliation the Forensic report prints — this adds no facts. What the
 * rows do not carry is read from the document's own text, each with a defined
 * fallback:
 *
 *   - the "Note:" text under a line, the "#" manual flag, and a CCC user
 *     labor-category digit (the "1" in "Test fit-Front bumper 1 1.0 1"),
 *     accepted only when the text ends in exactly the hours the row carries;
 *   - the ALTERNATE PARTS USAGE counts, accepted only when every row reads
 *     unambiguously (the counts print glued, "Aftermarket…00").
 *
 * Anything that cannot be read is left undefined, never guessed: an unread
 * usage page means the report cannot say "both OEM"; an unread note means an
 * exclusion is not cited.
 */
import type { EstimateDeltaRow, EstimateLineItemDelta } from "../estimateDeltaMatcher";
import { detectEstimatePlatform, type EstimatePlatform } from "../estimatePlatform";
import { isProfileRoutedCost } from "@/lib/rekey/rekeyVocabulary";
import type { ForensicReconciliation } from "../forensicEstimateAnalysis";
import type { MatcherPair } from "./argueItems";
import type { AltPartsUsage, Estimate, EstimateLine, EstimateTotals, LaborCat, LaborTotal } from "./types";
import { round2 } from "./types";

const LETTER_CAT: Record<string, LaborCat> = { M: "mechanical", F: "frame", S: "structural", D: "other", E: "other", G: "other" };
const OP_CODE = /^(Repl|R&I|Rpr|Subl|Blnd|O\/H|Refn|Algn|Sect|PDR)\s+/;
const SUPPLEMENT = /^(S\d{2})\s+/;
/** A part number printed at the end of the description ("Subframe bolt sc00006965-a"). */
const TRAILING_PART_NUMBER = /\s([A-Za-z]{0,3}\d{6,}-?[A-Za-z0-9]{0,3})$/;

export function labelCat(label: string): LaborCat {
  if (/alum|steel\s+repair/i.test(label)) return "aluminum";
  // "Bonded Or Welded Panel Replace" (a CCC user-defined category, RO 22299)
  // is structural panel work, priced like it.
  if (/struct|weld|bond/i.test(label)) return "structural";
  if (/frame/i.test(label)) return "frame";
  if (/mech/i.test(label)) return "mechanical";
  if (/paint|refinish/i.test(label)) return "paint";
  if (/body/i.test(label)) return "body";
  return "other";
}
const LABOR_LABEL = /labor|repair|refinish|frame|mech|struct|alum|diag|electric|glass/i;
const NON_LABOR_HOURS_BASIS = /suppl|material/i;
const STANDARD_LABOR = /^(body|paint|refinish|mechanical|frame|structural|diagnostic|electrical|glass)\b/i;

export type TotalsRead =
  | { ok: true; totals: EstimateTotals; userCategory: LaborCat; userCategories: LaborCat[] }
  | { ok: false; reason: string };

/**
 * One side's totals from the reconciliation the Forensic report printed.
 *
 * `platform` is the platform that printed this side (detectEstimatePlatform on
 * its text). A Mitchell print books two figures differently from CCC, and the
 * rekey sheet's reconciliation (rekey/rekeyLedger.ts) is what closes both to
 * the cent on F-RK2 and RO 21011:
 *
 *   - each labor category prints hours × rate PLUS a "Sublet / Add'l" amount,
 *     the dollars of the untaxed sublet rows and untyped priced rows that bill
 *     it (three scans, $569.50, inside F-RK2's $584.50 Mechanical Labor). Those
 *     dollars are on lines, so they are booked here as non-labor money and the
 *     labor cost is hours × rate; left in labor, $579.50 of F-RK2's line
 *     prices had no printed non-labor figure to reproduce, and the ledger
 *     counted them as a rate gap;
 *   - "Parts Adjustments" is a markup the platform computes on its taxed
 *     sublet parts (25% of $1,095.45 on F-RK2). It is non-labor money that no
 *     line carries, so it stays in `misc` and is named in `unlinedNonLabor`.
 */
export function totalsFromReconciliation(
  reconciliation: ForensicReconciliation,
  side: "higher" | "lower",
  platform: EstimatePlatform | null = null
): TotalsRead {
  const mitchell = platform === "mitchell";
  const check = side === "higher" ? reconciliation.higherCheck : reconciliation.lowerCheck;
  const subtotal = side === "higher" ? reconciliation.higherSubtotal : reconciliation.lowerSubtotal;
  const tax = side === "higher" ? reconciliation.higherTax : reconciliation.lowerTax;
  const grandTotal = side === "higher" ? reconciliation.higherGrandTotal : reconciliation.lowerGrandTotal;
  const which = side === "higher" ? "our" : "their";
  if (subtotal === null || tax === null || grandTotal === null) {
    return { ok: false, reason: `${which} estimate's subtotal, tax or grand total could not be read` };
  }
  if (!check.categoriesSumToSubtotal || !check.subtotalPlusTaxReachesGrandTotal) {
    return { ok: false, reason: `${which} estimate's printed categories do not reconcile to its own totals` };
  }
  const totals: EstimateTotals = { parts: 0, misc: 0, labor: [], paintSupplies: { hours: 0, rate: 0, cost: 0 }, subtotal, tax, grandTotal };
  for (const row of reconciliation.rows) {
    const own = side === "higher" ? row.higherCost : row.lowerCost;
    // Absent on this side: zero only when the engine reconciled it as zero.
    if (own === null && row.costDifference === null) {
      return { ok: false, reason: `${which} "${row.category}" figure could not be read` };
    }
    const cost = own ?? 0;
    const hours = side === "higher" ? row.higherHours : row.lowerHours;
    const rate = side === "higher" ? row.higherRate : row.lowerRate;
    if (/paint\s*(supplies|materials)|refinish\s*materials/i.test(row.category)) {
      totals.paintSupplies = { hours: hours ?? 0, rate: rate ?? 0, cost };
    } else if (NON_LABOR_HOURS_BASIS.test(row.category) && hours !== null && rate !== null) {
      // "Body Supplies 10.1 hrs @ $3.00" (RO 22335): priced from hours like
      // paint supplies, with no line of its own. Booked in misc it made the
      // strict line guard refuse the report as $30.30 of unread lines.
      if (own !== null) {
        totals.otherMaterials = [...(totals.otherMaterials ?? []), { label: row.category, hours, rate, cost }];
      }
    } else if (/^parts$/i.test(row.category.trim())) {
      totals.parts = round2(totals.parts + cost);
    } else if (hours !== null && rate !== null && (LABOR_LABEL.test(row.category) || !NON_LABOR_HOURS_BASIS.test(row.category))) {
      // A category printed as hours @ rate is labor whatever the shop named
      // it; only materials and supplies print an hours basis without being
      // labor. Matching labels alone booked RO 22299's "Bonded Or Welded
      // Panel Replace 24.5 hrs @ $135" as parts money.
      if (own !== null) {
        // Within half a cent of hours × rate is the print's own rounding, not an amount.
        const subletAddl = mitchell && Math.abs(cost - hours * rate) > 0.006 ? round2(cost - hours * rate) : 0;
        totals.labor.push({ cat: labelCat(row.category), label: row.category, hours, rate, cost: round2(cost - subletAddl) });
        if (subletAddl !== 0) totals.misc = round2(totals.misc + subletAddl);
      }
    } else {
      // Miscellaneous, sublet, and any flat-priced category with no hours basis.
      totals.misc = round2(totals.misc + cost);
      if (mitchell && cost !== 0 && /^parts\s+adjustments?$/i.test(row.category.trim())) {
        totals.unlinedNonLabor = [...(totals.unlinedNonLabor ?? []), { label: row.category, cost }];
      }
    }
  }
  const userCategories = totals.labor.filter((l: LaborTotal) => !STANDARD_LABOR.test(l.label.trim()));
  return {
    ok: true,
    totals,
    userCategory: userCategories.length === 1 ? userCategories[0].cat : "other",
    // In print order: CCC's labor-category digit N on a line names the Nth.
    userCategories: userCategories.map((l) => l.cat),
  };
}

export interface LineAnnotation {
  manual: boolean;
  note?: string;
  /** The row's printed text (first line plus wrapped continuations). */
  rowText: string;
}

/**
 * Per-line notes and manual flags from a CCC text layer. Rows are recognised by
 * a line number that increases monotonically (a note continuation such as "2 of
 * these are required" is not a row), and the scan stops at the first SUBTOTALS
 * / ESTIMATE TOTALS so a Supplement Summary's repeated lines never overwrite
 * the estimate's own.
 */
export function lineAnnotationsFromText(text: string): Map<number, LineAnnotation> {
  const out = new Map<number, LineAnnotation>();
  if (detectEstimatePlatform(text) !== "ccc") return out;
  const ROW = /^(\d{1,3})(?=[\s#*]|S\d{2}|[A-Za-z])\s*([#*]+)?/;
  let last = 0;
  let current: { line: number; ann: LineAnnotation; inNote: boolean } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(SUBTOTALS|ESTIMATE TOTALS)/i.test(line)) break;
    const row = line.match(ROW);
    const number = row ? Number(row[1]) : NaN;
    if (row && number > last && number <= last + 25) {
      last = number;
      current = { line: number, ann: { manual: (row[2] ?? "").includes("#"), rowText: line }, inNote: false };
      out.set(number, current.ann);
      continue;
    }
    if (!current || !line) continue;
    if (/^note:/i.test(line)) {
      current.inNote = true;
      const body = line.replace(/^note:\s*/i, "");
      current.ann.note = current.ann.note ? `${current.ann.note} ${body}` : body;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}|^(Supplement of Record|Preliminary Estimate|Estimate of Record|Owner:|Line\s*Oper|Price \$|LaborPaint)/i.test(line)) {
      // Page furniture ends a note; the row it belongs to may continue on the next page.
      current.inNote = false;
    } else if (/^(19|20)\d{2}\s+[A-Z]{3,5}\s/.test(line)) {
      current.inNote = false;
    } else if (current.inNote) {
      current.ann.note = `${current.ann.note} ${line}`;
    } else {
      current.ann.rowText = `${current.ann.rowText}${line}`;
    }
  }
  return out;
}

/** The ALTERNATE PARTS USAGE counts, or undefined when any row is missing or ambiguous. */
export function altPartsUsageFromText(text: string): AltPartsUsage | undefined {
  const start = text.search(/ALTERNATE PARTS USAGE/);
  if (start < 0) return undefined;
  const block = text.slice(start, start + 2000).split(/\r?\n/);
  const selected = (label: RegExp): number | undefined => {
    const row = block.find((l) => label.test(l.trim()));
    if (!row) return undefined;
    const numbers = row.replace(label, "").match(/\d+/g) ?? [];
    if (numbers.length >= 2) return Number(numbers[numbers.length - 1]);
    if (numbers.length !== 1) return undefined;
    // Glued "available" + "selected" columns: unambiguous only as two digits or all zeros.
    const run = numbers[0];
    if (/^0+$/.test(run)) return 0;
    if (run.length === 2) return Number(run[1]);
    return undefined;
  };
  const aftermarket = selected(/^Aftermarket/i);
  const optionalOem = selected(/^Optional OEM/i);
  const reconditioned = selected(/^Reconditioned/i);
  const recycled = selected(/^Recycled/i);
  if (aftermarket === undefined || optionalOem === undefined || reconditioned === undefined || recycled === undefined) {
    return undefined;
  }
  return { aftermarket, optionalOem, reconditioned, recycled };
}

/** The deductible printed under the first "Total Cost of Repairs"; undefined when the document states none. */
export function deductibleFromText(text: string): number | undefined {
  const start = text.search(/Total Cost of Repairs/i);
  if (start < 0) return undefined;
  const match = text.slice(start, start + 400).match(/^\s*Deductible\s*\$?\s*([\d,]+\.\d{2})\s*$/im);
  return match ? Number(match[1].replace(/,/g, "")) : undefined;
}

/** The vehicle line the estimate prints ("2026 RIVI R1S w/Dual Motor …"). */
export function vehicleLineFromText(text: string): string {
  for (const raw of text.split(/\r?\n/).slice(0, 120)) {
    const line = raw.trim();
    if (/^(19|20)\d{2}\s+[A-Z]{3,5}\s+\S/.test(line)) return line.replace(/-\s*\S.*$/, "").trim();
  }
  return "";
}

export function estimateFromDeltaRows(params: {
  role: "shop" | "carrier";
  fileName: string;
  rows: EstimateDeltaRow[];
  totals: EstimateTotals;
  userCategory: LaborCat;
  /** Every user-defined category in print order; digit N on a line is the Nth. */
  userCategories?: LaborCat[];
  text: string;
}): Estimate {
  const annotations = lineAnnotationsFromText(params.text);
  // Rows arrive in document order. A Supplement of Record ends with a
  // SUPPLEMENT SUMMARY whose Changed / Deleted / Added items reuse earlier
  // line numbers ("16 R&I RT Ft fender liner -0.4" after line 174); those are
  // history, not lines of this estimate, so the read stops where the
  // numbering restarts.
  let highest = 0;
  const rows = params.rows.filter((row) => {
    if (row.lineNumber === null) return true;
    if (row.lineNumber <= highest) return false;
    highest = row.lineNumber;
    return true;
  });
  // A Mitchell print lists its computed paint materials as a line as well
  // ("Additional Cost Paint/Materials $912.00" on F-RK2) and books the same
  // dollars as the totals block's Paint Materials. Read with its price, the
  // line counted them twice and stood as a $912.00 carrier line "not on our
  // sheet". The rekey sheet keys no such line (a profile setting); here the
  // line keeps its number but carries no price, and only when those lines
  // carry exactly the printed paint materials figure.
  const materialsLines =
    detectEstimatePlatform(params.text) === "mitchell"
      ? rows.filter((row) => row.price !== null && !row.partNumber && !(row.partSource ?? []).length && isProfileRoutedCost(row.description))
      : [];
  const materialsDollars = round2(materialsLines.reduce((sum, row) => sum + (row.price ?? 0), 0));
  const unpriced = new Set(
    materialsLines.length && materialsDollars === round2(params.totals.paintSupplies.cost) ? materialsLines : []
  );
  const lines: EstimateLine[] = rows.map((row, index) => {
    let desc = row.description.trim();
    let supplement = row.supplementTag ?? undefined;
    let oper = row.opCode ?? "";
    const tag = desc.match(SUPPLEMENT);
    if (tag) {
      supplement = supplement ?? tag[1];
      desc = desc.slice(tag[0].length);
    }
    const op = desc.match(OP_CODE);
    if (op && !oper) {
      oper = op[1];
      desc = desc.slice(op[0].length);
    }
    let partNumber = row.partNumber ?? undefined;
    const trailing = !partNumber ? desc.match(TRAILING_PART_NUMBER) : null;
    if (trailing) {
      partNumber = trailing[1];
      desc = desc.slice(0, trailing.index).trim();
    }
    const lineNumber = row.lineNumber ?? -(index + 1);
    const annotation = row.lineNumber !== null ? annotations.get(row.lineNumber) : undefined;
    const hours = row.labor ?? undefined;
    const letter = (row.laborType ?? "").trim().toUpperCase();
    let laborCat: LaborCat | undefined = hours ? LETTER_CAT[letter] ?? "body" : undefined;
    // A user-category digit is accepted only when the printed row ends in
    // exactly this row's hours, the digit, and then this row's paint hours if
    // it prints any ("RT Door shell (ALU)1.012.1" = 1.0 hr, category 1, 2.1 paint).
    if (hours && !letter && annotation) {
      const escape = (n: number) => n.toFixed(1).replace(".", "\\.");
      const tail = row.paint ? escape(row.paint) : "";
      const digit = annotation.rowText.replace(/\s+/g, "").match(new RegExp(`${escape(hours)}([1-4])${tail}$`));
      if (digit) {
        laborCat = (params.userCategories?.length ?? 0) > 1
          ? params.userCategories![Number(digit[1]) - 1] ?? params.userCategory
          : params.userCategory;
      }
    }
    return {
      line: lineNumber,
      oper,
      desc,
      partNumber,
      qty: row.qty ?? undefined,
      price: unpriced.has(row) ? undefined : row.price ?? undefined,
      hours,
      laborCat,
      paintHours: row.paint ?? undefined,
      note: annotation?.note,
      manual: annotation?.manual ?? false,
      supplement,
      partSource: row.partSource ?? [],
    };
  });
  return {
    role: params.role,
    fileName: params.fileName,
    vehicle: vehicleLineFromText(params.text),
    totals: params.totals,
    lines,
    altPartsUsage: altPartsUsageFromText(params.text),
    deductible: deductibleFromText(params.text),
  };
}

/** The matcher's differences as line-number pairs (merged rows name every line: "(both sides, L119/L120)"). */
export function pairsFromDeltas(deltas: EstimateLineItemDelta[]): MatcherPair[] {
  const pairs: MatcherPair[] = [];
  for (const delta of deltas) {
    const head = delta.higherRow.lineNumber;
    if (head === null) continue;
    const merged = [...delta.higherRow.description.matchAll(/\bL(\d{1,3})\b/g)].map((m) => Number(m[1]));
    const shopLines = [...new Set([head, ...merged])];
    const carrierLine = delta.lowerRow?.lineNumber ?? undefined;
    pairs.push({
      kind: delta.kind === "missing_operation" || carrierLine === undefined ? "missing" : "reduced",
      shopLines,
      carrierLine,
    });
  }
  return pairs;
}

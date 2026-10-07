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
import { readRowPrefix } from "../deltaEngine/estimateNormalize";
import type { EstimateDeltaRow, EstimateLineItemDelta } from "../estimateDeltaMatcher";
import { detectEstimatePlatform } from "../estimatePlatform";
import type { ForensicReconciliation } from "../forensicEstimateAnalysis";
import type { MatcherPair } from "./argueItems";
import type { AltPartsUsage, Estimate, EstimateLine, EstimateTotals, LaborCat, LaborTotal } from "./types";
import { round2 } from "./types";

const LETTER_CAT: Record<string, LaborCat> = { M: "mechanical", F: "frame", S: "structural", D: "other", E: "other", G: "other" };
const OP_CODE = /^(Repl|R&I|Rpr|Subl|Blnd|O\/H|Refn|Algn|Sect|PDR)\s+/;
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
/** A totals-block percentage adjustment: "Parts Discount", "Parts Markup", "Labor Adjustment". */
const TOTALS_ADJUSTMENT = /\b(discount|markup|adjustments?)\b/i;
const STANDARD_LABOR = /^(body|paint|refinish|mechanical|frame|structural|diagnostic|electrical|glass)\b/i;

export type TotalsRead =
  | { ok: true; totals: EstimateTotals; userCategory: LaborCat; userCategories: LaborCat[] }
  | { ok: false; reason: string };

/** One side's totals from the reconciliation the Forensic report printed. */
export function totalsFromReconciliation(reconciliation: ForensicReconciliation, side: "higher" | "lower"): TotalsRead {
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
    } else if (TOTALS_ADJUSTMENT.test(row.category) && hours === null) {
      // "Parts Discount -5.0 % -55.59" (RO 22319): a percentage taken on a
      // basis, with no line of its own. Booked in parts or misc it made the
      // strict line guard refuse the report as $55.59 of over-read lines.
      if (own !== null) {
        totals.totalsAdjustments = [...(totals.totalsAdjustments ?? []), { label: row.category, cost }];
      }
    } else if (/^parts$/i.test(row.category.trim())) {
      totals.parts = round2(totals.parts + cost);
    } else if (hours !== null && rate !== null && (LABOR_LABEL.test(row.category) || !NON_LABOR_HOURS_BASIS.test(row.category))) {
      // A category printed as hours @ rate is labor whatever the shop named
      // it; only materials and supplies print an hours basis without being
      // labor. Matching labels alone booked RO 22299's "Bonded Or Welded
      // Panel Replace 24.5 hrs @ $135" as parts money.
      if (own !== null) totals.labor.push({ cat: labelCat(row.category), label: row.category, hours, rate, cost });
    } else {
      // Miscellaneous, sublet, and any flat-priced category with no hours basis.
      totals.misc = round2(totals.misc + cost);
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

/** Letter categories the totals block names: an "E" line bills under "Electrical Labor". */
const LETTER_LABEL: Record<string, RegExp> = { E: /electric/i, D: /diag/i, G: /glass/i, M: /mech/i, F: /frame/i, S: /struct/i };

/**
 * Which printed shop-defined category each CCC digit ("1"-"4") names. The
 * digit is the shop's category NUMBER and the totals block prints only the
 * categories used, so "the Nth printed" fails when one is skipped: RO 21548
 * used 1 and 3, and digit 3 is the SECOND printed category, Calibration/Reset.
 * A digit takes the one printed category whose hours equal its lines' hours;
 * digits still open take the categories still open, numeric order against
 * print order, when the counts agree. Anything else stays unresolved.
 */
export function userCategoriesByDigit(digitHours: Map<string, number>, userTotals: LaborTotal[]): Map<string, LaborTotal> {
  const byDigit = new Map<string, LaborTotal>();
  const open = [...userTotals];
  for (const [digit, hours] of digitHours) {
    const same = open.filter((total) => Math.abs(total.hours - hours) < 0.05);
    if (same.length !== 1) continue;
    byDigit.set(digit, same[0]);
    open.splice(open.indexOf(same[0]), 1);
  }
  const rest = [...digitHours.keys()].filter((digit) => !byDigit.has(digit)).sort();
  if (rest.length && rest.length === open.length) rest.forEach((digit, index) => byDigit.set(digit, open[index]));
  return byDigit;
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
  // Each row's user-category digit: the one the row read carries, else the
  // one its printed text ends in (exactly this row's hours, the digit, then
  // its paint hours if it prints any: "RT Door shell (ALU)1.012.1" = 1.0 hr,
  // category 1, 2.1 paint).
  const digitOf = (row: EstimateDeltaRow): string | undefined => {
    const hours = row.labor ?? undefined;
    if (!hours) return undefined;
    const typed = (row.laborType ?? "").trim();
    if (/^[1-4]$/.test(typed)) return typed;
    if (typed) return undefined;
    const annotation = row.lineNumber !== null ? annotations.get(row.lineNumber) : undefined;
    if (!annotation) return undefined;
    const escape = (n: number) => n.toFixed(1).replace(".", "\\.");
    const tail = row.paint ? escape(row.paint) : "";
    return annotation.rowText.replace(/\s+/g, "").match(new RegExp(`${escape(hours)}([1-4])${tail}$`))?.[1];
  };
  const digitHours = new Map<string, number>();
  for (const row of rows) {
    const digit = digitOf(row);
    if (digit) digitHours.set(digit, round2((digitHours.get(digit) ?? 0) + (row.labor ?? 0)));
  }
  const byDigit = userCategoriesByDigit(
    digitHours,
    params.totals.labor.filter((total) => !STANDARD_LABOR.test(total.label.trim()))
  );
  const lines: EstimateLine[] = rows.map((row, index) => {
    let desc = row.description.trim();
    let supplement = row.supplementTag ?? undefined;
    let oper = row.opCode ?? "";
    // The row prefix — marker glyphs ("*", "<>") and the supplement tag —
    // is never the description: "<> S02 Rpr LT Upper cover" is a Rpr of
    // "LT Upper cover". Read only off a description that still carries the
    // prefix: once the operation was taken, the description is the text
    // after it, and its head is content ("Repl S4 nameplate" is a nameplate
    // named S4, not a nameplate under supplement S4).
    if (!oper) {
      const prefix = readRowPrefix(desc);
      supplement = supplement ?? prefix.supplementTag ?? undefined;
      desc = prefix.afterMarkers;
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
    const digit = digitOf(row);
    let laborCat: LaborCat | undefined = hours ? LETTER_CAT[letter] ?? "body" : undefined;
    let laborLabel: string | undefined;
    if (hours && digit) {
      const named = byDigit.get(digit);
      laborCat = named
        ? named.cat
        : (params.userCategories?.length ?? 0) > 1
          ? params.userCategories![Number(digit) - 1] ?? params.userCategory
          : params.userCategory;
      laborLabel = named?.label;
    } else if (hours && LETTER_LABEL[letter]) {
      laborLabel = params.totals.labor.find((total) => LETTER_LABEL[letter].test(total.label))?.label;
    }
    return {
      line: lineNumber,
      oper,
      desc,
      partNumber,
      qty: row.qty ?? undefined,
      price: row.price ?? undefined,
      hours,
      laborCat,
      ...(laborLabel ? { laborLabel } : {}),
      paintHours: row.paint ?? undefined,
      note: annotation?.note,
      manual: annotation?.manual ?? false,
      supplement,
      partSource: row.partSource ?? [],
      ...(row.section ? { section: row.section } : {}),
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
    platform: detectEstimatePlatform(params.text),
  };
}

/**
 * The matcher's pairs by line number: its differences, then the pairs it made
 * at equal values ("matched"), which locate a line without arguing it. A side
 * group merged into one delta ("(both sides, L41/L42)") is returned as the
 * pairs it was made of, each side with its own counterpart; merged rows that
 * carry no members name every line in the description.
 */
export function pairsFromDeltas(
  deltas: EstimateLineItemDelta[],
  equalPairs: Array<{ higherLine: number | null; lowerLine: number | null }> = []
): MatcherPair[] {
  const pairs: MatcherPair[] = [];
  const kindOf = (delta: EstimateLineItemDelta, carrierLine: number | undefined): MatcherPair["kind"] =>
    delta.kind === "missing_operation" || carrierLine === undefined ? "missing" : "reduced";
  for (const delta of deltas) {
    if (delta.mergedMembers?.length) {
      for (const member of delta.mergedMembers) {
        if (member.higherLine === null) continue;
        const carrierLine = member.lowerLine ?? undefined;
        pairs.push({ kind: kindOf(delta, carrierLine), shopLines: [member.higherLine], carrierLine });
      }
      continue;
    }
    const head = delta.higherRow.lineNumber;
    if (head === null) continue;
    const merged = [...delta.higherRow.description.matchAll(/\bL(\d{1,3})\b/g)].map((m) => Number(m[1]));
    const shopLines = [...new Set([head, ...merged, ...(delta.coveredHigherLines ?? [])])];
    const carrierLine = delta.lowerRow?.lineNumber ?? undefined;
    pairs.push({
      kind: kindOf(delta, carrierLine),
      shopLines,
      carrierLine,
      ...(delta.coveredHigherLines?.length ? { coveredByCarrierNote: true } : {}),
      ...(delta.coveredLowerLines?.length ? { coveredCarrierLines: delta.coveredLowerLines } : {}),
      ...(delta.coveredByInferenceLines?.length ? { inferredShopLines: delta.coveredByInferenceLines } : {}),
    });
  }
  const taken = new Set(pairs.flatMap((pair) => pair.shopLines));
  const takenCarrier = new Set(pairs.map((pair) => pair.carrierLine).filter((line) => line !== undefined));
  for (const pair of equalPairs) {
    if (pair.higherLine === null || pair.lowerLine === null) continue;
    if (taken.has(pair.higherLine) || takenCarrier.has(pair.lowerLine)) continue;
    pairs.push({ kind: "matched", shopLines: [pair.higherLine], carrierLine: pair.lowerLine });
  }
  return pairs;
}

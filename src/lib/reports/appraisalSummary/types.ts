/**
 * Shared shapes for the Appraisal Dispute Report's ledger engine.
 *
 * These sit ON TOP of the delta pipeline: estimateFromDeltaRows.ts adapts the
 * rows and totals the pairing already read into `Estimate` once, and every
 * module in this directory is a pure function of that shape. Nothing here
 * reads a PDF, and nothing here re-pairs lines: the pairing is the matcher's.
 */

export type LaborCat = "body" | "paint" | "mechanical" | "frame" | "structural" | "aluminum" | "other";

export interface EstimateLine {
  line: number;
  /** "Repl" | "R&I" | "Rpr" | "Subl" | "Blnd" | "O/H" | "" */
  oper?: string;
  desc: string;
  partNumber?: string;
  qty?: number;
  /** Extended price column. */
  price?: number;
  /** Labor column. */
  hours?: number;
  /** Resolved from the printed labor-type letter (M/F/S…) or user category digit. */
  laborCat?: LaborCat;
  paintHours?: number;
  /** The "Note:" text printed under the line, joined. */
  note?: string;
  /** Manual line ("#" on CCC). */
  manual?: boolean;
  /** "S01".."S0n" on a Supplement of Record. */
  supplement?: string;
  /** Part provenance as the reader typed it (A/M, LKQ, Recond…). Empty = new OEM. */
  partSource?: string[];
}

export interface LaborTotal {
  cat: LaborCat;
  label: string;
  hours: number;
  rate: number;
  cost: number;
}

export interface EstimateTotals {
  /** Parts row as printed. */
  parts: number;
  /** Every other non-labor category (Miscellaneous, Sublet, flat-priced rows), summed. 0 when none. */
  misc: number;
  /** Labor categories printed with hours AND a rate. */
  labor: LaborTotal[];
  paintSupplies: { hours: number; rate: number; cost: number };
  subtotal: number;
  tax: number;
  /** Grand Total / Total Cost of Repairs — never the net-of-deductible figure. */
  grandTotal: number;
}

export interface AltPartsUsage {
  aftermarket: number;
  optionalOem: number;
  reconditioned: number;
  recycled: number;
}

export interface Estimate {
  role: "shop" | "carrier";
  fileName: string;
  /** As the document prints it, e.g. "2026 RIVI R1S w/Dual Motor Large Pack 4D UTV Electric". */
  vehicle: string;
  totals: EstimateTotals;
  lines: EstimateLine[];
  /** CCC "ALTERNATE PARTS USAGE" page, when printed and readable. */
  altPartsUsage?: AltPartsUsage;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

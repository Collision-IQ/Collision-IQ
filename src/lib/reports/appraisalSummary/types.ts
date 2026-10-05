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
  /**
   * The totals-block category the line's hours bill under, when it is known
   * exactly ("Calibration/Reset", "Electrical Labor"). Two categories can
   * share a family at different rates, so a line is valued at its own
   * category's rate when this names one.
   */
  laborLabel?: string;
  paintHours?: number;
  /** The "Note:" text printed under the line, joined. */
  note?: string;
  /** Manual line ("#" on CCC). */
  manual?: boolean;
  /** "S01".."S0n" on a Supplement of Record. */
  supplement?: string;
  /** Part provenance as the reader typed it (A/M, LKQ, Recond…). Empty = new OEM. */
  partSource?: string[];
  /** The section header the line prints under ("FRONT BUMPER & GRILLE"), when read. */
  section?: string;
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
  /**
   * Supplies and materials other than paint that the totals block prices as
   * hours × rate ("Body Supplies 10.1 hrs @ $3.00"). No estimate line carries
   * them, so they are kept out of `misc` (whose dollars the lines must
   * reproduce). Absent when the document prints none.
   */
  otherMaterials?: Array<{ label: string; hours: number; rate: number; cost: number }>;
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
  /** The deductible the document states under its Total Cost of Repairs; absent when it does not say. */
  deductible?: number;
  /** The estimating platform the document's text prints ("ccc", "mitchell" …); null/absent when not read. */
  platform?: string | null;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

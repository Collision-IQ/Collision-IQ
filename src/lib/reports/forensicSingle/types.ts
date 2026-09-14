/**
 * forensic-single — single-estimate forensic review for Collision IQ.
 *
 * Adapter contract. Map the output of estimate-normalize.ts onto
 * `NormalizedEstimate` in adapters/from-normalized.ts. Every field the rule
 * catalog reads is declared here; nothing else is required.
 */

export type EstimatingSystem = "CCC" | "MITCHELL" | "AUDATEX" | "UNKNOWN";

export type Operation =
  | "REPL" | "RPR" | "R&I" | "R&R" | "REFN" | "BLND" | "SUBL" | "ALGN"
  | "SECT" | "OH" | "ADD" | "MANUAL" | "NOTE" | "UNKNOWN";

export type LaborType = "BODY" | "REFINISH" | "MECH" | "STRUCT" | "FRAME" | "ELEC" | "GLASS" | "DIAG" | "UNKNOWN";

export interface EstimateLine {
  /** Printed line number; null for continuation/notes rows. */
  lineNo: number | null;
  /** Section header the line sits under, e.g. "FRONT DOOR", "VEHICLE DIAGNOSTICS". */
  section: string;
  oper: Operation;
  /** Raw description as printed, one line, whitespace-collapsed. */
  desc: string;
  partNo?: string;
  qty?: number;
  /** Extended price in dollars (already qty-multiplied), null if none. */
  price: number | null;
  /** Labor hours as printed; null if blank or "Incl." */
  laborHrs: number | null;
  laborType: LaborType;
  /** Refinish hours (paint column); null if blank. */
  paintHrs: number | null;
  /** True when the hours cell printed "Incl." */
  included?: boolean;
  /** Manual entry marker (# in CCC). */
  manual?: boolean;
  /** Free-text notes attached to the line ("Sublet cost open to invoice"). */
  notes?: string[];
  /** Taxed-misc marker (T in CCC), when the extractor sees one. */
  taxed?: boolean;
  /** Side token when the extractor resolves it. */
  side?: "LT" | "RT" | "BOTH" | null;
}

export interface LaborCategoryTotal {
  category: "BODY" | "REFINISH" | "MECH" | "STRUCT" | "FRAME" | "ELEC" | "GLASS" | "DIAG" | "PAINT_SUPPLIES" | "OTHER";
  hours: number;
  rate: number;
  cost: number;
}

export interface PrintedTotals {
  parts: number;
  labor: LaborCategoryTotal[];
  paintSupplies?: { hours: number; rate: number; cost: number };
  misc: number;
  other: number;
  subtotal: number;
  salesTax: { basis: number; ratePct: number; amount: number } | null;
  grandTotal: number;
  deductible?: number | null;
  netCost?: number | null;
}

export interface EstimateHeader {
  system: EstimatingSystem;
  documentTitle?: string;          // "Estimate of Record", "Supplement 1", ...
  claimNo?: string;
  workfileId?: string;
  policyNo?: string;
  typeOfLoss?: string;
  dateOfLoss?: string;             // ISO
  printedAt?: string;              // ISO
  daysToRepair?: number | null;
  pointOfImpact?: { code?: string; label?: string } | null;
  writer?: { name?: string; license?: string; company?: string };
  adjuster?: { name?: string; phone?: string };
  owner?: { name?: string; address?: string; state?: string; isGovernment?: boolean };
  repairFacility?: { name?: string; address?: string; state?: string } | null;
  vehicle: {
    year?: number; make?: string; model?: string; trim?: string;
    vin?: string; odometer?: number; exteriorColor?: string; paintCode?: string | null;
    interiorColor?: string | null; productionDate?: string | null;
    isFleet?: boolean; isPolice?: boolean;
    options?: string[];
  };
  priorDamageNote?: string | null;
  /** Free text found under the certification block, if any. */
  certificationText?: string | null;
}

export interface NormalizedEstimate {
  header: EstimateHeader;
  lines: EstimateLine[];
  totals: PrintedTotals;
  /** Body text outside the line grid (legends, disclosures). */
  boilerplate?: string;
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type FindingClass =
  | "REPAIR_REPLACE"        // repair hours vs OEM position / replace economics
  | "RESTRAINTS"            // side-impact / airbag sensor handling
  | "STRUCTURE"             // impact path, aperture, adjust, measure
  | "GRAPHICS"              // decals/graphics removed but not replaced
  | "NOT_INCLUDED_OP"       // feather/prime/block, blend, adjust, etc.
  | "REFINISH"              // blend / tint / paint-code consistency
  | "TAX"                   // sales tax basis, exempt purchaser
  | "UPFIT"                 // fleet/police upfit equipment
  | "HEADER"                // missing header fields
  | "DOUBLE_BOOK"           // labor + sublet on same op
  | "MISC_CHARGES"          // hazardous waste, EPC
  | "HYGIENE"               // typos, certification wording
  | "ADAS"                  // scan/calibration
  | "PARTS"                 // non-OEM markers on safety/structural parts
  | "RECONCILIATION";       // printed totals do not rebuild

export interface Exposure {
  /** Dollars quantifiable at the estimate's own rates; 0 when TBD. */
  quantified: number;
  /** Optional alternative value when two defensible bases exist (e.g. goods-only tax vs. fully exempt). */
  quantifiedAlt?: number;
  /** Human note for unquantified components. */
  open?: string;
  /** Sign: positive increases the estimate, negative reduces it. */
  direction: "INCREASE" | "DECREASE" | "MIXED";
}

export interface Authority {
  kind: "MOTOR_GTE" | "CCC_GTE" | "OEM_POSITION" | "ICAR" | "STATUTE" | "REGULATION" | "TAX_GUIDANCE" | "INDUSTRY";
  label: string;              // "Ford position statement — impact sensors"
  citation?: string;          // section / doc id / URL when known
  /** Set by the narrative layer after RAG retrieval; never invented by rules. */
  verified?: boolean;
}

export interface Finding {
  id: string;                 // "F-01"
  ruleId: string;             // "RR-001"
  cls: FindingClass;
  severity: Severity;
  title: string;
  /** Line numbers implicated (empty = absence finding). */
  lineRefs: number[];
  /** Deterministic facts the rule observed — narrative must not contradict. */
  facts: string[];
  /** Authorities the rule expects to apply; narrative layer verifies/cites. */
  authorities: Authority[];
  /** Templated action; narrative layer may expand but not drop. */
  action: string;
  exposure: Exposure;
  /** Filled by narrative layer. */
  narrative?: {
    observation: string;
    basis: string;
    action: string;
    exposure: string;
  };
}

export interface ReconciliationRow {
  category: string;
  rebuiltFrom: string;
  rebuilt: number;
  printed: number;
  variance: number;
}

export interface Reconciliation {
  rows: ReconciliationRow[];
  unexplained: number;         // sum |variance| over rows; closure standard 0.00
  notes: string[];
  clearCoatCheck?: string[];
}

export interface ForensicReport {
  mode: "SINGLE";
  generatedAt: string;
  header: EstimateHeader;
  printedTotals: PrintedTotals;
  reconciliation: Reconciliation;
  verdict: { headline: string; recommendation: string; holdRelease: boolean };
  findings: Finding[];
  correctlyWritten: string[];
  exposure: {
    quantifiedLow: number;
    quantifiedHigh: number;
    openItems: string[];
  };
  checklist: { n: number; action: string; ref: string }[];
  references: string[];
}

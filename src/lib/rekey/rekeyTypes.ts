/** Shared types for the Rekey Sheet (Module A) and its verification pass (Module B). */

/** One labor lane on a keying row. CCC splits a single printed line into one
 *  record per labor type, which is why this is an array and not two fields. */
export interface RekeyLaborEntry {
  /** LAB (body), LAR (refinish), LAM (mechanical). */
  type: string;
  hours: number;
  /** Printed "Incl." — the estimator keys 0.0 and the sheet says so. */
  included: boolean;
  /** Judgment item: the source printed a value-adjacent asterisk. */
  judgment: boolean;
}

/** A miscellaneous dollar amount (sublet, hazardous waste, manual charge). */
export interface RekeyMisc {
  amount: number;
  sublet: boolean;
  /** Null when the source prints no per-line tax marker — the profile's tax
   *  setting governs, and claiming otherwise would be inventing evidence. */
  taxable: boolean | null;
  judgment: boolean;
}

export interface RekeyLedgerRow {
  id: string;
  /** Line number as printed on the source estimate. */
  sourceLine: number | null;
  /** Supplement-of-record tag printed with the line ("S1", "S2"). */
  supplementTag: string | null;
  sectionSource: string | null;
  sectionCcc: string;
  sectionMapped: boolean;
  descriptionSource: string;
  descriptionCcc: string;
  operationSource: string | null;
  operationCcc: string;
  operationMapped: boolean;
  laborOpCode: string | null;
  partTypeSource: string | null;
  partTypeCcc: string;
  partTypeEms: string | null;
  /** Whitespace-stripped, the form CCC is keyed with. */
  partNumber: string | null;
  /** As printed on the source ("M1PZ 17E810 AA"). */
  partNumberSource: string | null;
  /** Supplier named on the source's parts-vendors pages for THIS part number.
   *  Null when the pages name none — never inferred from a neighbouring row. */
  vendor: string | null;
  qty: number | null;
  price: number | null;
  /** Per-line tax marker when the source prints one; null when it does not. */
  taxable: boolean | null;
  labor: RekeyLaborEntry[];
  misc: RekeyMisc | null;
  notes: string[];
  /** False for note rows and rows routed to the profile block. */
  keyable: boolean;
  /** Short estimator-facing markers: judgment, Incl., Subl, aggregate… */
  flags: string[];
}

export interface RekeyGroup {
  group: string;
  mapped: boolean;
  rows: RekeyLedgerRow[];
  /** Per-group footer so the estimator can spot-check while keying. `other`
   *  is every labor type beyond body / paint / mechanical (glass, frame,
   *  structural, diagnostic, electrical). */
  totals: { lines: number; body: number; paint: number; mech: number; other: number; parts: number; misc: number };
}

export type RekeyProfileBasis = "printed" | "derived" | "instruction" | "unavailable";

export interface RekeyProfileField {
  field: string;
  value: number | null;
  display: string;
  basis: RekeyProfileBasis;
  note?: string;
}

export interface RekeyExpectedTotals {
  /** Categories exactly as the source totals page prints them. `extra` is
   *  what a labor category carries beyond hours x rate (sublet / additional
   *  amount), when the print states it. */
  categories: Array<{
    category: string;
    hours: number | null;
    rate: number | null;
    cost: number | null;
    extra?: number | null;
  }>;
  subtotal: number | null;
  tax: number | null;
  grandTotal: number | null;
  taxLanes: Array<{ label: string; amount: number }>;
}

/**
 * RK-02: one printed total against what the sheet's own rows add up to.
 * A sheet whose rows do not reproduce the totals it prints is not fit to key
 * from, whatever else it got right.
 */
export interface RekeyReconciliationRow {
  category: string;
  unit: "hours" | "amount";
  printed: number | null;
  derived: number;
  delta: number | null;
  closes: boolean;
}

export interface RekeyReconciliation {
  rows: RekeyReconciliationRow[];
  /** Printed line numbers that produced no keying row (RK-09). */
  unreadLines: number[];
  /** True only when every checked total closes and no line was lost. */
  closes: boolean;
  /** Plain-language reasons the sheet does not close, empty when it does. */
  failures: string[];
}

export interface RekeySheet {
  sourceFile: string;
  identity: {
    vin: string | null;
    claimNumber: string | null;
    roNumber: string | null;
    vehicle: string | null;
  };
  profile: RekeyProfileField[];
  groups: RekeyGroup[];
  rows: RekeyLedgerRow[];
  expectedTotals: RekeyExpectedTotals | null;
  reconciliation: RekeyReconciliation;
  /** The source's parts-vendors pages verbatim, so every attached vendor can
   *  be checked against the page it came from. Empty when the source has none. */
  partsVendorsBlock: string[];
  stats: {
    sourceRows: number;
    keyableRows: number;
    nonKeyableRows: number;
    foldedRefinishRows: number;
    unmappedSections: number;
    unmappedOperations: number;
    vendorsAttached: number;
  };
  warnings: string[];
}

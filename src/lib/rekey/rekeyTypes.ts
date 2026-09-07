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
  /**
   * The same operation in the TARGET system's words — what an estimator keying
   * into it types. Equal to the CCC term while the target is CCC; null where no
   * document has shown this build what that platform calls it.
   */
  operationTarget: string | null;
  operationMapped: boolean;
  laborOpCode: string | null;
  partTypeSource: string | null;
  partTypeCcc: string;
  /** The same part type in the TARGET system's words, or null where none is in
   *  evidence. */
  partTypeTarget: string | null;
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
 * RS-2: the totals the KEYED estimate will read, computed from the sheet's own
 * rows under the sheet's own profile — not copied from the source's totals
 * page. The printed gross is then a check on it, with the difference stated.
 *
 * The distinction matters because copying the printed totals makes the block
 * true by construction: it agrees with the source no matter what the rows say,
 * so an estimator keying every row on the sheet can land somewhere else and
 * the sheet will still look right.
 */
export interface RekeyDerivedTotals {
  categories: Array<{
    category: string;
    hours: number | null;
    /** What `hours` counts: labor hours, or the refinish units a materials
     *  rate is charged against. */
    unit: "hours" | "units";
    rate: number | null;
    /** Sublet / additional dollars booked inside a labor category. */
    extra: number | null;
    cost: number;
    /** How this number was arrived at, in words the estimator can check. */
    basis: string;
    /** False when the source states the amount and the rows cannot produce
     *  it — a parts adjustment whose markup rate the source never prints. */
    fromRows: boolean;
  }>;
  subtotal: number;
  /** Rate applied to the derived subtotal, and where it came from. */
  taxRate: { rate: number; basis: string } | null;
  tax: number | null;
  grandTotal: number | null;
  /** The source's printed gross, and what the derived block differs from it
   *  by. `closes` is false only when both numbers exist and disagree. */
  check: {
    printedGrandTotal: number | null;
    delta: number | null;
    closes: boolean;
    /** Figures carried from the source's totals page because the rows cannot
     *  produce them. Each contributes the printed number itself, so none can
     *  open a gap in the check — they are named so the estimator knows which
     *  part of the gross the check does not test. */
    caveats: string[];
  };
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
  /** True when every checked total closes — the arithmetic proof that the
   *  rows are the estimate. A sheet whose totals do not close is refused. */
  totalsClose: boolean;
  /** True only when every checked total closes AND no printed line was lost.
   *  A lost line with closing totals is headlined on the sheet, not refused:
   *  the loss is unproven (a zero-value line, or a line the count read that
   *  the totals did not), and the rows themselves are proven. */
  closes: boolean;
  /** Plain-language reasons the sheet does not close, empty when it does. */
  failures: string[];
}

/** The estimating platform whose print a source estimate came off. Null where
 *  neither layout claimed it — an unknown print is never asserted to be one. */
export type RekeySourcePlatform = "mitchell" | "ccc";

import type { RekeyTarget } from "./rekeyTargets";

export interface RekeySheet {
  sourceFile: string;
  /** Which platform wrote the source estimate, when its own print says so. */
  sourcePlatform: RekeySourcePlatform | null;
  /** Which system this sheet is keyed INTO. Every row's translated fields are
   *  this target's vocabulary. */
  target: RekeyTarget;
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
  /** RS-2: what the rows and the profile add up to, checked against the
   *  printed gross. Null when the source prints no totals page to check. */
  derivedTotals: RekeyDerivedTotals | null;
  reconciliation: RekeyReconciliation;
  /** The source's parts-vendors pages verbatim, so every attached vendor can
   *  be checked against the page it came from. Empty when the source has none. */
  partsVendorsBlock: string[];
  stats: {
    sourceRows: number;
    keyableRows: number;
    nonKeyableRows: number;
    foldedRefinishRows: number;
    /** RK-09: printed lines that carry a note to the person keying, attached
     *  to the row above them. Counted so the line accounting can close. */
    noteLines: number;
    unmappedSections: number;
    /** Rows whose operation this build could not translate, whatever the
     *  reason. The two halves below say which reason, because they call for
     *  different work from the estimator. */
    unmappedOperations: number;
    /** The print states an operation and this build has no translation. */
    untranslatedOperations: number;
    /** The print states no operation at all against the line. */
    unstatedOperations: number;
    vendorsAttached: number;
    /** RS-3: rows whose part number and quantity came from the page's own
     *  measured column bands rather than from a split of the reflowed text. */
    columnsMeasured: number;
  };
  warnings: string[];
}

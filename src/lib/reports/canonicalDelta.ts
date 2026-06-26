import { randomUUID } from "node:crypto";
import type { EstimateComparisonRow, WorkspaceEstimateComparisons } from "@/types/workspaceTypes";

/**
 * Canonical delta object: the single source of truth for all version-to-version
 * estimate differences. Every report that renders a delta (Delta Citation Density,
 * Repair Intelligence, Snapshot, Customer Report) must read from this object.
 *
 * Hard stop invariant: the two estimate inputs must resolve to distinct file hashes.
 * The original defect emitted the same hash (pdf 2214d83d37) on every finding because
 * the supplement was never loaded into the delta path.
 */

// ---------------------------------------------------------------------------
// Delta class taxonomy
// ---------------------------------------------------------------------------

export type CanonicalDeltaClass =
  | "PRESENCE"
  | "VALUE_CHANGE"
  | "PART_SWAP"
  | "PART_SWAP_WITH_PRICE_CHANGE"
  | "NON_DELTA";

export type CanonicalDeltaSubclass = "added" | "removed" | "restructured" | "moved";

export type CanonicalDeltaAnchor = {
  page: number;
  line: number | number[];
  desc?: string;
} | null;

export type CanonicalDeltaEntry = {
  /** Stable identifier matching the golden fixture (D01 … D30). */
  id: string;
  class: CanonicalDeltaClass;
  subclass?: CanonicalDeltaSubclass;
  operation: string;
  partNumber?: string | null;
  /** Where this line appears in the initial (lower) estimate, or null if added. */
  anchorInitial: CanonicalDeltaAnchor;
  /** Where this line appears in the supplement (higher) estimate, or null if removed. */
  anchorFinal: CanonicalDeltaAnchor;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  magnitudeDollar?: number;
  magnitudeLaborHrs?: number;
  category: string;
  /**
   * Whether this delta should be rendered. Set by applyDisplayThreshold.
   * NON_DELTA is always false. PRESENCE/PART_SWAP/PART_SWAP_WITH_PRICE_CHANGE always true.
   * VALUE_CHANGE suppressed below floor but retained and counted in reconciliation.
   */
  render: boolean;
  note?: string;
};

// ---------------------------------------------------------------------------
// Estimate pair kind (item 1)
// ---------------------------------------------------------------------------

/**
 * Describes the relationship between the two estimates in the delta pair.
 * Drives label vocabulary and banned-phrase enforcement.
 *
 *   shop_to_shop    — both estimates are authored by the same shop (initial vs supplement)
 *   carrier_to_shop — carrier estimate vs shop estimate
 *   shop_to_carrier — shop estimate vs carrier estimate
 *   unknown         — relationship cannot be determined
 */
export type EstimatePairKind =
  | "shop_to_shop"
  | "carrier_to_shop"
  | "shop_to_carrier"
  | "carrier_to_carrier"
  | "unknown";

// ---------------------------------------------------------------------------
// Estimate file metadata (item 4)
// ---------------------------------------------------------------------------

export type CanonicalEstimateFileMeta = {
  fileHash: string;
  filename: string;
  /** Grand total in dollars from the estimate. */
  total: number;
  /** Insurance company name (e.g. "USAA"). Must not equal the insured's name. */
  insurer: string | null;
  /** Header/provenance-derived document role. Claim metadata alone must not set this to carrier. */
  estimateRole?: "carrier_estimate" | "shop_initial" | "shop_supplement" | "shop_final" | "independent_appraiser" | "unknown";
  sourceDocumentId?: string;
};

export type CanonicalDeltaEstimateFiles = {
  initial: CanonicalEstimateFileMeta;
  supplement: CanonicalEstimateFileMeta;
  /** Owner/insured name (e.g. "OLIVARES, ESMON"). */
  insuredName: string | null;
  ownerName: string | null;
};

// ---------------------------------------------------------------------------
// Reconciliation, threshold, and the canonical delta set
// ---------------------------------------------------------------------------

export type CanonicalDeltaReconciliation = {
  method: "category_subtotal";
  /**
   * Dollar change per changed CCC category. Categories not listed here are
   * unchanged. These are estimate category subtotals, NOT sums of individual
   * delta magnitudes (CCC line prices don't sum to category totals due to
   * overlap deducts, Incl. parts, labor-rate multipliers, taxed-misc).
   */
  categoryDeltas: Record<string, number>;
  subtotalDelta: number;
  taxDelta: number;
  grandTotalDelta: number;
};

export type CanonicalDeltaDisplayThreshold = {
  valueChangeDollarFloor: number;
  valueChangeLaborFloorHours: number;
  /** Delta classes subject to floor filtering. */
  appliesTo: CanonicalDeltaClass[];
  /** Delta classes that always render regardless of magnitude. */
  neverSuppress: CanonicalDeltaClass[];
};

export type CanonicalDeltaSet = {
  /** Stable UUID referenced by every consuming report to trace their output to this object. */
  id: string;
  /** SHA-256 (or equivalent) hash of the initial estimate file. Kept top-level for fast equality checks. */
  initialFileHash: string;
  /** SHA-256 (or equivalent) hash of the supplement estimate file. Must differ from initialFileHash. */
  supplementFileHash: string;
  /** Relationship between the two estimates. Drives label vocabulary and banned-phrase enforcement. */
  estimatePairKind: EstimatePairKind;
  /** Rich file metadata for both estimates. */
  estimateFiles: CanonicalDeltaEstimateFiles;
  deltas: CanonicalDeltaEntry[];
  reconciliation: CanonicalDeltaReconciliation;
  displayThreshold: CanonicalDeltaDisplayThreshold;
  createdAt: string;
};

export const DEFAULT_DISPLAY_THRESHOLD: CanonicalDeltaDisplayThreshold = {
  valueChangeDollarFloor: 1.00,
  valueChangeLaborFloorHours: 0.1,
  appliesTo: ["VALUE_CHANGE"],
  neverSuppress: ["PRESENCE", "PART_SWAP", "PART_SWAP_WITH_PRICE_CHANGE"],
};

// ---------------------------------------------------------------------------
// Hard stop: distinct file hashes (item 5a)
// ---------------------------------------------------------------------------

/**
 * Asserts that both estimate inputs resolve to distinct file hashes.
 * Throws immediately if hashes are equal or empty — this is the HARD STOP
 * that prevents the original defect (same hash emitted on every finding).
 */
export function assertDistinctFileHashes(
  initialHash: string,
  supplementHash: string
): void {
  if (!initialHash || !supplementHash) {
    throw new Error(
      "[canonical-delta] HARD STOP: one or both file hashes are empty. " +
      "Each estimate must carry a content hash before building a canonical delta set."
    );
  }
  if (initialHash === supplementHash) {
    throw new Error(
      `[canonical-delta] HARD STOP: both inputs resolve to the same file hash (${initialHash}). ` +
      "The canonical delta set requires two distinct file hashes. " +
      "Original defect: the supplement was never loaded into the delta path, so pdf 2214d83d37 " +
      "appeared on every finding."
    );
  }
}

// ---------------------------------------------------------------------------
// Hard stop: distinct totals (item 5b)
// ---------------------------------------------------------------------------

/**
 * Asserts that the two estimate totals differ.
 * Throws if initial.total === supplement.total — identical totals cannot
 * produce a meaningful delta set (and likely indicates the same file was
 * loaded twice).
 */
export function assertDistinctTotals(initialTotal: number, supplementTotal: number): void {
  if (initialTotal === supplementTotal) {
    throw new Error(
      `[canonical-delta] HARD STOP: initial.total ($${initialTotal.toFixed(2)}) === ` +
      `supplement.total ($${supplementTotal.toFixed(2)}). ` +
      "Two estimates with identical totals cannot produce a meaningful delta set. " +
      "Verify the supplement file was correctly loaded."
    );
  }
}

// ---------------------------------------------------------------------------
// Hard stop: insurer must not resolve to insured's name (item 5c)
// ---------------------------------------------------------------------------

/**
 * Asserts that the parsed insurer field does not contain the insured's last name.
 * The insurer is the insurance company (e.g. "USAA"); the insured is the vehicle owner
 * (e.g. "OLIVARES, ESMON"). If the parser picks up the wrong field, the build must fail.
 */
export function assertInsurerNotInsured(
  insurer: string | null,
  insuredName: string | null
): void {
  if (!insurer || !insuredName) return;
  const insurerNorm = insurer.toUpperCase().trim();
  const insuredLastName = insuredName.toUpperCase().trim().split(/[,\s]+/)[0];
  if (insuredLastName.length >= 4 && insurerNorm.includes(insuredLastName)) {
    throw new Error(
      `[canonical-delta] HARD STOP: insurer field "${insurer}" contains the insured's name ` +
      `"${insuredName}". The parser picked up the Owner/Insured field instead of Insurance Company. ` +
      "The insurer must be the insurance company (e.g. USAA), not the vehicle owner."
    );
  }
}

// ---------------------------------------------------------------------------
// Hard stop: carrier wording banned for shop_to_shop (items 3, 5d-5e)
// ---------------------------------------------------------------------------

/** Phrases that must never appear in rendered output for a shop_to_shop delta pair. */
export const SHOP_TO_SHOP_BANNED_PATTERNS: RegExp[] = [
  /carrier\s+estimate/i,
  /carrier\s+plan/i,
  /carrier\s+pressure\s+points/i,
  /present\s+only\s+in\s+carrier\s+estimate/i,
  /insurer\s+estimate\s+may\s+be\s+missing\s+items/i,
  /\[REDACTED_INSURER\]\s+ESTIMATE\s+MAY\s+BE\s+MISSING\s+ITEMS/i,
];

/**
 * Asserts that the given text does not contain carrier/insurer wording that is
 * forbidden for shop_to_shop estimate pairs. No-ops for other pair kinds.
 */
export function assertNoCarrierWording(
  estimatePairKind: EstimatePairKind,
  text: string,
  context?: string
): void {
  if (estimatePairKind !== "shop_to_shop") return;
  for (const pattern of SHOP_TO_SHOP_BANNED_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(
        `[canonical-delta] HARD STOP: shop_to_shop pair — banned carrier wording ` +
        `matching /${pattern.source}/ found` +
        (context ? ` in ${context}` : "") + "."
      );
    }
  }
}

/**
 * Returns true if the text contains any banned carrier-wording for a shop_to_shop pair.
 * Useful for soft checks / test assertions without throwing.
 */
export function hasCarrierWording(text: string): boolean {
  return SHOP_TO_SHOP_BANNED_PATTERNS.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildCanonicalDeltaSet(params: {
  id?: string;
  initialFileHash: string;
  supplementFileHash: string;
  estimatePairKind: EstimatePairKind;
  estimateFiles: CanonicalDeltaEstimateFiles;
  deltas: CanonicalDeltaEntry[];
  reconciliation: CanonicalDeltaReconciliation;
  displayThreshold?: Partial<CanonicalDeltaDisplayThreshold>;
}): CanonicalDeltaSet {
  assertDistinctFileHashes(params.initialFileHash, params.supplementFileHash);
  assertDistinctTotals(params.estimateFiles.initial.total, params.estimateFiles.supplement.total);
  assertInsurerNotInsured(params.estimateFiles.initial.insurer, params.estimateFiles.insuredName);
  assertInsurerNotInsured(params.estimateFiles.supplement.insurer, params.estimateFiles.insuredName);

  const displayThreshold: CanonicalDeltaDisplayThreshold = {
    ...DEFAULT_DISPLAY_THRESHOLD,
    ...params.displayThreshold,
  };

  return {
    id: params.id ?? randomUUID(),
    initialFileHash: params.initialFileHash,
    supplementFileHash: params.supplementFileHash,
    estimatePairKind: params.estimatePairKind,
    estimateFiles: params.estimateFiles,
    deltas: params.deltas,
    reconciliation: params.reconciliation,
    displayThreshold,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Display threshold
// ---------------------------------------------------------------------------

/**
 * Returns whether a single delta entry should be rendered.
 * NON_DELTA never renders. PRESENCE, PART_SWAP, PART_SWAP_WITH_PRICE_CHANGE always render.
 * VALUE_CHANGE is suppressed below the floor but retained in the object for reconciliation.
 */
export function shouldRenderDelta(
  delta: CanonicalDeltaEntry,
  threshold: CanonicalDeltaDisplayThreshold
): boolean {
  if (delta.class === "NON_DELTA") return false;
  if (threshold.neverSuppress.includes(delta.class)) return true;
  if (!threshold.appliesTo.includes(delta.class)) return true;

  const dollar = delta.magnitudeDollar;
  const labor = delta.magnitudeLaborHrs;
  const hasDollar = dollar !== undefined;
  const hasLabor = labor !== undefined;

  if (!hasDollar && !hasLabor) return false;

  const dollarAboveFloor = hasDollar && Math.abs(dollar!) >= threshold.valueChangeDollarFloor;
  const laborAboveFloor = hasLabor && Math.abs(labor!) >= threshold.valueChangeLaborFloorHours;

  return dollarAboveFloor || laborAboveFloor;
}

/**
 * Returns a new delta set with render flags applied per the display threshold.
 * Does not mutate the original.
 */
export function applyDisplayThreshold(deltaSet: CanonicalDeltaSet): CanonicalDeltaSet {
  return {
    ...deltaSet,
    deltas: deltaSet.deltas.map((delta) => ({
      ...delta,
      render: shouldRenderDelta(delta, deltaSet.displayThreshold),
    })),
  };
}

// ---------------------------------------------------------------------------
// Reconciliation invariant
// ---------------------------------------------------------------------------

/**
 * Asserts the category-level reconciliation invariant on a canonical delta set.
 *
 * Three clauses (all must hold within 0.02 tolerance):
 *   1. sum(categoryDeltas) == subtotalDelta
 *   2. round(subtotalDelta * 0.06, 2) == taxDelta
 *   3. subtotalDelta + taxDelta == grandTotalDelta
 *
 * Throws "delta set incomplete" if any clause fails.
 */
export function assertReconciliation(deltaSet: CanonicalDeltaSet): void {
  const r = deltaSet.reconciliation;
  const TOLERANCE = 0.02;

  const categorySum = Object.values(r.categoryDeltas).reduce((acc, v) => acc + v, 0);
  const roundedCategorySum = Math.round(categorySum * 100) / 100;
  if (Math.abs(roundedCategorySum - r.subtotalDelta) > TOLERANCE) {
    throw new Error(
      `[canonical-delta] delta set incomplete: sum of category_deltas ` +
      `(${roundedCategorySum.toFixed(2)}) ≠ subtotal_delta (${r.subtotalDelta.toFixed(2)})`
    );
  }

  const expectedTax = Math.round(r.subtotalDelta * 0.06 * 100) / 100;
  if (Math.abs(expectedTax - r.taxDelta) > TOLERANCE) {
    throw new Error(
      `[canonical-delta] delta set incomplete: round(subtotal_delta × 0.06) ` +
      `= ${expectedTax.toFixed(2)} ≠ tax_delta (${r.taxDelta.toFixed(2)})`
    );
  }

  const expectedGrand = Math.round((r.subtotalDelta + r.taxDelta) * 100) / 100;
  if (Math.abs(expectedGrand - r.grandTotalDelta) > TOLERANCE) {
    throw new Error(
      `[canonical-delta] delta set incomplete: subtotal_delta + tax_delta ` +
      `= ${expectedGrand.toFixed(2)} ≠ grand_total_delta (${r.grandTotalDelta.toFixed(2)})`
    );
  }
}

// ---------------------------------------------------------------------------
// Labels — canonical vocabulary, never "ESTIMATE GAP ONLY" (item 8)
// ---------------------------------------------------------------------------

/**
 * Returns the canonical display label for a delta entry.
 *
 * Required vocabulary (Prompt 3):
 *   PRESENT ONLY IN SUPPLEMENT
 *   PRESENT ONLY IN INITIAL
 *   VALUE CHANGED
 *   PART SWAPPED
 *   PART SWAPPED + PRICE CHANGED
 *
 * The label "ESTIMATE GAP ONLY" is FORBIDDEN.
 * For shop_to_shop pairs, "carrier" language is also forbidden (items 3, 5d).
 */
export function getDeltaLabel(
  delta: CanonicalDeltaEntry,
  _pairKind?: EstimatePairKind
): string {
  if (delta.class === "NON_DELTA") return "POSITION ONLY";
  if (delta.class === "PART_SWAP") return "PART SWAPPED";
  if (delta.class === "PART_SWAP_WITH_PRICE_CHANGE") return "PART SWAPPED + PRICE CHANGED";
  if (delta.class === "VALUE_CHANGE") return "VALUE CHANGED";
  // PRESENCE — direction from anchors
  if (delta.anchorInitial === null) return "PRESENT ONLY IN SUPPLEMENT";
  if (delta.anchorFinal === null) return "PRESENT ONLY IN INITIAL";
  return "PRESENT ONLY IN SUPPLEMENT"; // restructured/moved that is not NON_DELTA
}

// ---------------------------------------------------------------------------
// Vendor / accessory authority classification (items 6, 7)
// ---------------------------------------------------------------------------

/** Known vendor and accessory domains that must NOT be classified as OEM authority. */
const VENDOR_ACCESSORY_DOMAINS = [
  "teslaunch",
  "teslafi",
  "teslarati",
  "teslamodowners",
  "aftermarketauto",
  "oempartsonline",
  "rockauto",
  "autozone",
  "advanceautoparts",
  "oreillyauto",
  "ebay.com/itm",
  "amazon.com/dp",
  "amazon.com/gp",
  "carid.com",
  "tirerack.com",
  "discounttire.com",
];

/**
 * Returns true if the URL belongs to a vendor or accessory website that must be
 * classified as "vendor_accessory" authority, not "oem_procedure" or "adas_procedure".
 */
export function isVendorAccessoryUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return VENDOR_ACCESSORY_DOMAINS.some((domain) => lower.includes(domain));
}

/**
 * Asserts that a vendor_accessory source is not being counted as OEM authority.
 * Throws if a vendor URL is mislabeled as OEM, ADAS, or P-page authority.
 */
export function assertVendorNotOemAuthority(
  url: string,
  classifiedType: string
): void {
  if (!isVendorAccessoryUrl(url)) return;
  if (/oem|adas|p_page|motor|scrs|deg/i.test(classifiedType)) {
    throw new Error(
      `[canonical-delta] HARD STOP: vendor/accessory URL "${url}" was classified as ` +
      `"${classifiedType}" authority. Vendor links must be classified as "vendor_accessory", ` +
      "not as OEM, ADAS, P-page, or regulatory authority."
    );
  }
}

/**
 * Asserts that vendor/accessory links do not inflate the primary estimate-file count.
 * The primary file count must only reflect uploaded estimates, OEM docs, and verified
 * authority sources — not vendor product pages.
 */
export function assertVendorNotCountedAsEstimateFile(
  sourceType: string,
  context?: string
): void {
  if (sourceType === "vendor_accessory") {
    throw new Error(
      `[canonical-delta] HARD STOP: vendor_accessory source ` +
      (context ? `"${context}" ` : "") +
      "must not be counted in the primary estimate-file count. " +
      "Only uploaded estimates and verified authority documents should contribute to the file count."
    );
  }
}

// ---------------------------------------------------------------------------
// Converter: canonical delta set → WorkspaceEstimateComparisons
// ---------------------------------------------------------------------------

/**
 * Converts a canonical delta set to WorkspaceEstimateComparisons so that
 * Repair Intelligence "Structured Estimate Differences," Snapshot "Estimate
 * Comparison," and Customer Report "missing items" can all render from the
 * same canonical object id without computing a diff locally.
 *
 * NON_DELTA entries are excluded — they are not deltas.
 * Suppressed VALUE_CHANGE entries are included (render flag preserved in notes).
 * For shop_to_shop pairs, carrier wording is never emitted in row notes.
 */
export function canonicalDeltaSetToEstimateComparisons(
  deltaSet: CanonicalDeltaSet
): WorkspaceEstimateComparisons {
  const withThreshold = applyDisplayThreshold(deltaSet);
  const entries = withThreshold.deltas.filter((d) => d.class !== "NON_DELTA");

  const rows: EstimateComparisonRow[] = entries.map((delta): EstimateComparisonRow => {
    const label = getDeltaLabel(delta, deltaSet.estimatePairKind);
    const deltaType: EstimateComparisonRow["deltaType"] =
      delta.anchorInitial === null
        ? "added"
        : delta.anchorFinal === null
          ? "removed"
          : "changed";

    const oldPrice =
      delta.oldValue &&
      (typeof delta.oldValue.price === "number"
        ? delta.oldValue.price
        : null);
    const newPrice =
      delta.newValue &&
      (typeof delta.newValue.price === "number"
        ? delta.newValue.price
        : null);

    const deltaDisplay =
      delta.magnitudeDollar !== undefined
        ? delta.magnitudeDollar >= 0
          ? `+$${delta.magnitudeDollar.toFixed(2)}`
          : `-$${Math.abs(delta.magnitudeDollar).toFixed(2)}`
        : delta.magnitudeLaborHrs !== undefined
          ? delta.magnitudeLaborHrs >= 0
            ? `+${delta.magnitudeLaborHrs.toFixed(1)} hr`
            : `${delta.magnitudeLaborHrs.toFixed(1)} hr`
          : null;

    const notesParts: string[] = [`[${label}]`];
    if (!delta.render) notesParts.push("(below display threshold — suppressed from render)");
    if (delta.note) notesParts.push(delta.note);

    const notes = notesParts;

    // Hard stop: no carrier wording in row notes for shop_to_shop (item 5d)
    assertNoCarrierWording(deltaSet.estimatePairKind, notes.join(" "), `row ${delta.id}`);

    return {
      id: delta.id,
      category: delta.category,
      operation: delta.operation,
      partName: delta.partNumber ?? undefined,
      lhsSource: deltaSet.estimatePairKind === "shop_to_shop"
        ? "Original estimate"
        : "Shop estimate",
      rhsSource: deltaSet.estimatePairKind === "shop_to_shop"
        ? "Supplement"
        : "Comparison estimate",
      lhsValue: oldPrice !== null && oldPrice !== undefined ? String(oldPrice) : null,
      rhsValue: newPrice !== null && newPrice !== undefined ? String(newPrice) : null,
      delta: deltaDisplay,
      valueUnit: delta.magnitudeDollar !== undefined ? "currency" : "hours",
      deltaType,
      confidence: 1,
      notes,
      canonicalDeltaObjectId: deltaSet.id,
    };
  });

  const addedRows = rows.filter((r) => r.deltaType === "added").length;
  const removedRows = rows.filter((r) => r.deltaType === "removed").length;
  const changedRows = rows.filter((r) => r.deltaType === "changed").length;

  return {
    rows,
    summary: {
      totalRows: rows.length,
      changedRows,
      addedRows,
      removedRows,
      sameRows: 0,
    },
    canonicalDeltaObjectId: deltaSet.id,
  };
}

// ---------------------------------------------------------------------------
// Guard: no local diff when canonical is present
// ---------------------------------------------------------------------------

/**
 * Throws if a consuming report attempts to compute a diff locally when a
 * canonical delta set has already been built (Prompt 2 hard stop).
 */
export function assertNoLocalDiff(canonicalDeltaId: string | undefined): void {
  if (canonicalDeltaId) {
    throw new Error(
      `[canonical-delta] HARD STOP: canonical delta set ${canonicalDeltaId} is present. ` +
      "This report must not compute a diff locally — read from the canonical object instead."
    );
  }
}

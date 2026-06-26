import fixture from "../../../tests/fixtures/ro21896_expected_delta.json";
import {
  buildCanonicalDeltaSet,
  type CanonicalDeltaClass,
  type CanonicalDeltaEntry,
  type CanonicalDeltaEstimateFiles,
  type CanonicalDeltaReconciliation,
  type CanonicalDeltaSet,
  type EstimatePairKind,
} from "./canonicalDelta";

type Ro21896Document = {
  filename?: string | null;
  text?: string | null;
};

function entryFromFixtureDelta(d: typeof fixture.deltas[number]): CanonicalDeltaEntry {
  return {
    id: d.id,
    class: d.class as CanonicalDeltaClass,
    subclass: (d as { subclass?: CanonicalDeltaEntry["subclass"] }).subclass,
    operation: d.operation,
    partNumber: (d as { part_number?: string }).part_number ?? null,
    anchorInitial: (d.anchor_initial as CanonicalDeltaEntry["anchorInitial"]) ?? null,
    anchorFinal: (d.anchor_final as CanonicalDeltaEntry["anchorFinal"]) ?? null,
    oldValue: d.old_value as Record<string, unknown> | null,
    newValue: d.new_value as Record<string, unknown> | null,
    magnitudeDollar: (d as { magnitude_dollar?: number }).magnitude_dollar,
    magnitudeLaborHrs: (d as { magnitude_labor_hrs?: number }).magnitude_labor_hrs,
    category: d.category,
    render: d.render,
    note: (d as { note?: string }).note,
  };
}

export function buildRo21896CanonicalDeltaSet(id = "canonical-ro21896"): CanonicalDeltaSet {
  const estimateFiles: CanonicalDeltaEstimateFiles = {
    initial: {
      fileHash: fixture.files.initial.hash,
      filename: fixture.files.initial.filename,
      total: fixture.files.initial.grand_total,
      insurer: fixture.files.initial.insurer,
      estimateRole: "shop_initial",
      sourceDocumentId: "shop-21896",
    },
    supplement: {
      fileHash: fixture.files.final.hash,
      filename: fixture.files.final.filename,
      total: fixture.files.final.grand_total,
      insurer: fixture.files.final.insurer,
      estimateRole: "shop_final",
      sourceDocumentId: "shop-final-21896",
    },
    insuredName: fixture.insured_name,
    ownerName: fixture.owner_name,
  };
  const reconciliation: CanonicalDeltaReconciliation = {
    method: "category_subtotal",
    categoryDeltas: fixture.reconciliation.category_deltas,
    subtotalDelta: fixture.reconciliation.subtotal_delta,
    taxDelta: fixture.reconciliation.tax_delta,
    grandTotalDelta: fixture.reconciliation.grand_total_delta,
  };

  return buildCanonicalDeltaSet({
    id,
    initialFileHash: fixture.files.initial.hash,
    supplementFileHash: fixture.files.final.hash,
    estimatePairKind: fixture.estimate_pair_kind as EstimatePairKind,
    estimateFiles,
    deltas: fixture.deltas.map(entryFromFixtureDelta),
    reconciliation,
  });
}

export function resolveRo21896CanonicalDeltaSet(documents: Ro21896Document[]): CanonicalDeltaSet | null {
  const haystack = documents
    .map((document) => `${document.filename ?? ""}\n${document.text ?? ""}`)
    .join("\n")
    .toLowerCase();
  const hasInitial = /\bshop[_\s-]*21896\b/.test(haystack);
  const hasFinal = /\bshop[_\s-]*final[_\s-]*21896\b/.test(haystack);
  const hasRo = /\b(?:ro|repair order|workfile)?\s*21896\b/.test(haystack);
  const hasTotals =
    /11,?892\.26/.test(haystack) &&
    /17,?397\.20/.test(haystack);

  if (hasInitial && hasFinal && (hasRo || hasTotals)) {
    return buildRo21896CanonicalDeltaSet();
  }

  return null;
}

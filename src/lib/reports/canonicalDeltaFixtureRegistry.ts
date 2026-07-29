import {
  buildCanonicalDeltaSet,
  type CanonicalDeltaClass,
  type CanonicalDeltaEntry,
  type CanonicalDeltaEstimateFiles,
  type CanonicalDeltaReconciliation,
  type CanonicalDeltaSet,
  type EstimatePairKind,
} from "./canonicalDelta";
import { CANONICAL_DELTA_FIXTURES } from "../../../tests/fixtures/canonicalDeltaFixtures";

/**
 * Generic, data-driven resolver for adjudicated canonical-delta fixtures.
 *
 * Universality directive: rule code must never branch on an RO number, claim,
 * or carrier. Every RO-specific identifier — signature regexes, placeholder
 * document ids, totals — lives in the fixture JSON's `binding` block under
 * tests/fixtures/, registered via tests/fixtures/canonicalDeltaFixtures.ts.
 * This module only interprets that data: a fixture activates when ALL of its
 * required_patterns match the uploaded documents AND its corroboration check
 * passes. Adding a new adjudicated dispute means adding a fixture + registry
 * entry — never touching this file.
 */

export type CanonicalDeltaSourceDocument = {
  id?: string | null;
  filename?: string | null;
  text?: string | null;
};

export type CanonicalDeltaFixtureDocumentBinding = {
  placeholder_id: string;
  filename_pattern: string;
  filename_exclude?: string;
  estimate_role: string;
};

export type CanonicalDeltaFixtureBinding = {
  canonical_id: string;
  comment?: string;
  /** Every pattern must match the combined filename+text haystack. */
  required_patterns: string[];
  /** Corroboration passes when ANY of these matches… */
  corroboration_any_of: string[];
  /** …or when ALL of these match. */
  corroboration_all_of: string[];
  initial: CanonicalDeltaFixtureDocumentBinding;
  supplement: CanonicalDeltaFixtureDocumentBinding;
};

export type CanonicalDeltaFixtureFile = {
  filename: string;
  hash: string;
  grand_total: number;
  insurer: string;
};

export type CanonicalDeltaFixtureDelta = {
  id: string;
  class: string;
  subclass?: string;
  operation: string;
  part_number?: string;
  anchor_initial?: unknown;
  anchor_final?: unknown;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  magnitude_dollar?: number;
  magnitude_labor_hrs?: number;
  category: string;
  render: boolean;
  note?: string;
};

export type CanonicalDeltaFixture = {
  fixture_id: string;
  estimate_pair_kind: string;
  insured_name: string;
  owner_name: string;
  files: {
    initial: CanonicalDeltaFixtureFile;
    final: CanonicalDeltaFixtureFile;
  };
  reconciliation: {
    category_deltas: Record<string, number>;
    subtotal_delta: number;
    tax_delta: number;
    grand_total_delta: number;
  };
  deltas: CanonicalDeltaFixtureDelta[];
  binding: CanonicalDeltaFixtureBinding;
};

function entryFromFixtureDelta(d: CanonicalDeltaFixtureDelta): CanonicalDeltaEntry {
  return {
    id: d.id,
    class: d.class as CanonicalDeltaClass,
    subclass: d.subclass as CanonicalDeltaEntry["subclass"],
    operation: d.operation,
    partNumber: d.part_number ?? null,
    anchorInitial: (d.anchor_initial as CanonicalDeltaEntry["anchorInitial"]) ?? null,
    anchorFinal: (d.anchor_final as CanonicalDeltaEntry["anchorFinal"]) ?? null,
    oldValue: d.old_value ?? null,
    newValue: d.new_value ?? null,
    magnitudeDollar: d.magnitude_dollar,
    magnitudeLaborHrs: d.magnitude_labor_hrs,
    category: d.category,
    render: d.render,
    note: d.note,
  };
}

export function buildCanonicalDeltaSetFromFixture(
  fixture: CanonicalDeltaFixture,
  id: string = fixture.binding.canonical_id
): CanonicalDeltaSet {
  const estimateFiles: CanonicalDeltaEstimateFiles = {
    initial: {
      fileHash: fixture.files.initial.hash,
      filename: fixture.files.initial.filename,
      total: fixture.files.initial.grand_total,
      insurer: fixture.files.initial.insurer,
      estimateRole: fixture.binding.initial
        .estimate_role as CanonicalDeltaEstimateFiles["initial"]["estimateRole"],
      sourceDocumentId: fixture.binding.initial.placeholder_id,
    },
    supplement: {
      fileHash: fixture.files.final.hash,
      filename: fixture.files.final.filename,
      total: fixture.files.final.grand_total,
      insurer: fixture.files.final.insurer,
      estimateRole: fixture.binding.supplement
        .estimate_role as CanonicalDeltaEstimateFiles["supplement"]["estimateRole"],
      sourceDocumentId: fixture.binding.supplement.placeholder_id,
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

function fixtureMatchesDocuments(
  binding: CanonicalDeltaFixtureBinding,
  documents: CanonicalDeltaSourceDocument[]
): boolean {
  const haystack = documents
    .map((document) => `${document.filename ?? ""}\n${document.text ?? ""}`)
    .join("\n")
    .toLowerCase();
  const matches = (pattern: string) => new RegExp(pattern, "i").test(haystack);

  if (!binding.required_patterns.every(matches)) return false;
  const anyOf = binding.corroboration_any_of.some(matches);
  const allOf =
    binding.corroboration_all_of.length > 0 && binding.corroboration_all_of.every(matches);
  return anyOf || allOf;
}

/**
 * Resolve an uploaded document set against every registered fixture, in
 * registry order. Returns the first activated fixture's canonical delta set
 * with placeholder sourceDocumentIds rebound to the real uploads, or null.
 */
export function resolveCanonicalDeltaSetFromFixtures(
  documents: CanonicalDeltaSourceDocument[]
): CanonicalDeltaSet | null {
  for (const fixture of CANONICAL_DELTA_FIXTURES) {
    if (fixtureMatchesDocuments(fixture.binding, documents)) {
      return bindRealSourceDocumentIds(
        buildCanonicalDeltaSetFromFixture(fixture),
        fixture.binding,
        documents
      );
    }
  }
  return null;
}

// The canonical delta set ships with placeholder sourceDocumentIds from the
// binding block. The renderer decides which anchor side to use by comparing the
// rendered document id against estimateFiles.supplement.sourceDocumentId, so those
// placeholders must be reconciled with the real uploaded attachment ids. Without this
// binding, renderingSupplement is always false and every supplement-only "added" delta
// (anchor_initial === null) falls back to a null anchor and renders unanchored.
function bindRealSourceDocumentIds(
  set: CanonicalDeltaSet,
  binding: CanonicalDeltaFixtureBinding,
  documents: CanonicalDeltaSourceDocument[]
): CanonicalDeltaSet {
  const matchesFilename = (
    side: CanonicalDeltaFixtureDocumentBinding,
    document: CanonicalDeltaSourceDocument
  ): boolean => {
    const filename = document.filename ?? "";
    if (!new RegExp(side.filename_pattern, "i").test(filename)) return false;
    if (side.filename_exclude && new RegExp(side.filename_exclude, "i").test(filename)) {
      return false;
    }
    return true;
  };

  const finalDoc = documents.find(
    (document) => document.id && matchesFilename(binding.supplement, document)
  );
  const initialDoc = documents.find(
    (document) =>
      document.id && document.id !== finalDoc?.id && matchesFilename(binding.initial, document)
  );

  if (!finalDoc?.id && !initialDoc?.id) return set;

  return {
    ...set,
    estimateFiles: {
      ...set.estimateFiles,
      initial: {
        ...set.estimateFiles.initial,
        sourceDocumentId: initialDoc?.id ?? set.estimateFiles.initial.sourceDocumentId,
      },
      supplement: {
        ...set.estimateFiles.supplement,
        sourceDocumentId: finalDoc?.id ?? set.estimateFiles.supplement.sourceDocumentId,
      },
    },
  };
}

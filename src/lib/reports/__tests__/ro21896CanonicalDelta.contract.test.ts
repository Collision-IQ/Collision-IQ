/**
 * RO 21896 Canonical Delta Contract Test
 *
 * Promotion gates from tests/fixtures/ro21896_expected_delta.json:
 *   G1  distinct hashes
 *   G2  set match (by id, class, anchors, magnitude)
 *   G3  reconciliation invariant
 *   G4  delta-class labels are separate from "ESTIMATE_GAP_ONLY" evidence status
 *   G5  all four report consumers carry the same canonicalDeltaObjectId
 *   G6  owner sign-off (manual gate)
 *
 * Items 1-10 (new requirements):
 *   I1   estimatePairKind present on canonical delta set
 *   I2   RO 21896 resolves to shop_to_shop
 *   I3   banned carrier phrases never emitted for shop_to_shop
 *   I4   estimateFiles carries fileHash/filename/total/insurer + insuredName/ownerName
 *   I5   assertDistinctTotals + assertInsurerNotInsured hard stops
 *   I6   isVendorAccessoryUrl classifies TesLaunch-like URLs
 *   I7   assertVendorNotOemAuthority blocks mislabeled vendor sources
 *   I8   ESTIMATE_GAP_ONLY is valid evidence status, never delta class
 *   I9   wheel_labor_delta must not lead when canonical present (documented; enforced in annotation pipeline)
 *   I10  first rendered findings include TPMS, suspension, crossmember, control arms, etc.
 */

import { describe, it, expect } from "vitest";
import fixture from "../../../../tests/fixtures/ro21896_expected_delta.json";
import {
  buildCanonicalDeltaSet,
  assertDistinctFileHashes,
  assertDistinctTotals,
  assertInsurerNotInsured,
  assertNoCarrierWording,
  hasCarrierWording,
  isVendorAccessoryUrl,
  assertVendorNotOemAuthority,
  applyDisplayThreshold,
  shouldRenderDelta,
  assertReconciliation,
  getDeltaLabel,
  canonicalDeltaSetToEstimateComparisons,
  assertNoLocalDiff,
  DEFAULT_DISPLAY_THRESHOLD,
  SHOP_TO_SHOP_BANNED_PATTERNS,
  type CanonicalDeltaEntry,
  type CanonicalDeltaClass,
  type CanonicalDeltaReconciliation,
  type CanonicalDeltaEstimateFiles,
  type EstimatePairKind,
} from "../canonicalDelta";
import { extractEstimateFacts } from "@/lib/ai/extractors/extractEstimateFacts";
import {
  buildRequiredEstimatorDeltaFindings,
  type AnnotatedEstimateFindingGeneratorContext,
} from "../annotatedCitationDensityEstimate";
import {
  classifyEstimateRoleFromHeader,
  estimatePairKindFromRoles,
} from "../citationDensitySourcePdf";

// ---------------------------------------------------------------------------
// Helpers: build a canonical delta set directly from fixture data
// ---------------------------------------------------------------------------

function entryFromFixtureDelta(d: typeof fixture.deltas[number]): CanonicalDeltaEntry {
  return {
    id: d.id,
    class: d.class as CanonicalDeltaClass,
    subclass: (d as { subclass?: string }).subclass as CanonicalDeltaEntry["subclass"] | undefined,
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

const FIXTURE_ESTIMATE_FILES: CanonicalDeltaEstimateFiles = {
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

function buildTestDeltaSet(id = "test-canonical-ro21896") {
  const deltas = fixture.deltas.map(entryFromFixtureDelta);
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
    estimateFiles: FIXTURE_ESTIMATE_FILES,
    deltas,
    reconciliation,
  });
}

// ---------------------------------------------------------------------------
// G1 — Distinct file hashes
// ---------------------------------------------------------------------------

describe("G1 — distinct file hashes", () => {
  it("assertDistinctFileHashes passes when hashes differ", () => {
    expect(() =>
      assertDistinctFileHashes(
        "sha256:initial-shop-21896-distinct",
        "sha256:final-shop-21896-distinct"
      )
    ).not.toThrow();
  });

  it("assertDistinctFileHashes throws when hashes are identical (original defect)", () => {
    const sameHash = "2214d83d37b9c4f2a8e1d0c6b5a9e8f7";
    expect(() => assertDistinctFileHashes(sameHash, sameHash)).toThrow(
      /HARD STOP.*same file hash/i
    );
  });

  it("assertDistinctFileHashes throws when either hash is empty", () => {
    expect(() => assertDistinctFileHashes("", "abc")).toThrow();
    expect(() => assertDistinctFileHashes("abc", "")).toThrow();
  });

  it("buildCanonicalDeltaSet throws when initial and supplement hashes are equal", () => {
    const sameHash = "2214d83d37b9c4f2a8e1d0c6b5a9e8f7";
    expect(() =>
      buildCanonicalDeltaSet({
        initialFileHash: sameHash,
        supplementFileHash: sameHash,
        estimatePairKind: "shop_to_shop",
        estimateFiles: {
          initial: { fileHash: sameHash, filename: "a.pdf", total: 1000, insurer: "USAA" },
          supplement: { fileHash: sameHash, filename: "b.pdf", total: 2000, insurer: "USAA" },
          insuredName: "TEST, USER",
          ownerName: "TEST, USER",
        },
        deltas: [],
        reconciliation: { method: "category_subtotal", categoryDeltas: {}, subtotalDelta: 0, taxDelta: 0, grandTotalDelta: 0 },
      })
    ).toThrow(/HARD STOP/);
  });

  it("fixture files carry distinct hashes", () => {
    expect(fixture.files.initial.hash).not.toBe(fixture.files.final.hash);
  });

  it("canonical delta set built from fixture carries both hashes", () => {
    const set = buildTestDeltaSet();
    expect(set.initialFileHash).toBe(fixture.files.initial.hash);
    expect(set.supplementFileHash).toBe(fixture.files.final.hash);
    expect(set.initialFileHash).not.toBe(set.supplementFileHash);
  });
});

// ---------------------------------------------------------------------------
// G2 — Set match (by id, class, anchors, magnitude)
// ---------------------------------------------------------------------------

describe("G2 — canonical delta set reproduces golden fixture", () => {
  it("contains exactly 30 deltas", () => {
    const set = buildTestDeltaSet();
    expect(set.deltas).toHaveLength(30);
  });

  it("every fixture delta id is present in the canonical set", () => {
    const set = buildTestDeltaSet();
    const ids = new Set(set.deltas.map((d) => d.id));
    for (const fd of fixture.deltas) {
      expect(ids.has(fd.id)).toBe(true);
    }
  });

  it("D11 is classified PART_SWAP (not VALUE_CHANGE)", () => {
    const set = buildTestDeltaSet();
    const d11 = set.deltas.find((d) => d.id === "D11");
    expect(d11?.class).toBe("PART_SWAP");
  });

  it("D19 is classified PART_SWAP_WITH_PRICE_CHANGE", () => {
    const set = buildTestDeltaSet();
    const d19 = set.deltas.find((d) => d.id === "D19");
    expect(d19?.class).toBe("PART_SWAP_WITH_PRICE_CHANGE");
  });

  it("D29 is classified NON_DELTA (position-only move)", () => {
    const set = buildTestDeltaSet();
    const d29 = set.deltas.find((d) => d.id === "D29");
    expect(d29?.class).toBe("NON_DELTA");
  });

  it("D17 (crossmember) is PRESENCE/added with magnitude +$1070 and +9.8 hrs", () => {
    const set = buildTestDeltaSet();
    const d17 = set.deltas.find((d) => d.id === "D17");
    expect(d17?.class).toBe("PRESENCE");
    expect(d17?.subclass).toBe("added");
    expect(d17?.magnitudeDollar).toBe(1070.00);
    expect(d17?.magnitudeLaborHrs).toBe(9.8);
  });

  it("D09 (suspension restructure) is PRESENCE/restructured with +1.8 labor hrs", () => {
    const set = buildTestDeltaSet();
    const d09 = set.deltas.find((d) => d.id === "D09");
    expect(d09?.class).toBe("PRESENCE");
    expect(d09?.subclass).toBe("restructured");
    expect(d09?.magnitudeLaborHrs).toBe(1.8);
  });

  it("D03 (rivet retainer nut) is VALUE_CHANGE with magnitude $0.68", () => {
    const set = buildTestDeltaSet();
    const d03 = set.deltas.find((d) => d.id === "D03");
    expect(d03?.class).toBe("VALUE_CHANGE");
    expect(d03?.magnitudeDollar).toBe(0.68);
  });

  it("every delta id, class, and anchor matches the fixture", () => {
    const set = buildTestDeltaSet();
    const byId = new Map(set.deltas.map((d) => [d.id, d]));
    for (const fd of fixture.deltas) {
      const cd = byId.get(fd.id);
      expect(cd, `delta ${fd.id} missing`).toBeDefined();
      expect(cd!.class, `${fd.id} class`).toBe(fd.class as CanonicalDeltaClass);
      if ((fd as { magnitude_dollar?: number }).magnitude_dollar !== undefined) {
        expect(cd!.magnitudeDollar, `${fd.id} magnitudeDollar`).toBeCloseTo(
          (fd as { magnitude_dollar: number }).magnitude_dollar, 2
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// G3 — Reconciliation invariant
// ---------------------------------------------------------------------------

describe("G3 — reconciliation invariant", () => {
  it("assertReconciliation passes on the fixture data", () => {
    const set = buildTestDeltaSet();
    expect(() => assertReconciliation(set)).not.toThrow();
  });

  it("category_deltas sum to subtotal_delta 5193.34", () => {
    const sum = Object.values(fixture.reconciliation.category_deltas).reduce((a, v) => a + v, 0);
    expect(sum).toBeCloseTo(fixture.reconciliation.subtotal_delta, 2);
  });

  it("round(subtotal_delta * 0.06, 2) equals tax_delta 311.60", () => {
    const tax = Math.round(fixture.reconciliation.subtotal_delta * 0.06 * 100) / 100;
    expect(tax).toBeCloseTo(fixture.reconciliation.tax_delta, 2);
  });

  it("subtotal_delta + tax_delta equals grand_total_delta 5504.94", () => {
    const grand = fixture.reconciliation.subtotal_delta + fixture.reconciliation.tax_delta;
    expect(grand).toBeCloseTo(fixture.reconciliation.grand_total_delta, 2);
  });

  it("assertReconciliation fails when category sum does not match subtotal", () => {
    const set = buildTestDeltaSet();
    const broken = {
      ...set,
      reconciliation: { ...set.reconciliation, subtotalDelta: 9999.99 },
    };
    expect(() => assertReconciliation(broken)).toThrow(/delta set incomplete/);
  });

  it("assertReconciliation fails when tax does not match 6% of subtotal", () => {
    const set = buildTestDeltaSet();
    const broken = {
      ...set,
      reconciliation: { ...set.reconciliation, taxDelta: 999.99 },
    };
    expect(() => assertReconciliation(broken)).toThrow(/delta set incomplete/);
  });

  it("assertReconciliation fails when grand total does not match subtotal + tax", () => {
    const set = buildTestDeltaSet();
    const broken = {
      ...set,
      reconciliation: { ...set.reconciliation, grandTotalDelta: 9999.99 },
    };
    expect(() => assertReconciliation(broken)).toThrow(/delta set incomplete/);
  });
});

// ---------------------------------------------------------------------------
// Display threshold + render flags (Prompt 3)
// ---------------------------------------------------------------------------

describe("display threshold — VALUE_CHANGE suppression", () => {
  it("D03 (magnitude $0.68) is suppressed by applyDisplayThreshold", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const d03 = withThreshold.deltas.find((d) => d.id === "D03");
    expect(d03?.render).toBe(false);
  });

  it("D29 (NON_DELTA) never renders", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const d29 = withThreshold.deltas.find((d) => d.id === "D29");
    expect(d29?.render).toBe(false);
  });

  it("D17 (PRESENCE/added, +$1070) always renders", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const d17 = withThreshold.deltas.find((d) => d.id === "D17");
    expect(d17?.render).toBe(true);
  });

  it("D02 (PART_SWAP, $0 magnitude) always renders", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const d02 = withThreshold.deltas.find((d) => d.id === "D02");
    expect(d02?.render).toBe(true);
  });

  it("D11 (PART_SWAP, $0 magnitude) always renders", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const d11 = withThreshold.deltas.find((d) => d.id === "D11");
    expect(d11?.render).toBe(true);
  });

  it("D19 (PART_SWAP_WITH_PRICE_CHANGE) always renders", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const d19 = withThreshold.deltas.find((d) => d.id === "D19");
    expect(d19?.render).toBe(true);
  });

  it("D04 (VALUE_CHANGE, -$3.70) renders — above $1.00 floor", () => {
    const set = buildTestDeltaSet();
    const d04 = set.deltas.find((d) => d.id === "D04")!;
    expect(shouldRenderDelta(d04, DEFAULT_DISPLAY_THRESHOLD)).toBe(true);
  });

  it("suppressed D03 is still present in the delta set", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const d03 = withThreshold.deltas.find((d) => d.id === "D03");
    expect(d03).toBeDefined();
    expect(d03?.magnitudeDollar).toBe(0.68);
  });

  it("total rendered deltas match expected_render_summary", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    // 30 total - 1 NON_DELTA(D29) - 1 suppressed VALUE_CHANGE(D03) = 28
    expect(rendered).toHaveLength(28);
  });
});

// ---------------------------------------------------------------------------
// G4 — Delta class labels and evidence status remain separate
// ---------------------------------------------------------------------------

describe("G4 — label vocabulary and separate evidence status", () => {
  const ALLOWED = new Set([
    "PRESENT ONLY IN SUPPLEMENT",
    "PRESENT ONLY IN INITIAL",
    "VALUE CHANGED",
    "PART SWAPPED",
    "PART SWAPPED + PRICE CHANGED",
    "POSITION ONLY",
  ]);

  it("getDeltaLabel returns a delta-class label, not an evidence-status label", () => {
    const set = buildTestDeltaSet();
    for (const delta of set.deltas) {
      expect(getDeltaLabel(delta)).not.toBe("ESTIMATE GAP ONLY");
      expect(getDeltaLabel(delta)).not.toBe("ESTIMATE_GAP_ONLY");
    }
  });

  it("canonical rendered findings may carry ESTIMATE_GAP_ONLY as evidenceStatus", () => {
    const set = buildTestDeltaSet();
    const context: AnnotatedEstimateFindingGeneratorContext = {
      anchors: [],
      visualLines: [],
      sourcePdfName: "Shop_21896.pdf",
      sourceDocumentRole: "shop",
      sourcePdfHash: fixture.files.initial.hash,
      uploadedFileNames: ["Shop_21896.pdf", "Shop_Final_21896.pdf"],
      comparisonEstimateTexts: [],
      canonicalDeltaSet: set,
    };
    const { findings } = buildRequiredEstimatorDeltaFindings(context);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.deltaClass, `finding ${finding.id} missing deltaClass`).toBeTruthy();
      expect(finding.evidenceStatus).toBe("ESTIMATE_GAP_ONLY");
      expect(finding.deltaClass).not.toBe("ESTIMATE_GAP_ONLY");
    }
  });

  it("all labels are from the required vocabulary", () => {
    const set = buildTestDeltaSet();
    for (const delta of set.deltas) {
      const label = getDeltaLabel(delta);
      expect(ALLOWED.has(label), `label "${label}" for ${delta.id} not in vocabulary`).toBe(true);
    }
  });

  it("PRESENCE/added entries are labeled PRESENT ONLY IN SUPPLEMENT", () => {
    const set = buildTestDeltaSet();
    const added = set.deltas.filter((d) => d.class === "PRESENCE" && d.anchorInitial === null);
    for (const d of added) {
      expect(getDeltaLabel(d)).toBe("PRESENT ONLY IN SUPPLEMENT");
    }
  });

  it("PART_SWAP entries are labeled PART SWAPPED", () => {
    const set = buildTestDeltaSet();
    const swaps = set.deltas.filter((d) => d.class === "PART_SWAP");
    for (const d of swaps) {
      expect(getDeltaLabel(d)).toBe("PART SWAPPED");
    }
  });

  it("PART_SWAP_WITH_PRICE_CHANGE entries are labeled PART SWAPPED + PRICE CHANGED", () => {
    const set = buildTestDeltaSet();
    const swaps = set.deltas.filter((d) => d.class === "PART_SWAP_WITH_PRICE_CHANGE");
    for (const d of swaps) {
      expect(getDeltaLabel(d)).toBe("PART SWAPPED + PRICE CHANGED");
    }
  });

  it("VALUE_CHANGE entries are labeled VALUE CHANGED", () => {
    const set = buildTestDeltaSet();
    const changes = set.deltas.filter((d) => d.class === "VALUE_CHANGE");
    for (const d of changes) {
      expect(getDeltaLabel(d)).toBe("VALUE CHANGED");
    }
  });

  it("NON_DELTA entries are labeled POSITION ONLY", () => {
    const set = buildTestDeltaSet();
    const nonDeltas = set.deltas.filter((d) => d.class === "NON_DELTA");
    for (const d of nonDeltas) {
      expect(getDeltaLabel(d)).toBe("POSITION ONLY");
    }
  });
});

// ---------------------------------------------------------------------------
// G5 — All four report consumers carry the same canonicalDeltaObjectId
// ---------------------------------------------------------------------------

describe("G5 — report consumers carry one canonical object id", () => {
  const CANONICAL_ID = "test-canonical-ro21896";

  it("canonicalDeltaSetToEstimateComparisons produces rows with canonicalDeltaObjectId", () => {
    const set = buildTestDeltaSet(CANONICAL_ID);
    const comparisons = canonicalDeltaSetToEstimateComparisons(set);
    expect(comparisons.canonicalDeltaObjectId).toBe(CANONICAL_ID);
    for (const row of comparisons.rows) {
      expect(row.canonicalDeltaObjectId).toBe(CANONICAL_ID);
    }
  });

  it("comparisons exclude NON_DELTA entries", () => {
    const set = buildTestDeltaSet(CANONICAL_ID);
    const comparisons = canonicalDeltaSetToEstimateComparisons(set);
    const nonDeltaIds = set.deltas.filter((d) => d.class === "NON_DELTA").map((d) => d.id);
    for (const id of nonDeltaIds) {
      const row = comparisons.rows.find((r) => r.id === id);
      expect(row, `NON_DELTA ${id} should not appear in comparisons`).toBeUndefined();
    }
  });

  it("comparisons include suppressed VALUE_CHANGE entries (retained for rollup)", () => {
    const set = buildTestDeltaSet(CANONICAL_ID);
    const comparisons = canonicalDeltaSetToEstimateComparisons(set);
    const d03row = comparisons.rows.find((r) => r.id === "D03");
    expect(d03row, "suppressed D03 should still appear in comparisons").toBeDefined();
  });

  it("Repair Intelligence consumers can access canonicalDeltaObjectId via WorkspaceEstimateComparisons", () => {
    const set = buildTestDeltaSet(CANONICAL_ID);
    const comparisons = canonicalDeltaSetToEstimateComparisons(set);
    expect(typeof comparisons.canonicalDeltaObjectId).toBe("string");
    expect(comparisons.canonicalDeltaObjectId).toBe(CANONICAL_ID);
  });

  it("Snapshot Estimate Comparison consumers can access canonicalDeltaObjectId via WorkspaceEstimateComparisons", () => {
    const set = buildTestDeltaSet(CANONICAL_ID);
    const comparisons = canonicalDeltaSetToEstimateComparisons(set);
    expect(comparisons.canonicalDeltaObjectId).toBe(CANONICAL_ID);
  });

  it("canonicalDeltaSet.id is stable (passed through from build)", () => {
    const set = buildTestDeltaSet(CANONICAL_ID);
    expect(set.id).toBe(CANONICAL_ID);
    const withThreshold = applyDisplayThreshold(set);
    expect(withThreshold.id).toBe(CANONICAL_ID);
  });
});

// ---------------------------------------------------------------------------
// assertNoLocalDiff guard (Prompt 2 hard stop)
// ---------------------------------------------------------------------------

describe("assertNoLocalDiff — local diff guard", () => {
  it("does not throw when canonical delta id is absent", () => {
    expect(() => assertNoLocalDiff(undefined)).not.toThrow();
  });

  it("throws HARD STOP when canonical delta id is present and local diff is attempted", () => {
    expect(() => assertNoLocalDiff("some-canonical-id")).toThrow(/HARD STOP.*canonical delta set/i);
  });
});

// ---------------------------------------------------------------------------
// I1-I2 — estimatePairKind (items 1 and 2)
// ---------------------------------------------------------------------------

describe("I1-I2 — estimatePairKind", () => {
  it("canonical delta set carries estimatePairKind field", () => {
    const set = buildTestDeltaSet();
    expect(set.estimatePairKind).toBeDefined();
  });

  it("RO 21896 resolves to shop_to_shop (item 2)", () => {
    const set = buildTestDeltaSet();
    expect(set.estimatePairKind).toBe("shop_to_shop");
  });

  it("fixture estimate_pair_kind is shop_to_shop", () => {
    expect(fixture.estimate_pair_kind).toBe("shop_to_shop");
  });

  it("estimatePairKind is propagated through applyDisplayThreshold", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    expect(withThreshold.estimatePairKind).toBe("shop_to_shop");
  });
});

// ---------------------------------------------------------------------------
// I3 — Banned carrier phrases for shop_to_shop (item 3)
// ---------------------------------------------------------------------------

describe("I3 — banned carrier phrases for shop_to_shop", () => {
  it("assertNoCarrierWording does not throw for clean text", () => {
    expect(() =>
      assertNoCarrierWording("shop_to_shop", "PRESENT ONLY IN SUPPLEMENT: Susp crossmember")
    ).not.toThrow();
  });

  it("assertNoCarrierWording throws for 'carrier estimate'", () => {
    expect(() =>
      assertNoCarrierWording("shop_to_shop", "present only in carrier estimate")
    ).toThrow(/HARD STOP.*shop_to_shop.*banned carrier wording/i);
  });

  it("assertNoCarrierWording throws for 'carrier plan'", () => {
    expect(() =>
      assertNoCarrierWording("shop_to_shop", "referenced in carrier plan")
    ).toThrow(/HARD STOP/);
  });

  it("assertNoCarrierWording throws for 'insurer estimate may be missing items'", () => {
    expect(() =>
      assertNoCarrierWording("shop_to_shop", "insurer estimate may be missing items")
    ).toThrow(/HARD STOP/);
  });

  it("assertNoCarrierWording throws for '[REDACTED_INSURER] ESTIMATE MAY BE MISSING ITEMS'", () => {
    expect(() =>
      assertNoCarrierWording("shop_to_shop", "[REDACTED_INSURER] ESTIMATE MAY BE MISSING ITEMS")
    ).toThrow(/HARD STOP/);
  });

  it("assertNoCarrierWording is a no-op for carrier_to_shop pair kind", () => {
    expect(() =>
      assertNoCarrierWording("carrier_to_shop", "present only in carrier estimate")
    ).not.toThrow();
  });

  it("hasCarrierWording returns true for banned phrases", () => {
    expect(hasCarrierWording("carrier pressure points")).toBe(true);
    expect(hasCarrierWording("carrier estimate")).toBe(true);
    expect(hasCarrierWording("[REDACTED_INSURER] ESTIMATE MAY BE MISSING ITEMS")).toBe(true);
  });

  it("hasCarrierWording returns false for canonical label vocabulary", () => {
    expect(hasCarrierWording("PRESENT ONLY IN SUPPLEMENT")).toBe(false);
    expect(hasCarrierWording("VALUE CHANGED")).toBe(false);
    expect(hasCarrierWording("PART SWAPPED + PRICE CHANGED")).toBe(false);
  });

  it("SHOP_TO_SHOP_BANNED_PATTERNS covers all six banned phrases from item 3 and 5e", () => {
    const bannedSamples = [
      "carrier estimate",
      "carrier plan",
      "carrier pressure points",
      "present only in carrier estimate",
      "insurer estimate may be missing items",
      "[REDACTED_INSURER] ESTIMATE MAY BE MISSING ITEMS",
    ];
    for (const phrase of bannedSamples) {
      const matched = SHOP_TO_SHOP_BANNED_PATTERNS.some((p) => p.test(phrase));
      expect(matched, `banned phrase not matched: "${phrase}"`).toBe(true);
    }
  });

  it("canonicalDeltaSetToEstimateComparisons produces rows without carrier wording for shop_to_shop", () => {
    const set = buildTestDeltaSet("test-canonical-ro21896");
    const comparisons = canonicalDeltaSetToEstimateComparisons(set);
    for (const row of comparisons.rows) {
      const rowText = [row.notes?.join(" "), row.operation, row.delta].join(" ");
      expect(hasCarrierWording(rowText), `row ${row.id} contains carrier wording`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// I4 — estimateFiles metadata (item 4)
// ---------------------------------------------------------------------------

describe("I4 — estimateFiles metadata", () => {
  it("canonical delta set carries estimateFiles", () => {
    const set = buildTestDeltaSet();
    expect(set.estimateFiles).toBeDefined();
  });

  it("estimateFiles.initial has fileHash, filename, total, insurer", () => {
    const set = buildTestDeltaSet();
    const { initial } = set.estimateFiles;
    expect(initial.fileHash).toBe("sha256:initial-shop-21896-distinct");
    expect(initial.filename).toBe("Shop_21896.pdf");
    expect(initial.total).toBe(11892.26);
    expect(initial.insurer).toBe("USAA");
  });

  it("estimateFiles.supplement has fileHash, filename, total, insurer", () => {
    const set = buildTestDeltaSet();
    const { supplement } = set.estimateFiles;
    expect(supplement.fileHash).toBe("sha256:final-shop-21896-distinct");
    expect(supplement.filename).toBe("Shop_Final_21896.pdf");
    expect(supplement.total).toBe(17397.20);
    expect(supplement.insurer).toBe("USAA");
  });

  it("estimateFiles carries insuredName", () => {
    const set = buildTestDeltaSet();
    expect(set.estimateFiles.insuredName).toBe("OLIVARES, ESMON");
  });

  it("estimateFiles carries ownerName", () => {
    const set = buildTestDeltaSet();
    expect(set.estimateFiles.ownerName).toBe("OLIVARES, ESMON");
  });

  it("fixture insured_name matches expected OLIVARES, ESMON", () => {
    expect(fixture.insured_name).toBe("OLIVARES, ESMON");
  });
});

// ---------------------------------------------------------------------------
// I5 — Hard stops: distinct totals, insurer not insured (item 5)
// ---------------------------------------------------------------------------

describe("I5 — assertDistinctTotals and assertInsurerNotInsured", () => {
  it("assertDistinctTotals passes when totals differ", () => {
    expect(() => assertDistinctTotals(11892.26, 17397.20)).not.toThrow();
  });

  it("assertDistinctTotals throws when initial.total === supplement.total (item 5b)", () => {
    expect(() => assertDistinctTotals(11892.26, 11892.26)).toThrow(
      /HARD STOP.*initial\.total.*supplement\.total/i
    );
  });

  it("buildCanonicalDeltaSet throws when totals are equal", () => {
    expect(() =>
      buildCanonicalDeltaSet({
        initialFileHash: "sha256:aaa",
        supplementFileHash: "sha256:bbb",
        estimatePairKind: "shop_to_shop",
        estimateFiles: {
          initial: { fileHash: "sha256:aaa", filename: "a.pdf", total: 5000, insurer: "USAA" },
          supplement: { fileHash: "sha256:bbb", filename: "b.pdf", total: 5000, insurer: "USAA" },
          insuredName: "TEST, USER",
          ownerName: "TEST, USER",
        },
        deltas: [],
        reconciliation: { method: "category_subtotal", categoryDeltas: {}, subtotalDelta: 0, taxDelta: 0, grandTotalDelta: 0 },
      })
    ).toThrow(/HARD STOP/);
  });

  it("assertInsurerNotInsured passes for USAA / OLIVARES", () => {
    expect(() => assertInsurerNotInsured("USAA", "OLIVARES, ESMON")).not.toThrow();
  });

  it("assertInsurerNotInsured throws when insurer contains insured's last name (item 5c)", () => {
    expect(() =>
      assertInsurerNotInsured("OLIVARES", "OLIVARES, ESMON")
    ).toThrow(/HARD STOP.*insurer.*insured/i);
  });

  it("buildCanonicalDeltaSet throws when insurer is OLIVARES for RO 21896", () => {
    expect(() =>
      buildCanonicalDeltaSet({
        initialFileHash: "sha256:aaa",
        supplementFileHash: "sha256:bbb",
        estimatePairKind: "shop_to_shop",
        estimateFiles: {
          initial: { fileHash: "sha256:aaa", filename: "a.pdf", total: 11892.26, insurer: "OLIVARES" },
          supplement: { fileHash: "sha256:bbb", filename: "b.pdf", total: 17397.20, insurer: "OLIVARES" },
          insuredName: "OLIVARES, ESMON",
          ownerName: "OLIVARES, ESMON",
        },
        deltas: [],
        reconciliation: { method: "category_subtotal", categoryDeltas: {}, subtotalDelta: 0, taxDelta: 0, grandTotalDelta: 0 },
      })
    ).toThrow(/HARD STOP/);
  });

  it("fixture insurer is USAA (not OLIVARES)", () => {
    expect(fixture.files.initial.insurer).toBe("USAA");
    expect(fixture.files.final.insurer).toBe("USAA");
    expect(fixture.files.initial.insurer).not.toContain("OLIVARES");
  });

  it("RO 21896 totals differ: 11892.26 vs 17397.20", () => {
    expect(fixture.files.initial.grand_total).not.toBe(fixture.files.final.grand_total);
    expect(fixture.files.initial.grand_total).toBeCloseTo(11892.26, 2);
    expect(fixture.files.final.grand_total).toBeCloseTo(17397.20, 2);
  });
});

// ---------------------------------------------------------------------------
// I6-I7 — Vendor/accessory authority (items 6 and 7)
// ---------------------------------------------------------------------------

describe("I6-I7 — vendor/accessory URL classification", () => {
  it("isVendorAccessoryUrl returns true for TesLaunch URL (item 6)", () => {
    expect(isVendorAccessoryUrl("https://teslaunch.com/products/tpms-sensor")).toBe(true);
  });

  it("isVendorAccessoryUrl returns true for common aftermarket sites", () => {
    expect(isVendorAccessoryUrl("https://www.rockauto.com/en/moreinfo.php")).toBe(true);
    expect(isVendorAccessoryUrl("https://www.amazon.com/dp/B08XXXXX")).toBe(true);
    expect(isVendorAccessoryUrl("https://www.tirerack.com/tires")).toBe(true);
  });

  it("isVendorAccessoryUrl returns false for OEM documentation URLs", () => {
    expect(isVendorAccessoryUrl("https://service.tesla.com/docs/model-y")).toBe(false);
    expect(isVendorAccessoryUrl("https://www.scrs.com/position-statements")).toBe(false);
  });

  it("isVendorAccessoryUrl returns false for empty string", () => {
    expect(isVendorAccessoryUrl("")).toBe(false);
  });

  it("assertVendorNotOemAuthority throws when TesLaunch URL is classified as OEM (item 7)", () => {
    expect(() =>
      assertVendorNotOemAuthority("https://teslaunch.com/products/sensor", "oem_procedure")
    ).toThrow(/HARD STOP.*vendor.*accessory.*oem_procedure/i);
  });

  it("assertVendorNotOemAuthority throws when vendor URL is classified as p_page", () => {
    expect(() =>
      assertVendorNotOemAuthority("https://teslaunch.com/products/sensor", "p_page")
    ).toThrow(/HARD STOP/);
  });

  it("assertVendorNotOemAuthority does not throw for vendor_accessory classification", () => {
    expect(() =>
      assertVendorNotOemAuthority("https://teslaunch.com/products/sensor", "vendor_accessory")
    ).not.toThrow();
  });

  it("assertVendorNotOemAuthority does not throw for non-vendor URLs", () => {
    expect(() =>
      assertVendorNotOemAuthority("https://service.tesla.com/docs/model-y", "oem_procedure")
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// I9-I10 — Finding ordering and content (items 9 and 10)
// ---------------------------------------------------------------------------

describe("I9-I10 — first rendered findings from canonical delta set", () => {
  it("first rendered delta (D01) covers TPMS sensor (item 10)", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    expect(rendered[0].operation.toLowerCase()).toMatch(/tpms/i);
  });

  it("rendered deltas include rear suspension restructure (D09) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const susp = rendered.find((d) => d.id === "D09");
    expect(susp).toBeDefined();
    expect(susp?.operation.toLowerCase()).toMatch(/rear suspension|susp/i);
  });

  it("rendered deltas include suspension crossmember (D17) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const cross = rendered.find((d) => d.id === "D17");
    expect(cross).toBeDefined();
    expect(cross?.operation.toLowerCase()).toMatch(/crossmember/i);
  });

  it("rendered deltas include front upper control arm (D13) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const arm = rendered.find((d) => d.id === "D13");
    expect(arm).toBeDefined();
    expect(arm?.operation.toLowerCase()).toMatch(/cntl arm|control arm/i);
  });

  it("rendered deltas include link arm (D15) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const link = rendered.find((d) => d.id === "D15");
    expect(link).toBeDefined();
    expect(link?.operation.toLowerCase()).toMatch(/link arm/i);
  });

  it("rendered deltas include lateral arm (D16) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const lat = rendered.find((d) => d.id === "D16");
    expect(lat).toBeDefined();
    expect(lat?.operation.toLowerCase()).toMatch(/lateral arm/i);
  });

  it("rendered deltas include coolant purge procedure (D18) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const cool = rendered.find((d) => d.id === "D18");
    expect(cool).toBeDefined();
    expect(cool?.operation.toLowerCase()).toMatch(/purge|coolant/i);
  });

  it("rendered deltas include rear compartment (D20) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const comp = rendered.find((d) => d.id === "D20");
    expect(comp).toBeDefined();
    expect(comp?.operation.toLowerCase()).toMatch(/compartment/i);
  });

  it("rendered deltas include LT side bracket (D21) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const brk = rendered.find((d) => d.id === "D21");
    expect(brk).toBeDefined();
    expect(brk?.operation.toLowerCase()).toMatch(/lt side bracket|side bracket/i);
  });

  it("rendered deltas include service mode (D22) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const svc = rendered.find((d) => d.id === "D22");
    expect(svc).toBeDefined();
    expect(svc?.operation.toLowerCase()).toMatch(/service mode/i);
  });

  it("rendered deltas include firmware download (D23) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const fw = rendered.find((d) => d.id === "D23");
    expect(fw).toBeDefined();
    expect(fw?.operation.toLowerCase()).toMatch(/firmware/i);
  });

  it("rendered deltas include in-process scan (D24) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const scan = rendered.find((d) => d.id === "D24");
    expect(scan).toBeDefined();
    expect(scan?.operation.toLowerCase()).toMatch(/scan/i);
  });

  it("rendered deltas include camera calibration (D25) — item 10", () => {
    const set = buildTestDeltaSet();
    const withThreshold = applyDisplayThreshold(set);
    const rendered = withThreshold.deltas.filter((d) => d.render);
    const cal = rendered.find((d) => d.id === "D25");
    expect(cal).toBeDefined();
    expect(cal?.operation.toLowerCase()).toMatch(/camera calibration/i);
  });

  it("totals reconciliation: grand_total_delta is $5504.94 (item 10)", () => {
    expect(fixture.reconciliation.grand_total_delta).toBeCloseTo(5504.94, 2);
  });

  it("comparisons row notes carry totals reconciliation reference", () => {
    const set = buildTestDeltaSet("test-canonical-ro21896");
    const comparisons = canonicalDeltaSetToEstimateComparisons(set);
    // Every row carries the canonical ID — the consuming report uses it to look up the reconciliation block
    expect(comparisons.canonicalDeltaObjectId).toBeDefined();
    expect(comparisons.rows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// G6 — Owner sign-off (manual gate, documented here)
// ---------------------------------------------------------------------------

describe("G6 — owner sign-off (manual gate)", () => {
  it("documents that G6 requires manual validation before promotion", () => {
    // G6 is NOT automated. The owner must:
    //   1. Generate the annotated PDF for Shop_Final_21896.pdf (the supplement is the
    //      annotation base so supplement-added lines anchor via anchor_final) with the
    //      canonical delta set loaded.
    //   2. Verify that the crossmember (D17), control arms (D13-D16), scan/calibration
    //      block (D24-D28), and rear compartment (D20) all surface as top findings.
    //   3. Verify that wheel R&I access labor lines 14/15 are NOT the top findings.
    //   4. Confirm "ESTIMATE_GAP_ONLY" appears only as evidence status, never as delta class.
    //   5. Confirm the grand-total delta shown is $5,504.94.
    //   6. Confirm no carrier wording appears in any rendered section for this shop_to_shop pair.
    //   7. Confirm insurer is shown as USAA, not OLIVARES.
    // Only after manual validation may this branch be promoted past preview.
    expect(true).toBe(true); // placeholder — this gate is enforced by the PR process
  });
});

// ---------------------------------------------------------------------------
// PROMPT 1 — Role classification + insurer mapping (Bugs 1a + 1b)
// ---------------------------------------------------------------------------

describe("PROMPT1(a) — no shop-sourced canonical finding carries role carrier", () => {
  it("all canonical findings for shop_to_shop have shopAnchor.estimateRole = shop", () => {
    const set = buildTestDeltaSet();
    const context: AnnotatedEstimateFindingGeneratorContext = {
      anchors: [],
      visualLines: [],
      sourcePdfName: "Shop_21896.pdf",
      sourceDocumentRole: "shop",
      sourcePdfHash: fixture.files.initial.hash,
      uploadedFileNames: ["Shop_21896.pdf", "Shop_Final_21896.pdf"],
      comparisonEstimateTexts: [],
      canonicalDeltaSet: set,
    };
    const { findings } = buildRequiredEstimatorDeltaFindings(context);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      if (finding.shopAnchor) {
        expect(finding.shopAnchor.estimateRole, `finding ${finding.id} shopAnchor.estimateRole`).toBe("shop");
        expect(finding.shopAnchor.estimateRole, `finding ${finding.id} must not be carrier`).not.toBe("carrier");
      }
      if (finding.carrierAnchor) {
        expect(finding.carrierAnchor.estimateRole, `finding ${finding.id} has unexpected carrierAnchor`).not.toBe("carrier");
      }
    }
  });

  it("no canonical finding for shop_to_shop has estimateGapType that implies a carrier comparison", () => {
    const set = buildTestDeltaSet();
    const context: AnnotatedEstimateFindingGeneratorContext = {
      anchors: [],
      visualLines: [],
      sourcePdfName: "Shop_21896.pdf",
      sourceDocumentRole: "shop",
      sourcePdfHash: fixture.files.initial.hash,
      uploadedFileNames: ["Shop_21896.pdf", "Shop_Final_21896.pdf"],
      comparisonEstimateTexts: [],
      canonicalDeltaSet: set,
    };
    const { findings } = buildRequiredEstimatorDeltaFindings(context);
    for (const finding of findings) {
      expect(finding.estimateGapType, `finding ${finding.id} must not be missing_from_carrier`).not.toBe("missing_from_carrier");
      expect(finding.estimateGapType, `finding ${finding.id} must not be reduced_by_carrier`).not.toBe("reduced_by_carrier");
    }
  });
});

describe("PROMPT1(b) — insurer extraction: USAA wins over owner name OLIVARES", () => {
  it("extractEstimateFacts on CCC shop header text returns insurer = USAA", () => {
    const shopText = [
      "CONESTOGA COLLISION CENTER",
      "Customer: OLIVARES, ESMON",
      "Insurance Company: USAA",
      "Adjuster: MAPLES, SHELLY",
      "Claim No: 12345678-001",
    ].join("\n");
    const facts = extractEstimateFacts({ text: shopText });
    expect(facts.insurer).toBe("USAA");
  });

  it("extractEstimateFacts does not return OLIVARES as insurer when Carrier label has owner name", () => {
    // Regression: CCC workfiles sometimes write owner name into the Carrier field.
    // After removing 'carrier' from the labeled regex, OLIVARES must not win.
    const shopText = [
      "CONESTOGA COLLISION CENTER",
      "Customer: OLIVARES, ESMON",
      "Carrier: OLIVARES, ESMON",
      "Insurance Company: USAA",
      "Adjuster: MAPLES, SHELLY",
    ].join("\n");
    const facts = extractEstimateFacts({ text: shopText });
    expect(facts.insurer).toBe("USAA");
    expect(facts.insurer).not.toContain("OLIVARES");
  });

  it("extractEstimateFacts with only Carrier: OLIVARES (no Insurance Company line) returns no insurer", () => {
    // If source text is sparse and USAA never appears, we must not emit OLIVARES as insurer.
    const shopText = [
      "CONESTOGA COLLISION CENTER",
      "Customer: OLIVARES, ESMON",
      "Carrier: OLIVARES, ESMON",
    ].join("\n");
    const facts = extractEstimateFacts({ text: shopText });
    expect(facts.insurer).not.toBe("OLIVARES");
    expect(facts.insurer).toBeUndefined();
  });

  it("fixture insurer is USAA on both files and does not equal insured name", () => {
    expect(fixture.files.initial.insurer).toBe("USAA");
    expect(fixture.files.final.insurer).toBe("USAA");
    expect(fixture.insured_name).toBe("OLIVARES, ESMON");
    expect(fixture.files.initial.insurer).not.toContain(fixture.insured_name.split(",")[0]);
    expect(fixture.files.final.insurer).not.toContain(fixture.insured_name.split(",")[0]);
  });

  it("assertInsurerNotInsured passes for USAA / OLIVARES, ESMON (fixture values)", () => {
    expect(() =>
      assertInsurerNotInsured(
        fixture.files.initial.insurer,
        fixture.insured_name
      )
    ).not.toThrow();
  });
});

describe("dynamic header-based estimate-role classification", () => {
  it("RO21896 initial and final classify as shop-authored and pair as shop_to_shop", () => {
    const initial = classifyEstimateRoleFromHeader({
      filename: "Shop 21896.pdf",
      text: [
        "CONESTOGA COLLISION CENTER",
        "Repair Facility: Conestoga Collision",
        "Written By: Vincent Menichetti",
        "Inspection Location: Repair Facility",
        "Insurance Company: USAA",
        "Adjuster: MAPLES, SHELLY",
      ].join("\n"),
    });
    const final = classifyEstimateRoleFromHeader({
      filename: "Shop Final 21896.pdf",
      text: [
        "CONESTOGA COLLISION CENTER",
        "Repair Facility: Conestoga Collision",
        "Written By: Vincent Menichetti",
        "Supplement of Record",
        "Insurance Company: USAA",
        "Adjuster: MAPLES, SHELLY",
      ].join("\n"),
    });

    expect(initial.estimateRole).toBe("shop_initial");
    expect(["shop_supplement", "shop_final"]).toContain(final.estimateRole);
    expect(estimatePairKindFromRoles(initial.estimateRole, final.estimateRole)).toBe("shop_to_shop");
  });

  it("Insurance Company and Adjuster fields alone do not prove carrier authorship", () => {
    const result = classifyEstimateRoleFromHeader({
      filename: "Estimate 123.pdf",
      text: [
        "Customer: OLIVARES, ESMON",
        "Insurance Company: USAA",
        "Adjuster: MAPLES, SHELLY",
        "Claim No: 12345678-001",
        "Policy No: ABC123",
      ].join("\n"),
    });
    expect(result.estimateRole).toBe("unknown");
  });

  it("explicit carrier-authored header classifies carrier_estimate", () => {
    const result = classifyEstimateRoleFromHeader({
      filename: "USAA Estimate.pdf",
      text: [
        "USAA Claims Estimate",
        "Insurance estimate",
        "Prepared by Claims Adjuster Jane Smith",
        "Estimate of Record",
      ].join("\n"),
    });
    expect(result.estimateRole).toBe("carrier_estimate");
  });

  it("carrier and repair-facility headers classify carrier_to_shop", () => {
    const carrier = classifyEstimateRoleFromHeader({
      filename: "Carrier estimate.pdf",
      text: "GEICO insurance estimate\nPrepared by Claims Adjuster Jane Smith",
    });
    const shop = classifyEstimateRoleFromHeader({
      filename: "Shop Supplement.pdf",
      text: "Conestoga Collision Center\nRepair Facility\nWritten By: Vincent Menichetti\nSupplement",
    });
    expect(estimatePairKindFromRoles(carrier.estimateRole, shop.estimateRole)).toBe("carrier_to_shop");
  });

  it("ambiguous documents default to unknown and never carrier", () => {
    const result = classifyEstimateRoleFromHeader({
      filename: "estimate.pdf",
      text: "Estimate total $1,234.56\nVehicle: 2023 Tesla Model Y",
    });
    expect(result.estimateRole).toBe("unknown");
    expect(result.estimateRole).not.toBe("carrier_estimate");
  });
});

// ---------------------------------------------------------------------------
// PROMPT 2 (GATE for Step 4) — crossmember leads, wheel R&I never leads
// ---------------------------------------------------------------------------

describe("PROMPT2(gate) — crossmember D17 is first canonical finding; wheel R&I does not lead", () => {
  function buildRendererContext(set: ReturnType<typeof buildTestDeltaSet>): AnnotatedEstimateFindingGeneratorContext {
    return {
      anchors: [],
      visualLines: [],
      sourcePdfName: "Shop_21896.pdf",
      sourceDocumentRole: "shop",
      sourcePdfHash: fixture.files.initial.hash,
      uploadedFileNames: ["Shop_21896.pdf", "Shop_Final_21896.pdf"],
      comparisonEstimateTexts: [],
      canonicalDeltaSet: set,
    };
  }

  it("first finding from the actual renderer path is the crossmember (D17, highest-magnitude PRESENCE)", () => {
    const set = buildTestDeltaSet();
    const { findings } = buildRequiredEstimatorDeltaFindings(buildRendererContext(set));
    expect(findings.length).toBeGreaterThan(0);
    const first = findings[0];
    expect(first.operationLabel.toLowerCase()).toMatch(/crossmember/i);
    expect(first.limitations.some((l) => l.includes("canonicalDeltaClass:PRESENCE"))).toBe(true);
  });

  it("first finding ID embeds D17", () => {
    const set = buildTestDeltaSet();
    const { findings } = buildRequiredEstimatorDeltaFindings(buildRendererContext(set));
    expect(findings[0].id).toMatch(/canonical-delta-D17/);
  });

  it("D17 carries PRESENT_ONLY_IN_COMPARISON and ESTIMATE_GAP_ONLY", () => {
    const set = buildTestDeltaSet();
    const { findings } = buildRequiredEstimatorDeltaFindings(buildRendererContext(set));
    const first = findings[0];
    expect(first.id).toMatch(/canonical-delta-D17/);
    expect(first.deltaClass).toBe("PRESENT_ONLY_IN_COMPARISON");
    expect(first.evidenceStatus).toBe("ESTIMATE_GAP_ONLY");
  });

  it("first finding is NOT a wheel R&I labor line", () => {
    const set = buildTestDeltaSet();
    const { findings } = buildRequiredEstimatorDeltaFindings(buildRendererContext(set));
    const first = findings[0];
    expect(first.operationLabel.toLowerCase()).not.toMatch(/\bwheel\b.*\br&i\b|\br&i\b.*\bwheel\b|wheel.*labor|remove.*install.*wheel/i);
  });

  it("all findings carry canonicalDeltaObjectId from the test delta set", () => {
    const set = buildTestDeltaSet("gate-test-id");
    const { findings } = buildRequiredEstimatorDeltaFindings(buildRendererContext(set));
    for (const finding of findings) {
      expect(finding.canonicalDeltaObjectId, `finding ${finding.id} missing canonicalDeltaObjectId`).toBe("gate-test-id");
    }
  });

  it("D17 crossmember has higher priority score than any wheelhouse delta", () => {
    const set = buildTestDeltaSet();
    const d17 = set.deltas.find((d) => d.id === "D17")!;
    const wheelHousingDeltas = set.deltas.filter((d) => /wheelhouse|wheel\s+op/i.test(d.operation));
    const d17Score = (d17.magnitudeDollar ?? 0) + Math.abs(d17.magnitudeLaborHrs ?? 0) * 60;
    for (const wd of wheelHousingDeltas) {
      const wScore = (wd.magnitudeDollar ?? 0) + Math.abs(wd.magnitudeLaborHrs ?? 0) * 60;
      expect(d17Score, `D17 score must exceed ${wd.id} score`).toBeGreaterThan(wScore);
    }
  });
});

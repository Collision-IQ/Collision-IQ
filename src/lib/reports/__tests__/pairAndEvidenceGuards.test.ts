/**
 * RO 22084, second failure: the run refused as "found nothing" when it had
 * either compared an estimate with a copy of itself, or produced findings the
 * bundle could not count. Two guards:
 *
 *  - a target/source pair is distinct BY CONTENT, never by attachment id;
 *  - the R24 refusal names what was produced, by evidence tier, and how many
 *    rows each document yielded, so "0 evidence-backed" is never the whole
 *    story. A delta anchored to a resolved row is publishable on its own; an
 *    authority citation raises its tier, it never gates existence.
 */
import { describe, expect, it } from "vitest";
import type { StoredAttachment } from "@/lib/uploadedAttachmentStore";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import { sameEstimateDocument } from "../citationDensitySourcePdf";
import { runDeltaReleaseGate, type DeltaBundle } from "../deltaReleaseGate";
import { buildProductionReleaseBundle } from "../annotatedCitationDensityEstimate";

const pdfDataUrl = (body: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n${body}`).toString("base64")}`;
const longText = (seed: string) => `${seed} `.repeat(60);

function attachment(overrides: Partial<StoredAttachment> & { id: string }): StoredAttachment {
  return {
    filename: `${overrides.id}.pdf`,
    type: "application/pdf",
    text: "",
    ...overrides,
  } as StoredAttachment;
}

describe("a target/source pair is distinct by content", () => {
  it("the same bytes under two attachment ids are one document", () => {
    const a = attachment({ id: "a", filename: "Shop.pdf", imageDataUrl: pdfDataUrl("estimate"), text: longText("shop") });
    const b = attachment({ id: "b", filename: "Shop (1).pdf", imageDataUrl: pdfDataUrl("estimate"), text: "" });
    expect(sameEstimateDocument(a, b)).toBe("bytes");
  });

  it("the same extracted text under different bytes is one document", () => {
    const a = attachment({ id: "a", imageDataUrl: pdfDataUrl("print one"), text: longText("Grand Total 13,844.81 Repl Bumper") });
    const b = attachment({ id: "b", imageDataUrl: pdfDataUrl("print two"), text: longText("Grand Total 13,844.81 Repl Bumper") });
    expect(sameEstimateDocument(a, b)).toBe("text");
  });

  it("different documents are different, and a short identical stub is not evidence of sameness", () => {
    const shop = attachment({ id: "a", imageDataUrl: pdfDataUrl("shop"), text: longText("shop estimate") });
    const carrier = attachment({ id: "b", imageDataUrl: pdfDataUrl("carrier"), text: longText("carrier estimate") });
    expect(sameEstimateDocument(shop, carrier)).toBeNull();
    const stubA = attachment({ id: "c", imageDataUrl: pdfDataUrl("x"), text: "Estimate" });
    const stubB = attachment({ id: "d", imageDataUrl: pdfDataUrl("y"), text: "Estimate" });
    expect(sameEstimateDocument(stubA, stubB)).toBeNull();
  });
});

describe("the R24 refusal says what was produced", () => {
  const base: DeltaBundle = {
    run_mode: "FULL",
    target: { file: "Shop.pdf", grand_total: 13844.81, platform: "ccc", line_count: 0 },
    source: { file: "SOR.pdf", grand_total: 11618.63, platform: "ccc", line_count: 0 },
    findings: [],
    category_deltas: [{ category: "Parts", delta: -1200 }],
    authorities: [],
  };

  it("with no findings it reports the rows read on each side", () => {
    const r24 = runDeltaReleaseGate(base).filter((v) => v.rule === "R24").map((v) => v.message);
    expect(r24.some((m) => /below the release floor/.test(m))).toBe(true);
    expect(r24.some((m) => /no findings were produced — rows read: target 0, source 0/.test(m))).toBe(true);
    expect(r24.some((m) => /check that the two documents are different/.test(m))).toBe(true);
  });

  it("with findings it names the evidence tiers", () => {
    const bundle: DeltaBundle = {
      ...base,
      target: { ...base.target, line_count: 120 },
      source: { ...base.source, line_count: 98 },
      findings: [
        { id: "f-anchored", type: "missing_operation", anchors: ["ln:12"], text: "Repl fender" },
        { id: "f-category", type: "rate_delta", anchors: [], scope: "category", text: "Body Labor" },
        { id: "f-open", type: "value_delta", anchors: [], text: "unresolved row" },
        { id: "f-spec", type: "structural_review", anchors: [], text: "structural" },
      ],
    };
    const r24 = runDeltaReleaseGate(bundle).filter((v) => v.rule === "R24").map((v) => v.message);
    const floor = r24.find((m) => /below the release floor/.test(m));
    expect(floor).toMatch(/only 2 evidence-backed finding\(s\)/);
    expect(floor).toMatch(/4 finding\(s\) produced: 1 line-anchored, 1 category-level, 1 unanchored \(open verification\), 1 speculative/);
  });

  it("three anchored deltas with no authority attached clear the floor", () => {
    const bundle: DeltaBundle = {
      ...base,
      findings: [1, 2, 3].map((n) => ({ id: `f-${n}`, type: "missing_operation", anchors: [`ln:${n}`], text: `line ${n}` })),
    };
    expect(runDeltaReleaseGate(bundle).some((v) => v.rule === "R24" && /release floor/.test(v.message))).toBe(false);
  });
});

describe("the release bundle counts a resolved row without a printed line number as an anchor", () => {
  const finding = (id: string, overrides: Partial<CitationDensityFinding>): CitationDensityFinding =>
    ({
      id,
      operationLabel: "Missing from comparison estimate: Repl fender",
      category: "other",
      estimateGapType: "missing_from_carrier",
      impact: { safetyImpact: "low", supplementPriority: "medium" },
      citationStatus: {} as CitationDensityFinding["citationStatus"],
      citationDensityScore: 40,
      verifiedAuthorityCount: 0,
      missingAuthorityTypes: [],
      currentSupportSummary: "",
      missingProofSummary: "",
      recommendedNextAction: "",
      confidence: "medium",
      limitations: [],
      ...overrides,
    }) as CitationDensityFinding;

  const bundle = buildProductionReleaseBundle({
    sourcePdfName: "Shop.pdf",
    sourceText: "CCC ONE Estimate\nEstimate Totals\nGrand Total 13,844.81",
    comparison: { fileName: "SOR.pdf", text: "CCC ONE Estimate\nGrand Total 11,618.63" },
    findings: [
      finding("required-detector-delta-missing-operation-a-ln-12", {
        shopEvidence: { lineNumber: "12", description: "Repl fender", amount: 905 },
      }),
      finding("required-detector-delta-missing-operation-b", {
        shopAnchor: { anchorId: "doc:p2:row-7:engine_row", estimateRole: "shop", lineNumber: null },
        shopEvidence: { lineNumber: null, description: "Blnd rocker", amount: null },
      }),
      finding("required-detector-delta-missing-operation-c", {
        shopEvidence: { lineNumber: null, description: "no anchor at all", amount: null },
      }),
    ],
    reconciliation: null,
    intakeModeActive: false,
    unanchoredAppendixRendered: true,
    retrievedSources: [],
    lineCounts: { target: 171, source: 98 },
  });

  it("line numbers stay the anchor when printed; the row's anchor id stands in when not; nothing invents one", () => {
    const byId = new Map((bundle.findings ?? []).map((f) => [f.id, f]));
    expect(byId.get("required-detector-delta-missing-operation-a-ln-12")?.anchors).toEqual(["ln:12"]);
    expect(byId.get("required-detector-delta-missing-operation-b")?.anchors).toEqual(["anchor:doc:p2:row-7:engine_row"]);
    expect(byId.get("required-detector-delta-missing-operation-c")?.anchors).toEqual([]);
    expect(byId.get("required-detector-delta-missing-operation-c")?.unanchored_disclosed).toBe(true);
  });

  it("carries the rows read on each side", () => {
    expect(bundle.target?.line_count).toBe(171);
    expect(bundle.source?.line_count).toBe(98);
  });
});

/**
 * A bumper overhaul and the same bumper's R&I are one operation written at
 * two scopes, and the estimating guide for the estimate's platform is
 * retrieved on every comparison to state that premise.
 *
 * An O/H is the bumper's R&I plus the dismantle and reassembly of what is
 * mounted to it (moldings, fog lamps, upper grilles and covers); R&I of the
 * bumper is included when O/H is present. RO 22120 printed our rear "O/H
 * bumper assy 3.7" (REAR BODY & FLOOR, with "Air deflector Incl." under it)
 * against the carrier's rear "R&I bumper cover 1.7", "R&I LT Upper cover 0.8"
 * (its note: "Time included with overhaul.") and "Air deflector 0.3". The
 * reports called our overhaul missing ($333) and their R&I lines work ours
 * lacks; the one comparison is 3.7 against 2.8.
 *
 * Lines are de-identified, in the prints' shapes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { pairAndCompare } from "../deltaEngine/deltaPair";
import { canonKey } from "../deltaEngine/estimateNormalize";
import type { EstimateRow } from "../deltaEngine/rowCluster";
import { isBumperUnitText } from "../appraisalSummary/bumperOverhaul";
import { groupEquivalents } from "../appraisalSummary/operationEquivalence";
import { argueItems, type MatcherPair } from "../appraisalSummary/argueItems";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";
import {
  estimatingGuideTopicsFor,
  mapAuthorityTraceToResolvedAuthorities,
  mergeEstimatingGuideSources,
} from "../oemAuthorityRetrieval";
import { attachResolvedAuthoritiesToFindings, type OemCitationDensityAuthorityTrace } from "../annotatedCitationDensityEstimate";
import { retrieveEstimatingGuideSupport } from "@/lib/ai/webRetrievalService";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

const engineRow = (line: number, rawDesc: string, sectionLabel: string, labor: number | null, price: number | null = null): EstimateRow => {
  const canon = canonKey(rawDesc);
  return {
    page: 1,
    line,
    section: sectionLabel.replace(/[^A-Z]/g, ""),
    sectionLabel,
    qty: null,
    price,
    labor,
    paint: null,
    laborClass: "",
    part: null,
    rawDesc,
    key: canon.key,
    side: canon.side,
    cells: {},
  };
};

describe("the delta engine pairs an overhaul with the same end's bumper R&I", () => {
  const shop = [
    engineRow(4, "O/H bumper assy", "FRONT BUMPER & GRILLE", 2.5),
    engineRow(56, "O/H bumper assy", "REAR BODY & FLOOR", 3.7),
  ];
  const carrier = [
    engineRow(3, "S02 O/H bumper assy", "FRONT", 2.5),
    engineRow(42, "R&I bumper cover", "REAR BUMPER", 1.7),
  ];

  it("compares the rear O/H 3.7 with the rear R&I 1.7, and the front overhauls with each other", () => {
    const result = pairAndCompare(shop, carrier);
    expect(result.findings.filter((f) => f.kind === "MISSED")).toEqual([]);
    expect(result.findings.filter((f) => f.kind === "QTY_SHORTFALL")).toEqual([]);
    const rear = result.findings.find((f) => f.subject.line === 56)!;
    expect(rear.kind).toBe("VALUE_DELTA");
    expect(rear.competing?.line).toBe(42);
    expect(rear.operationScope).toEqual({ subject: "O/H", competing: "R&I" });
    expect(rear.deltas).toEqual([{ field: "labor", subject: 3.7, competing: 1.7 }]);
    expect(result.competingOnly).toEqual([]);
    expect(result.pairs.find((p) => p.subject.line === 4)?.competing.line).toBe(3);
  });

  it("never pairs across ends, and never with a part mounted on the bumper", () => {
    const front = pairAndCompare([engineRow(56, "O/H bumper assy", "REAR BODY & FLOOR", 3.7)], [engineRow(9, "R&I bumper cover", "FRONT BUMPER", 1.5)]);
    expect(front.findings.map((f) => f.kind)).toEqual(["MISSED"]);
    expect(front.competingOnly.map((r) => r.line)).toEqual([9]);
    const bracket = pairAndCompare([engineRow(56, "O/H bumper assy", "REAR BUMPER", 3.7)], [engineRow(44, "R&I bumper bracket", "REAR BUMPER", 0.4)]);
    expect(bracket.findings.map((f) => f.kind)).toEqual(["MISSED"]);
  });

  it("a bumper unit is the bumper, its cover or fascia; a part on it is not", () => {
    expect(isBumperUnitText("R&I bumper cover")).toBe(true);
    expect(isBumperUnitText("bumper assy")).toBe(true);
    expect(isBumperUnitText("Bumper cover w/o park assist")).toBe(true);
    for (const part of ["Upper bumper cover", "Bumper bracket", "Bumper absorber", "Bumper cover molding", "LT Upper cover"]) {
      expect(isBumperUnitText(part)).toBe(false);
    }
  });
});

const estimate = (role: "shop" | "carrier", lines: EstimateLine[]): Estimate => ({
  role,
  fileName: role === "shop" ? "Shop.pdf" : "SOR.pdf",
  vehicle: "",
  totals: {
    parts: 0,
    misc: 0,
    labor: [{ cat: "body", label: "Body Labor", hours: 10, rate: 90, cost: 900 }],
    paintSupplies: { hours: 0, rate: 0, cost: 0 },
    subtotal: 0,
    tax: 0,
    grandTotal: 0,
  },
  lines,
});

describe("the dispute report argues the overhaul as one comparison", () => {
  const shop = estimate("shop", [
    { line: 56, oper: "O/H", desc: "bumper assy", hours: 3.7, laborCat: "body", section: "REAR BODY & FLOOR" },
    { line: 57, oper: "Repl", desc: "Air deflector w/AWD", hours: 0, price: 230, laborCat: "body", section: "REAR BODY & FLOOR" },
    { line: 34, oper: "Repl", desc: "LT/Rear tire", hours: 0, price: 454.26, laborCat: "body", section: "REAR SUSPENSION" },
  ]);
  const carrier = estimate("carrier", [
    { line: 36, oper: "Repl", desc: "Air deflector w/AWD", hours: 0.3, price: 230, laborCat: "body", section: "REAR BUMPER" },
    {
      line: 38,
      oper: "R&I",
      desc: "LT Upper cover",
      hours: 0.8,
      laborCat: "body",
      section: "REAR BUMPER",
      note: "Time is after bumper cover is removed. Time included with overhaul.",
    },
    { line: 42, oper: "R&I", desc: "bumper cover", hours: 1.7, laborCat: "body", section: "REAR BUMPER" },
  ]);
  const pairs: MatcherPair[] = [
    { kind: "reduced", shopLines: [56], carrierLine: 42 },
    { kind: "reduced", shopLines: [57], carrierLine: 36 },
    { kind: "missing", shopLines: [34] },
  ];

  it("our O/H with its Incl. deflector against their R&I cover, upper cover and deflector: 3.7 vs 2.8", () => {
    const { groups, usedShop } = groupEquivalents(shop, carrier, pairs);
    const group = groups.find((g) => g.key === "bumperOverhaul:rear")!;
    expect(group.label).toBe("Rear bumper overhaul");
    expect(group.shopLines.sort()).toEqual([56, 57]);
    expect(group.carrierLines.sort()).toEqual([36, 38, 42]);
    expect(group.shopHours).toBe(3.7);
    expect(group.carrierHours).toBe(2.8);
    // The tire is a zero-hour rear line, but not inside the overhaul.
    expect(usedShop.has(34)).toBe(false);
    const item = argueItems({ shop, carrier, groups, usedShop, flags: [], pairs }).find((i) => i.title === "Rear bumper overhaul")!;
    expect(item.value).toBe(81);
    expect(item.detail).toMatch(/Ours is an O\/H; theirs an R&I of the same bumper\. An overhaul includes the bumper's R&I/);
  });

  it("no group forms when both sheets overhaul the same bumper", () => {
    const both = estimate("carrier", [{ line: 3, oper: "O/H", desc: "bumper assy", hours: 3.7, laborCat: "body", section: "REAR BUMPER" }]);
    const { groups } = groupEquivalents(shop, both, [{ kind: "matched", shopLines: [56], carrierLine: 3 }]);
    expect(groups.filter((g) => g.key.startsWith("bumperOverhaul"))).toEqual([]);
  });
});

describe("every comparison retrieves the estimating guide for its platform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks about overhaul first when an estimate prints one", () => {
    expect(estimatingGuideTopicsFor("56 O/H bumper assy 3.7\n12 Blnd LT Fender")).toEqual([
      "overhaul included operations",
      "refinish overlap blend",
    ]);
    expect(estimatingGuideTopicsFor("12 Repl LT Fender")).toEqual(["included not included operations"]);
  });

  it("queries each document's own guide and keeps only guide pages", async () => {
    vi.stubEnv("SERPER_API_KEY", "test-key");
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { q } = JSON.parse(init.body) as { q: string };
        queries.push(q);
        return new Response(
          JSON.stringify({
            organic: [
              { title: "Overhaul", link: "https://static.mymitchell.com/static/Webhelp/ppages/ceg/1033/Content/ceg020500.htm", snippet: "s" },
              { title: "A blog about overhauls", link: "https://example.com/overhaul", snippet: "s" },
            ],
          }),
          { status: 200 }
        );
      })
    );
    const response = await retrieveEstimatingGuideSupport({ platforms: ["mitchell", "ccc"], topics: ["overhaul included operations"] });
    expect(queries).toEqual([
      "site:static.mymitchell.com/static/webhelp/ppages/ceg overhaul included operations",
      "site:help.cccis.com/webhelp/motor/gte overhaul included operations",
    ]);
    expect(response.status).toBe("success");
    expect(response.results.map((r) => r.title)).toEqual(["Overhaul"]);
  });

  it("is not configured, not an error, without a search key", async () => {
    vi.stubEnv("SERPER_API_KEY", "");
    vi.stubEnv("GOOGLE_SERPER_API_KEY", "");
    expect((await retrieveEstimatingGuideSupport({ platforms: ["ccc"], topics: ["x"] })).status).toBe("not_configured");
  });
});

describe("a retrieved guide section reaches the finding it supports, by section, never by link", () => {
  const baseTrace = {
    authorityTraceStarted: true,
    authorityTraceCompleted: true,
    authorityCoverageStatus: "partial",
    googleDriveOrInternalSearchRan: true,
    driveSearchAttempted: true,
    driveSearchAvailable: true,
    driveMakeModelFolderMatched: false,
    driveMatchedFolders: [],
    driveDocumentsReviewed: [],
    onlineSearchAttempted: false,
    onlineSourcesReviewed: [],
    jurisdictionResolved: null,
    jurisdictionSourcesReviewed: [],
    oemSourcesReviewed: [],
    adasSourcesReviewed: [],
    motorPPageSourcesReviewed: [],
    scrsSourcesReviewed: [],
    policyLegalSourcesReviewed: [],
    authoritySources: [],
  } as unknown as OemCitationDensityAuthorityTrace;
  const guideHit = {
    id: "g1",
    title: "Overhaul",
    url: "https://help.cccis.com/webhelp/motor/gte/overhaul.htm",
    snippet: "Overhaul includes R&I of the assembly.",
    sourceType: "industry" as const,
    query: "q",
    relevanceScore: 0.75,
  };

  it("is merged into the trace under its section reference", () => {
    const merged = mergeEstimatingGuideSources(baseTrace, { status: "success", queries: ["q"], results: [guideHit] });
    expect(merged.authoritySources).toHaveLength(1);
    const [source] = merged.authoritySources;
    expect(source.url).toBeUndefined();
    expect(source.locator).toMatch(/^Estimating guide reference — CCC\/MOTOR Guide to Estimating \(GTE\) — Overhaul/);
    expect(JSON.stringify(merged)).not.toContain("help.cccis.com");
    expect(merged.motorPPageSourcesReviewed).toEqual(["CCC/MOTOR Guide to Estimating (GTE): Overhaul"]);
    // Merging the same hit again adds nothing.
    expect(mergeEstimatingGuideSources(merged, { status: "success", queries: ["q"], results: [guideHit] }).authoritySources).toHaveLength(1);
  });

  it("attaches to the overhaul finding as a P-page, and not to an unrelated finding", () => {
    const merged = mergeEstimatingGuideSources(baseTrace, { status: "success", queries: ["q"], results: [guideHit] });
    const finding = (id: string, operationLabel: string, currentSupportSummary: string) =>
      ({ id, operationLabel, category: "labor_difference", currentSupportSummary }) as CitationDensityFinding;
    const overhaul = finding("f1", "Comparison estimate allows less body labor: bumper assy", "bumper assy: O/H here vs R&I on the comparison estimate");
    const other = finding("f2", "Missing from comparison estimate: LT Caliper assy", "Documented on the higher estimate.");
    const attached = attachResolvedAuthoritiesToFindings([overhaul, other], mapAuthorityTraceToResolvedAuthorities(merged), { vehicleMake: "Tesla" });
    expect(attached).toBe(1);
    expect(overhaul.bestAvailableAuthority).toMatchObject({ type: "p_page", confidence: "medium" });
    expect(overhaul.matchedDocumentUrl).toBeNull();
    expect(other.bestAvailableAuthority).toBeUndefined();
  });
});

/**
 * RO 22319 opinion review (2023 Toyota Tacoma, CCC ONE shop final against
 * Allstate SOR-2): what the reports must do to match the written opinion.
 *
 *  1. Pair one panel written under two names in the same printed section
 *     ("Rpr RT Door shell" / "Rpr RT Outer panel" under FRONT DOOR), and one
 *     blend written two ways ("Blnd RT Fender w/wheel opening…" / "Blnd RT
 *     Fender w/o wheel opening…"). The old reports showed the door shells as
 *     missing and the carrier's outer panels as $1,147.50 carrier-only.
 *  2. Let the operation alias table reach the typed engine (front radar,
 *     window urethane): it reported each as missing plus carrier-only.
 *  3. Quote a requirement an uploaded case document prints (the ADAS
 *     report's Toyota extract: "the power window control system must be
 *     initialized"), and promote an item to STRONG when their own line
 *     triggers that requirement.
 *  4. Name the judgment calls on our own sheet the carrier will cut first:
 *     every blend exactly twice theirs, R&I plus align of one striker, a test
 *     fit of a part neither sheet replaces.
 *
 * Lines are shaped like the two prints; descriptions and hours as printed.
 */
import { describe, expect, it } from "vitest";
import { pairAndCompare } from "../deltaEngine/deltaPair";
import { canonKey } from "../deltaEngine/estimateNormalize";
import type { EstimateRow } from "../deltaEngine/rowCluster";
import { argueItems, type MatcherPair } from "../appraisalSummary/argueItems";
import { integrityChecks } from "../appraisalSummary/integrityChecks";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";
import { explainLaborDifference, type RationaleLine } from "../laborRationale";

const engineRow = (line: number, rawDesc: string, sectionLabel: string, labor: number | null, paint: number | null = null, price: number | null = null): EstimateRow => {
  const canon = canonKey(rawDesc);
  return {
    page: 1,
    line,
    section: sectionLabel.replace(/[^A-Z]/g, ""),
    sectionLabel,
    qty: null,
    price,
    labor,
    paint,
    laborClass: "",
    part: null,
    rawDesc,
    key: canon.key,
    side: canon.side,
    cells: {},
  };
};

describe("pass 7: one panel under two names in one printed section", () => {
  const shop = [
    engineRow(69, "Rpr RT Door shell", "FRONT DOOR", 4.0, 2.1),
    engineRow(91, "Rpr RT Door shell", "REAR DOOR", 5.0, 2.2),
    engineRow(15, "Blnd RT Fender w/wheel opening molding w/o snorkel intake", "FENDER", null, 2.2),
  ];
  const carrier = [
    engineRow(54, "S01 Rpr RT Outer panel", "FRONT DOOR", 4.0, 2.1),
    engineRow(73, "S01 Rpr RT Outer panel", "REAR DOOR", 7.0, 2.2),
    engineRow(11, "S01 Blnd RT Fender w/o wheel opening molding", "FENDER", null, 1.1),
  ];
  const result = pairAndCompare(shop, carrier);

  it("pairs each door shell with the outer panel under its own door, never across doors", () => {
    const pairs = result.pairs.map((p) => [p.subject.line, p.competing.line]);
    expect(pairs).toEqual(expect.arrayContaining([[69, 54], [91, 73], [15, 11]]));
    expect(result.findings.some((f) => f.kind === "MISSED")).toBe(false);
    expect(result.competingOnly).toEqual([]);
  });

  it("an identical pair is no finding; a different pair is a value delta marked as a section pair", () => {
    expect(result.findings.find((f) => f.subject.line === 69)).toBeUndefined();
    const rear = result.findings.find((f) => f.subject.line === 91)!;
    expect(rear).toMatchObject({ kind: "VALUE_DELTA", sectionPanel: true });
    const fender = result.findings.find((f) => f.subject.line === 15)!;
    expect(fender.deltas).toEqual([{ field: "paint", subject: 2.2, competing: 1.1 }]);
  });

  it("two repairs on one side of one section are never paired by place", () => {
    const twoRepairs = pairAndCompare(
      [engineRow(69, "Rpr RT Door shell", "FRONT DOOR", 4.0, 2.1)],
      [engineRow(54, "Rpr RT Outer panel", "FRONT DOOR", 4.0, 2.1), engineRow(55, "Rpr RT Lock pillar", "FRONT DOOR", 1.5, 0.5)]
    );
    expect(twoRepairs.findings.find((f) => f.subject.line === 69)?.kind).toBe("MISSED");
  });

  it("a molding or a part is not a panel: it is never paired by its section", () => {
    const moldings = pairAndCompare(
      [engineRow(20, "Rpr RT Wheel opng mldg", "FENDER", 1.0, 0.5)],
      [engineRow(18, "Rpr RT Fender", "FENDER", 2.0, 1.5)]
    );
    expect(moldings.findings.find((f) => f.subject.line === 20)?.kind).toBe("MISSED");
  });
});

describe("pass 8: the operation alias table reaches the typed engine", () => {
  it("pairs the two radar calibrations and the two window urethanes as priced differently, not missing", () => {
    const result = pairAndCompare(
      [
        engineRow(171, "# Subl Millimeter Wave Radar static calibration +34%", "VEHICLE DIAGNOSTICS", 0, 0, 469),
        engineRow(121, "# BetaSeal Express Urethane", "BACK GLASS", 0, 0, 37),
      ],
      [
        engineRow(136, "* S01 Subl Calibrate front radar sensor", "VEHICLE DIAGNOSTICS", 0, 0, 390),
        engineRow(97, "3M Super fast window urethane", "BACK GLASS", 0, 0, 37.19),
      ]
    );
    expect(result.pairs.map((p) => [p.subject.line, p.competing.line])).toEqual(expect.arrayContaining([[171, 136], [121, 97]]));
    expect(result.findings.some((f) => f.kind === "MISSED")).toBe(false);
    expect(result.competingOnly).toEqual([]);
  });
});

const ADAS_REPORT = {
  name: "ADAS-3TMCZ5AN2PM626196.pdf",
  text: `Functional Operations\n Power Window System Procedure Type: Initialization\n Repair/Installation Triggers: Door, Door\n 1. INITIALIZE POWER WINDOW CONTROL SYSTEM\n   NOTICE:\n        When a door window regulator assembly, power window regulator motor assembly, door glass or\n        door glass run is reinstalled or replaced, the power window control system must be initialized.\n        Functions such as the auto up and down function, jam protection function ... will not operate.`,
};

describe("a requirement printed in a case document is quoted, and their own trigger makes it STRONG", () => {
  const L = (line: number, oper: string, desc: string, hours = 0, price = 0, section?: string): RationaleLine => ({
    line, oper, desc, hours, paintHours: 0, price, section,
  });
  const shopSheet = [L(80, "R&I", "RT Run channel", 0.3, 0, "FRONT DOOR"), L(174, "Subl", "Power window initialization +34%", 0, 90.45)];
  const carrierSheet = [
    L(67, "R&I", "RT Door glass Toyota", 0.5, 0, "FRONT DOOR"),
    L(68, "R&I", "RT Run channel", 0.3, 0, "FRONT DOOR"),
    L(94, "R&I", "Window regulator", 0.4, 0, "BACK GLASS"),
    L(151, "", "D&R Battery/Reset Electronics", 0.5),
  ];

  it("quotes the sentence as the document prints it and names the door work that triggers it", () => {
    const r = explainLaborDifference({
      higher: [shopSheet[1]],
      lower: null,
      higherSheet: shopSheet,
      lowerSheet: carrierSheet,
      voice: "dispute",
      caseDocuments: [ADAS_REPORT],
    })!;
    expect(r.caseEvidence).toEqual({
      document: "ADAS-3TMCZ5AN2PM626196.pdf",
      quote:
        "INITIALIZE POWER WINDOW CONTROL SYSTEM NOTICE: When a door window regulator assembly, power window regulator motor assembly, door glass or door glass run is reinstalled or replaced, the power window control system must be initialized.",
    });
    expect(r.settledBy).toMatch(/^In the case file, ADAS-3TMCZ5AN2PM626196\.pdf: "INITIALIZE POWER WINDOW/);
    // The back glass regulator and the battery are not the door work the requirement names.
    expect(r.concededBy).toEqual([67, 68]);
  });

  it("without a case document the same item stays NEEDS PROOF and quotes nothing", () => {
    const r = explainLaborDifference({ higher: [shopSheet[1]], lower: null, higherSheet: shopSheet, lowerSheet: carrierSheet, voice: "dispute" })!;
    expect(r.caseEvidence).toBeUndefined();
    expect(r.settledBy).not.toContain("In the case file");
  });

  it("a price-only difference never carries a requirement quote", () => {
    const r = explainLaborDifference({
      higher: [L(171, "Subl", "Millimeter Wave Radar static calibration +34%", 0, 469)],
      lower: L(136, "Subl", "Calibrate front radar sensor +12%", 0, 390),
      higherSheet: [],
      lowerSheet: [],
      voice: "dispute",
      caseDocuments: [{ name: "ADAS.pdf", text: "the Millimeter Wave Radar necessitates the above mentioned procedure should any of the following occur: Front Bumper." }],
    })!;
    expect(r.key).toBe("sublet_price");
    expect(r.caseEvidence).toBeUndefined();
  });

  const estimate = (role: "shop" | "carrier", lines: EstimateLine[]): Estimate => ({
    role,
    fileName: role === "shop" ? "Shop final 22319.pdf" : "SOR-2 22319.pdf",
    vehicle: "2023 TOYO Tacoma 4WD SR5 Double Cab",
    platform: "ccc",
    totals: {
      parts: 0,
      misc: 0,
      labor: [{ cat: "body", label: "Body Labor", hours: 10, rate: 75, cost: 750 }],
      paintSupplies: { hours: 0, rate: 0, cost: 0 },
      subtotal: 0,
      tax: 0,
      grandTotal: 0,
    },
    lines,
  });
  const shop = estimate("shop", [{ line: 174, oper: "Subl", desc: "Power window initialization +34%", price: 90.45 }]);
  const carrier = estimate("carrier", [
    { line: 67, oper: "R&I", desc: "RT Door glass Toyota", hours: 0.5, section: "FRONT DOOR" },
    { line: 68, oper: "R&I", desc: "RT Run channel", hours: 0.3, section: "FRONT DOOR" },
  ]);
  const pairs: MatcherPair[] = [{ kind: "missing", shopLines: [174] }];

  it("the dispute report argues it STRONG, with their trigger lines and the case document named", () => {
    const [item] = argueItems({ shop, carrier, groups: [], usedShop: new Set(), flags: [], pairs, caseDocuments: [ADAS_REPORT] });
    expect(item.strength).toBe("Strong");
    expect(item.detail).toBe(
      "No counterpart on their sheet (L174, 0.0 hr, $90.45 part). Their L67, L68 trigger it, and ADAS-3TMCZ5AN2PM626196.pdf in the case file requires it."
    );
  });

  it("with no case document the item is NEEDS PROOF, as before", () => {
    const [item] = argueItems({ shop, carrier, groups: [], usedShop: new Set(), flags: [], pairs });
    expect(item.strength).toBe("Needs proof");
    expect(item.detail).toBe("No counterpart on their sheet (L174, 0.0 hr, $90.45 part).");
  });
});

describe("judgment calls on our own sheet go to 'Clean up our own sheet'", () => {
  const estimate = (role: "shop" | "carrier", lines: EstimateLine[]): Estimate => ({
    role,
    fileName: role,
    vehicle: "",
    totals: { parts: 0, misc: 0, labor: [], paintSupplies: { hours: 0, rate: 0, cost: 0 }, subtotal: 0, tax: 0, grandTotal: 0 },
    lines,
  });
  const shop = estimate("shop", [
    { line: 15, oper: "Blnd", desc: "RT Fender w/wheel opening molding w/o snorkel intake", paintHours: 2.2 },
    { line: 37, oper: "Blnd", desc: "RT Hinge pillar", paintHours: 2.0 },
    { line: 38, oper: "Blnd", desc: "RT Ctr plr & rocker", paintHours: 2.2 },
    { line: 83, oper: "R&I", desc: "RT Striker", hours: 0.2 },
    { line: 84, oper: "Algn", desc: "RT Striker", hours: 0.2 },
    { line: 115, oper: "", desc: "Test fit-RT Rear door", hours: 1.0 },
  ]);
  const carrier = estimate("carrier", [
    { line: 11, oper: "Blnd", desc: "RT Fender w/o wheel opening molding", paintHours: 1.1 },
    { line: 32, oper: "Blnd", desc: "RT Hinge pillar", paintHours: 1.0 },
    { line: 33, oper: "Blnd", desc: "RT Ctr plr & rocker", paintHours: 1.1 },
    { line: 70, oper: "R&I", desc: "RT Striker", hours: 0.2 },
  ]);
  const flags = integrityChecks(shop, carrier);
  const byKind = (kind: string) => flags.filter((f) => f.kind === kind);

  it("every blend twice theirs is named as our blend share, with each pair", () => {
    const [flag] = byKind("blendShareDouble");
    expect(flag).toMatchObject({ side: "shop", lines: { shop: [15, 37, 38], carrier: [11, 32, 33] } });
    expect(flag.text).toContain("On every panel both sheets blend, ours is exactly twice theirs: RT Fender w/wheel opening molding w/o snorkel intake 2.2 hr (L15) vs 1.1 hr (L11)");
  });

  it("one blend at a different share is not a pattern", () => {
    const mixed = integrityChecks(
      shop,
      estimate("carrier", [
        { line: 11, oper: "Blnd", desc: "RT Fender w/o wheel opening molding", paintHours: 1.1 },
        { line: 32, oper: "Blnd", desc: "RT Hinge pillar", paintHours: 1.6 },
      ])
    );
    expect(mixed.some((f) => f.kind === "blendShareDouble")).toBe(false);
  });

  it("R&I and align of one striker, and a test fit of a part nobody replaces", () => {
    expect(byKind("removeAndAlignSamePart")[0]).toMatchObject({ side: "shop", lines: { shop: [83, 84] } });
    expect(byKind("testFitWithoutReplacement")[0].text).toBe(
      'Our L115 "Test fit-RT Rear door" test-fits a part neither sheet replaces. Name what is actually fitted, or remove the line.'
    );
    const replaced = integrityChecks(shop, estimate("carrier", [{ line: 60, oper: "Repl", desc: "RT Rear door", price: 900 }]));
    expect(replaced.some((f) => f.kind === "testFitWithoutReplacement")).toBe(false);
  });
});

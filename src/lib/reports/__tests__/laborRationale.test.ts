/**
 * The case for each difference: WHY the higher estimate carries an operation
 * (or more time for it), not only THAT it does.
 *
 * RO 22319 review (2021 Toyota Tacoma, CCC ONE shop final $13,182.44 against
 * the carrier's SOR-2 $8,283.96): both reports said "No counterpart on their
 * sheet (L155, 2.0 hr)" and "Ours 2.2 hr, theirs 1.1 hr" and stopped. The
 * owner's note: "Simply stating one does is not enough." The lines below are
 * shaped like that pair's own prints; amounts and hours are the printed ones.
 */
import { describe, expect, it } from "vitest";
import { explainLaborDifference, guideName, makeFromVehicleText, type RationaleContext, type RationaleLine } from "../laborRationale";
import { argueItems, type MatcherPair } from "../appraisalSummary/argueItems";
import { lintSummaryText, type LintContext } from "../appraisalSummary/summaryGuards";
import { canonicalOperationKey } from "../operationAliases";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";

const L = (line: number, oper: string, desc: string, hours = 0, paintHours = 0, price = 0, extra: Partial<RationaleLine> = {}): RationaleLine => ({
  line,
  oper,
  desc,
  hours,
  paintHours,
  price,
  ...extra,
});

const SHOP: RationaleLine[] = [
  L(15, "Blnd", "RT Fender w/wheel opening molding w/o snorkel intake", 0, 2.2),
  L(34, "Rpr", "Battery 530 CCA", 0.3),
  L(37, "Blnd", "RT Hinge pillar", 0, 2.0),
  L(38, "Blnd", "RT Ctr plr & rocker", 0, 2.2),
  L(44, "R&I", "R&I headliner", 3.1),
  L(54, "Rpr", "RT Outer panel", 3.0, 2.4),
  L(55, "R&I", "RT Lwr pillar trim", 0.3),
  L(69, "Rpr", "RT Door shell", 4.0, 2.1),
  L(87, "", "Feather/Prime/Block", 0, 0.5, 0, { manual: true }),
  L(94, "R&I", "RT R&I door assy", 0.9),
  L(135, "Blnd", "Tail gate", 0, 2.2),
  L(150, "Rpr", "RT Bedside outer panel", 2.5, 2.0),
  L(155, "", "Feather/Prime/Block", 0, 2.0, 0, { manual: true }),
  L(168, "Subl", "Pre-repair scan +34%", 0, 0, 201),
  L(169, "", "REVVAdas Report", 0.5, 0, 25, { manual: true }),
  L(170, "Subl", "In-proc repair scan +34%", 0, 0, 167.5, { manual: true }),
  L(171, "Subl", "Millimeter Wave Radar static calibration +34%", 0, 0, 469, { manual: true }),
  L(172, "Subl", "Steering angle sensor calibration +34%", 0, 0, 147.4),
  L(174, "Subl", "Power window initialization +34%", 0, 0, 90.45, { manual: true }),
  L(182, "", "Mask jambs (0.3 Hours and $3.00 per panel)", 1.5, 0, 15, { manual: true }),
  L(184, "", "Finish sand & polish (0.5 Refinish per panel)", 0, 2.5, 0, { manual: true }),
];

const CARRIER: RationaleLine[] = [
  L(32, "Blnd", "RT Hinge pillar", 0, 1.0),
  L(33, "Blnd", "RT Ctr plr & rocker", 0, 1.1),
  L(35, "Rpr", "RT Side panel", 4.0, 2.0),
  L(54, "Rpr", "RT Outer panel", 3.0, 2.4),
  L(66, "R&I", "RT Door", 0.9),
  L(134, "Subl", "Pre-repair scan +25%", 0, 0, 156.25),
  L(135, "Subl", "Post-repair scan +25%", 0, 0, 187.5),
  L(136, "Subl", "Calibrate front radar sensor", 0, 0, 390),
  L(137, "Subl", "Calibrate steering angle sensor", 0, 0, 125),
  L(145, "", "Mask jambs", 0.3, 0, 5),
];

const at = (sheet: RationaleLine[], n: number) => sheet.find((l) => l.line === n)!;

function explain(ours: number, theirs: number | null, overrides: Partial<RationaleContext> = {}) {
  return explainLaborDifference({
    higher: [at(SHOP, ours)],
    lower: theirs === null ? null : at(CARRIER, theirs),
    higherSheet: SHOP,
    lowerSheet: CARRIER,
    higherPlatform: "ccc",
    lowerPlatform: "ccc",
    vehicle: "2021 TOYO Tacoma TRD Off-Road 4x4",
    voice: "dispute",
    ...overrides,
  });
}

describe("refinish: the step between body work and paint", () => {
  it("feather/prime/block is tied to the repair line above it and to the platform's guide", () => {
    const r = explain(155, null)!;
    expect(r.key).toBe("feather_prime_block");
    expect(r.why).toContain("our L150 (Rpr RT Bedside outer panel, 2.5 hr)");
    expect(r.why).toContain("listed outside refinish time in CCC/MOTOR Guide to Estimating (GTE)");
    expect(r.settledBy).toMatch(/not included in refinish time/);
  });

  it("their own repair of the same panel is quoted as the concession", () => {
    const shop = [...SHOP, L(56, "", "Feather/Prime/Block", 0, 1.0)];
    const r = explainLaborDifference({
      higher: [at(shop, 56)],
      lower: null,
      higherSheet: shop,
      lowerSheet: CARRIER,
      higherPlatform: "ccc",
      voice: "dispute",
    })!;
    expect(r.why).toContain("our L54 (Rpr RT Outer panel, 3.0 hr)");
    expect(r.why).toContain("their L54 repairs the same panel (3.0 hr), so the two sheets agree the panel takes body work");
  });

  it("a Mitchell estimate is answered from the Mitchell P-pages, never the CCC guide", () => {
    const r = explain(155, null, { higherPlatform: "mitchell" })!;
    expect(r.why).toContain("Mitchell Collision Estimating Guide P-Pages (CEG)");
    expect(r.why).not.toContain("CCC/MOTOR");
  });

  it("masking and finish sand are counted per panel from the line's own wording", () => {
    const mask = explain(182, 145)!;
    expect(mask.key).toBe("masking");
    expect(mask.why).toContain("Ours is 0.3 hr per panel across 5 panels (1.5 hr); theirs pays 0.3 hr, which covers 1 at that rate.");
    const polish = explain(184, null)!;
    expect(polish.key).toBe("finish_sand_polish");
    expect(polish.why).toContain("0.5 hr per refinished panel across 5 panels");
  });
});

describe("blend: the opinion cuts both ways", () => {
  it("their blend at exactly half of ours is the removed 50% formula; full-time blend is supported (SCRS Blend Study)", () => {
    const r = explain(38, 33)!;
    expect(r.key).toBe("blend");
    expect(r.why).toContain("Both sheets blend this panel, so the need is agreed.");
    expect(r.why).toContain("Theirs pays exactly half of ours (1.1 hr against 2.2 hr): the 50% formula");
    expect(r.why).toContain("The CCC/MOTOR Guide to Estimating removed its blend formula in October 2023");
    expect(r.why).toContain("31.59% more time on average than a full refinish");
    expect(r.why).toContain("Blend time at the panel's full refinish time is therefore supported");
    expect(r.why).not.toMatch(/challenged|weak/i);
    expect(r.settledBy).toMatch(/^An on-the-spot evaluation of the panel at the vehicle/);
  });

  it("a Mitchell estimate gets Mitchell's own blend premise", () => {
    const r = explain(38, 33, { lowerPlatform: "mitchell", higherPlatform: "mitchell" })!;
    expect(r.why).toContain("Mitchell Cloud Estimating (from February 2024) lets the estimate profile set the blend calculation");
    expect(r.why).not.toContain("CCC/MOTOR");
  });

  it("a blend with no counterpart names the panels they refinish beside it", () => {
    const r = explain(135, null)!;
    expect(r.why).toContain("Their L54 refinishes RT Outer panel beside this panel and blends nothing into it.");
  });

  it("a panel they refinish in full is not a missing blend", () => {
    const carrier = [...CARRIER, L(99, "Refn", "Tail gate", 0, 2.6)];
    const r = explainLaborDifference({
      higher: [at(SHOP, 135)],
      lower: null,
      higherSheet: SHOP,
      lowerSheet: carrier,
      voice: "dispute",
    })!;
    expect(r.why).toContain("Their L99 (Refn Tail gate, 2.6 hr refinish) paints this panel in full");
  });
});

describe("scans, calibrations and initializations", () => {
  it("a sublet priced differently is split into markup and invoice", () => {
    const r = explain(168, 134)!;
    expect(r.key).toBe("sublet_price");
    expect(r.why).toContain("The markups differ (+34% against +25%), and the base charge differs too: $150.00 against $125.00 before markup.");
  });

  it("when our charge before markup is below theirs, the markup is the whole dispute", () => {
    const r = explain(172, 137)!;
    expect(r.why).toContain("before markup ours is $110.00, below their $125.00: the dispute is the markup alone.");
  });

  it("the in-process scan is argued from the calibrations and scans their own sheet pays", () => {
    const r = explain(170, null)!;
    expect(r.key).toBe("scan");
    expect(r.why).toContain("Their sheet pays the calibrations (L136, L137) this scan exists to prepare for");
    expect(r.why).toContain("pre- and post-repair scans (L134, L135) bracket the repair but not the calibration step");
    expect(r.settledBy).toContain("Toyota's position statement on pre- and post-repair scanning");
  });

  it("a make with no known scanning statement is never given one", () => {
    const r = explain(170, null, { vehicle: "2021 ZZZZ Roadster" })!;
    expect(r.settledBy).toContain("vehicle maker's position statement on pre- and post-repair scanning, where it publishes one");
  });

  it("the same calibration in other words on their sheet is agreement on scope, a dispute on price", () => {
    const r = explain(171, null)!;
    expect(r.key).toBe("calibration");
    expect(r.why).toContain('Their L136 ("Calibrate front radar sensor", $390.00) is the same calibration written in other words');
    expect(r.why).toContain("price ($469.00 against $390.00), not scope");
  });

  it("the window initialization is tied to the battery and door R&I that trigger it, on both sheets", () => {
    const r = explain(174, null)!;
    expect(r.key).toBe("initialization");
    expect(r.why).toContain("our L34, L94 (Battery 530 CCA; RT R&I door assy)");
    expect(r.why).toContain("Their sheet writes the same trigger (L66: R&I RT Door) without the step that follows it.");
  });

  it("ADAS research is argued as research, not as a calibration", () => {
    expect(explain(169, null)!.key).toBe("adas_research");
  });
});

describe("access R&I and damage scope", () => {
  it("an R&I is argued from their own repair of the panel it opens up", () => {
    const r = explain(44, null)!;
    expect(r.key).toBe("access_r_and_i");
    expect(r.why).toContain("Their L35 (Rpr RT Side panel, 6.0 hr) pays the work this R&I gives access to.");
    expect(r.why).toContain("A repair or refinish time includes no R&I");
  });

  it("when the panel it serves is REPLACED there, inclusion is a guide question to check first", () => {
    const carrier = CARRIER.map((l) => (l.line === 35 ? { ...l, oper: "Repl" } : l));
    const r = explainLaborDifference({ higher: [at(SHOP, 55)], lower: null, higherSheet: SHOP, lowerSheet: carrier, higherPlatform: "ccc", voice: "dispute" })!;
    expect(r.why).toContain("Whether that replacement time already includes this R&I is a question for the included-operations list");
    expect(r.why).not.toContain("A repair or refinish time includes no R&I");
  });

  it("a repair with no counterpart is a damage question, and a similar panel on their sheet is raised before it is argued", () => {
    const carrier = [...CARRIER, L(70, "Rpr", "RT Rear door shell", 2.0, 1.5)];
    const r = explainLaborDifference({ higher: [at(SHOP, 69)], lower: null, higherSheet: SHOP, lowerSheet: carrier, voice: "dispute" })!;
    expect(r.key).toBe("damage_scope");
    expect(r.why).toContain("no line on their sheet repairs the RT Door shell under that name, unless their L70 (Rpr RT Rear door shell) is the same panel written differently");
  });
});

describe("voice and guardrails", () => {
  const every = () =>
    SHOP.flatMap((line) =>
      (["dispute", "forensic"] as const).map((voice) =>
        explainLaborDifference({ higher: [line], lower: null, higherSheet: SHOP, lowerSheet: CARRIER, higherPlatform: "ccc", vehicle: "2021 TOYO Tacoma", voice })
      )
    ).filter((r): r is NonNullable<typeof r> => Boolean(r));

  it("the forensic voice never speaks as the shop", () => {
    const forensic = SHOP.map((line) =>
      explainLaborDifference({ higher: [line], lower: null, higherSheet: SHOP, lowerSheet: CARRIER, voice: "forensic" })
    ).filter(Boolean);
    expect(forensic.length).toBeGreaterThan(10);
    for (const r of forensic) expect(`${r!.why} ${r!.settledBy}`).not.toMatch(/\b(our|ours|their|theirs|we|they)\b/i);
  });

  it("no rationale prints a guide address, a finding number or a part-type claim the dispute lint would refuse", () => {
    const ctx = {
      ledger: { rate: { settledByAdjustment: false }, nonLaborNet: 0 },
      partType: { claimAllowed: false },
      hasDealerCalibrationSublet: false,
    } as unknown as LintContext;
    const all = every();
    expect(all.length).toBeGreaterThan(20);
    for (const r of all) {
      const text = `${r.why} ${r.settledBy}`;
      expect(text).not.toMatch(/https?:|www\.|\.com\b/i);
      expect(lintSummaryText(r.why, ctx)).toEqual([]);
      expect(lintSummaryText(r.settledBy, ctx)).toEqual([]);
    }
  });

  it("reads makes as CCC prints them and names the guide by platform", () => {
    expect(makeFromVehicleText("2021 TOYO Tacoma TRD")).toBe("toyota");
    expect(makeFromVehicleText("2024 HYUN Kona SE AWD")).toBe("hyundai");
    expect(makeFromVehicleText("")).toBeNull();
    expect(guideName("ccc")).toBe("CCC/MOTOR Guide to Estimating (GTE)");
    expect(guideName(null)).toContain("Mitchell CEG P-pages for Mitchell");
  });

  it("the two radar wordings on RO 22319 are one operation to the matcher", () => {
    expect(canonicalOperationKey("Millimeter Wave Radar static calibration +34%")).toBe("FRONT_RADAR_CALIBRATION");
    expect(canonicalOperationKey("Calibrate front radar sensor")).toBe("FRONT_RADAR_CALIBRATION");
  });
});

describe("the Appraisal Dispute Report carries the case on each NEEDS PROOF item", () => {
  const estimate = (role: "shop" | "carrier", lines: EstimateLine[]): Estimate => ({
    role,
    fileName: role === "shop" ? "Shop final.pdf" : "SOR-2.pdf",
    vehicle: "2021 TOYO Tacoma TRD Off-Road 4x4",
    platform: "ccc",
    totals: {
      parts: 0,
      misc: 0,
      labor: [
        { cat: "body", label: "Body Labor", hours: 10, rate: 75, cost: 750 },
        { cat: "paint", label: "Paint Labor", hours: 10, rate: 75, cost: 750 },
      ],
      paintSupplies: { hours: 0, rate: 0, cost: 0 },
      subtotal: 0,
      tax: 0,
      grandTotal: 0,
    },
    lines,
  });
  const shopLines: EstimateLine[] = [
    { line: 150, oper: "Rpr", desc: "RT Bedside outer panel", hours: 2.5, paintHours: 2.0, laborCat: "body" },
    { line: 155, oper: "", desc: "Feather/Prime/Block", paintHours: 2.0, manual: true },
    { line: 38, oper: "Blnd", desc: "RT Ctr plr & rocker", paintHours: 2.2 },
  ];
  const carrierLines: EstimateLine[] = [
    { line: 120, oper: "Rpr", desc: "RT Bedside outer panel", hours: 2.5, paintHours: 2.0, laborCat: "body" },
    { line: 33, oper: "Blnd", desc: "RT Ctr plr & rocker", paintHours: 1.1 },
  ];
  const pairs: MatcherPair[] = [
    { kind: "matched", shopLines: [150], carrierLine: 120 },
    { kind: "missing", shopLines: [155] },
    { kind: "reduced", shopLines: [38], carrierLine: 33 },
  ];
  const items = argueItems({
    shop: estimate("shop", shopLines),
    carrier: estimate("carrier", carrierLines),
    groups: [],
    usedShop: new Set(),
    flags: [],
    pairs,
  });

  it("keeps the printed detail and adds the argument beside it", () => {
    const fpb = items.find((i) => i.shopLines.includes(155))!;
    expect(fpb.detail).toBe("No counterpart on their sheet (L155, 2.0 hr).");
    expect(fpb.rationale?.key).toBe("feather_prime_block");
    expect(fpb.rationale?.why).toContain("their L120 repairs the same panel (2.5 hr)");
    const blend = items.find((i) => i.shopLines.includes(38))!;
    expect(blend.rationale?.why).toContain("exactly half of ours");
  });
});

describe("RO 22319 on its own prints: names differ, sections decide", () => {
  // The SOR prints "Rpr RT Outer panel" under FRONT DOOR and REAR DOOR; the
  // shop prints "Rpr RT Door shell" in the same two sections.
  const shop: RationaleLine[] = [
    L(69, "Rpr", "RT Door shell", 4.0, 2.1, 0, { section: "FRONT DOOR" }),
    L(91, "Rpr", "RT Door shell", 5.0, 2.2, 0, { section: "REAR DOOR" }),
    L(109, "Algn", "RT Striker", 0.2, 0, 0, { section: "REAR DOOR" }),
    L(135, "Blnd", "Tail gate", 0, 2.2, 0, { section: "TAIL GATE" }),
  ];
  const carrier: RationaleLine[] = [
    L(54, "Rpr", "RT Outer panel", 4.0, 2.1, 0, { section: "FRONT DOOR" }),
    L(73, "Rpr", "RT Outer panel", 7.0, 2.2, 0, { section: "REAR DOOR" }),
    L(90, "R&I", "RT Striker", 0.2, 0, 0, { section: "REAR DOOR" }),
    L(99, "Rpr", "RT Side panel w/flares", 6.0, 3.0, 0, { section: "PICK UP BOX" }),
    L(101, "", "Add for Clear Coat", 0, 0.8, 0, { section: "PICK UP BOX" }),
    L(119, "Repl", "A/M RT Wheel opng mldg", 0.3, 1.2, 156.91, { section: "PICK UP BOX" }),
  ];
  const run = (line: number) =>
    explainLaborDifference({ higher: [at(shop, line)], lower: null, higherSheet: shop, lowerSheet: carrier, voice: "dispute" })!;

  it("a door shell is their outer panel in the same door section, never missing work", () => {
    expect(run(69).why).toContain("This line is not missing from their sheet. Their L54 (Rpr RT Outer panel) is the only Rpr line on that side under FRONT DOOR");
    expect(run(69).why).toContain("Both sheets write 4.0 hr body, 2.1 hr refinish; there is no difference to argue");
    expect(run(91).why).toContain("Theirs writes more (7.0 hr body, 2.2 hr refinish against 5.0 hr body, 2.2 hr refinish); this panel is not one to argue.");
  });

  it("an outer panel under a door section is a door, so it is not the panel beside the tailgate", () => {
    const why = run(135).why;
    expect(why).toContain("Their L99 refinishes RT Side panel w/flares (pick up box) beside this panel");
    expect(why).not.toMatch(/L54|L73|Clear Coat|Wheel opng/);
  });

  it("the same part under another operation is raised before the argument", () => {
    expect(run(109).why).toMatch(/^Check first: their L90 \(R&I RT Striker\) names the same part under a different operation/);
  });
});

describe("a blend of the same panel the matcher left unpaired", () => {
  it("is read as their blend at half, not as a blend they left out (RO 22319 fender)", () => {
    const shop = [L(15, "Blnd", "RT Fender w/wheel opening molding w/o snorkel intake", 0, 2.2)];
    const carrier = [L(11, "Blnd", "RT Fender w/o wheel opening molding", 0, 1.1)];
    const r = explainLaborDifference({ higher: shop, lower: null, higherSheet: shop, lowerSheet: carrier, voice: "dispute" })!;
    expect(r.why).toContain("Both sheets blend this panel, so the need is agreed.");
    expect(r.why).toContain("pays exactly half of ours (1.1 hr against 2.2 hr)");
  });
});

/**
 * The forensic voice is shared with the vehicle owner's insurer (Forensic
 * Estimate Analysis and the citation density pack), so it documents rather
 * than argues. The dispute voice (appraisal dispute and customer reports)
 * keeps its opinion. Owner's direction, 2026-10-09.
 */
describe("forensic voice is neutral; dispute voice keeps its opinion", () => {
  const ADVOCACY = /\b(dispute|argue|therefore supported|ask the carrier|pays|leaves out|theirs|ours|their|our)\b/i;
  const neutral = (ours: number, theirs: number | null, overrides: Partial<RationaleContext> = {}) =>
    explain(ours, theirs, { voice: "forensic", ...overrides })!;

  const cases: Array<[string, number, number | null]> = [
    ["sublet markup", 172, 137],
    ["in-process scan", 170, null],
    ["window initialization", 174, null],
    ["blend at half", 38, 33],
    ["blend with no counterpart", 135, null],
    ["masking per panel", 182, 145],
    ["access R&I", 44, null],
    ["feather/prime/block", 155, null],
  ];
  for (const [name, ours, theirs] of cases) {
    it(`${name}: no advocacy wording in the forensic voice`, () => {
      const r = neutral(ours, theirs);
      expect(r.why).not.toMatch(ADVOCACY);
      expect(r.settledBy).not.toMatch(ADVOCACY);
    });
  }

  it("the sublet markup is a difference, and the carrier is not asked to justify anything", () => {
    const r = neutral(172, 137);
    expect(r.why).toContain("the difference is the markup alone.");
    expect(r.settledBy).toContain("Each estimate's markup is its sublet handling allowance");
  });

  it("the blend states the references and where blend time is determined, without a verdict", () => {
    const r = neutral(38, 33);
    expect(r.why).toContain("Both estimates blend this panel.");
    expect(r.why).toContain("The comparison estimate includes exactly half of the higher estimate's time (1.1 hr against 2.2 hr), consistent with a 50% formula");
    expect(r.why).toContain("31.59% more time on average than a full refinish");
    expect(r.why).toContain("blend time is determined by an evaluation at the vehicle rather than by a fixed percentage");
  });

  it("the window initialization on both estimates is described as agreed scope", () => {
    const carrier = [...CARRIER, L(139, "Rpr", "Power Window Reset", 0.3)];
    const r = explain(174, null, { voice: "forensic", lowerSheet: carrier })!;
    expect(r.why).toContain("Both estimates include the window initialization, so both treat the procedure as required.");
    expect(r.why).not.toMatch(/dispute/i);
  });

  it("the dispute voice is unchanged", () => {
    expect(explain(172, 137)!.why).toContain("the dispute is the markup alone.");
    expect(explain(38, 33)!.why).toContain("Blend time at the panel's full refinish time is therefore supported");
    expect(explain(170, null)!.why).toContain("this scan exists to prepare for");
  });
});

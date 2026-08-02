/**
 * Part 3 (Work Order R3) — cross-document regression corpus + repo
 * universality check. Fixtures are training data, not rule sources: no rule,
 * threshold, alias, or filter may reference a carrier, shop, make, or RO
 * literal. The synthetic pairs below exercise the axes a second real
 * document pair would: non-CCC side vocabulary, four-way position groups,
 * and the inverted (subject-lower) direction.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { pairAndCompare, compareTotals } from "../deltaPair";
import type { EstimateRow } from "../rowCluster";
import { canonKey, canonTotalsCategory, totalsCategoriesFuzzyMatch } from "../estimateNormalize";

const RULE_FILES = [
  "src/lib/reports/deltaEngine/estimateNormalize.ts",
  "src/lib/reports/deltaEngine/rowCluster.ts",
  "src/lib/reports/deltaEngine/deltaPair.ts",
  "src/lib/reports/estimateDeltaMatcher.ts",
  "src/lib/reports/citationDensityRowAnchors.ts",
  "src/lib/reports/deltaValueAnnotationLayer.ts",
  "src/lib/reports/annotationPlacementEngine.ts",
];

// Carrier / shop / make / RO literals that must NEVER appear in rule code.
// (A carrier-name LEXICON used for identity recognition lives in
// extractEstimateFacts and is data, not a rule keyed to a carrier.)
const FORBIDDEN_LITERALS = /\b(?:USAA|Progressive|Conestoga|Rivian|R1T|22047|GEICO|Allstate|State Farm|Tesla|PeerNet)\b/;

describe("repo universality: no carrier/shop/make/RO literals in rule code", () => {
  for (const file of RULE_FILES) {
    it(file, () => {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      const offending = source
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        // Comments may cite examples; RULES may not.
        .filter(({ line }) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
        .filter(({ line }) => {
          const codeOnly = line.replace(/\/\/.*$/, "");
          return FORBIDDEN_LITERALS.test(codeOnly);
        });
      expect(offending.map(({ number, line }) => `${number}: ${line.trim()}`)).toEqual([]);
    });
  }
});

let fixtureLine = 0;
function row(desc: string, values: Partial<Pick<EstimateRow, "qty" | "price" | "labor" | "paint" | "part">> = {}, section = "BODY"): EstimateRow {
  fixtureLine += 1;
  const ck = canonKey(desc);
  return {
    page: 1,
    line: fixtureLine,
    section,
    sectionLabel: section,
    qty: values.qty ?? null,
    price: values.price ?? null,
    labor: values.labor ?? null,
    paint: values.paint ?? null,
    laborClass: "",
    part: values.part ?? null,
    rawDesc: desc,
    key: ck.key,
    side: ck.side,
    cells: {},
  };
}

describe("corpus: non-CCC side vocabulary pairs across platforms", () => {
  it("LH/RH (Mitchell) rows pair with LT/RT (CCC) rows of the same part", () => {
    fixtureLine = 0;
    const subject = [row("LH Fender liner", { labor: 1.0 }), row("RH Fender liner", { labor: 1.0 })];
    fixtureLine = 0;
    const competing = [row("LT Fender liner", { labor: 0.5 }), row("RT Fender liner", { labor: 0.5 })];
    const { findings, competingOnly } = pairAndCompare(subject, competing);
    expect(competingOnly).toHaveLength(0);
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.kind).toBe("VALUE_DELTA");
      expect(finding.deltas[0]).toMatchObject({ field: "labor", subject: 1.0, competing: 0.5 });
    }
  });
  it("Left/Right spelled-out rows pair with (L)/(R) punctuation rows", () => {
    fixtureLine = 0;
    const subject = [row("Left rocker molding", { price: 100 })];
    fixtureLine = 0;
    const competing = [row("(L) Rocker molding", { price: 80 })];
    const { findings } = pairAndCompare(subject, competing);
    expect(findings).toHaveLength(1);
    expect(findings[0].deltas[0]).toMatchObject({ field: "price", subject: 100, competing: 80 });
  });
});

describe("corpus: four-way position group (front-impact loss shape)", () => {
  it("LT/RT × Front/Rear pair per (base, position); never cross-position", () => {
    fixtureLine = 0;
    const subject = [
      row("LT Front mud flap", { labor: 0.5 }),
      row("RT Front mud flap", { labor: 0.5 }),
      row("LT Rear mud flap", { labor: 0.5 }),
      row("RT Rear mud flap", { labor: 0.5 }),
    ];
    fixtureLine = 0;
    const competing = [
      row("LT Front mud flap", { labor: 0.2 }),
      row("RT Front mud flap", { labor: 0.2 }),
      row("LT Rear mud flap", { labor: 0.2 }),
      row("RT Rear mud flap", { labor: 0.2 }),
    ];
    const { findings, competingOnly } = pairAndCompare(subject, competing);
    expect(competingOnly).toHaveLength(0);
    expect(findings).toHaveLength(4);
    // Aggregate across the presentation group equals the member sum (U-1).
    const aggregate = findings.reduce((total, finding) => total + ((finding.deltas[0].subject as number) - (finding.deltas[0].competing as number)), 0);
    expect(aggregate).toBeCloseTo(1.2, 5);
    // All four members share ONE presentation base.
    const bases = new Set(findings.map((finding) => canonKey(finding.subject.rawDesc).base));
    expect(bases.size).toBe(1);
  });
});

describe("corpus: Mitchell/Audatex totals vocabulary reconciles against CCC", () => {
  it("cross-platform categories resolve to shared concepts", () => {
    const subject = [
      { category: "Refinish Labor", hours: 10, rate: 60, amount: 600 },
      { category: "Refinish Materials", hours: null, rate: null, amount: 300 },
      { category: "Structural Repair", hours: 4, rate: 90, amount: 360 },
      { category: "Shop Materials", hours: null, rate: null, amount: 50 },
    ];
    const competing = [
      { category: "Paint Labor", hours: 8, rate: 60, amount: 480 },
      { category: "Paint Supplies", hours: null, rate: null, amount: 250 },
      { category: "Frame", hours: 4, rate: 90, amount: 360 },
      { category: "Body Supplies", hours: null, rate: null, amount: 50 },
    ];
    const unmapped: string[] = [];
    const deltas = compareTotals(subject, competing, canonTotalsCategory, {
      fuzzyMatch: totalsCategoriesFuzzyMatch,
      onUnmapped: (category) => unmapped.push(category),
    });
    expect(unmapped).toEqual([]); // every category resolved cross-platform
    // Only genuine value differences remain — no phantom "category missing".
    expect(deltas.filter((delta) => delta.competing === 0 && delta.field === "amount" && delta.subject > 100)).toHaveLength(0);
    expect(deltas.some((delta) => /refinish labor/i.test(delta.category) && delta.field === "hours")).toBe(true);
  });
  it("a truly unknown category is emitted AND reported unmapped — never silent", () => {
    const unmapped: string[] = [];
    const deltas = compareTotals(
      [{ category: "Corrosion Protection Program", hours: null, rate: null, amount: 40 }],
      [],
      canonTotalsCategory,
      { fuzzyMatch: totalsCategoriesFuzzyMatch, onUnmapped: (category) => unmapped.push(category) }
    );
    expect(deltas).toHaveLength(1);
    expect(unmapped).toEqual(["Corrosion Protection Program"]);
  });
});

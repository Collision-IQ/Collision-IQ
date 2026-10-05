import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstRowPerLine, planDeltaValueAnnotations } from "../deltaValueAnnotationLayer";
import { auditPlacements, type PlacementWord } from "../annotationPlacementEngine";
import { parseEstimateRows, parseTotalsFromWords, type Word } from "../deltaEngine/rowCluster";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/22047");
const measureText = (text: string, fontSize: number) => text.length * fontSize * 0.52;

function loadWords(name: string): Map<number, Word[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as Record<string, Word[]>;
  return new Map(Object.entries(raw).map(([page, words]) => [Number(page), words]));
}

function toPlacementWords(byPage: Map<number, Word[]>): PlacementWord[] {
  const out: PlacementWord[] = [];
  for (const [pageNumber, words] of byPage) {
    for (const word of words) {
      out.push({
        pageNumber,
        x: word.x0,
        y: word.top,
        width: word.x1 - word.x0,
        height: word.bottom - word.top,
        text: word.text,
      });
    }
  }
  return out;
}

describe("planDeltaValueAnnotations on the 22047 pair", () => {
  const shopWords = loadWords("shop_words.json");
  const usaaWords = loadWords("usaa_words.json");
  const subjectWords = toPlacementWords(shopWords);
  const pages = [...shopWords.keys()].map((pageNumber) => ({ pageNumber, pageWidth: 612, pageHeight: 792 }));
  const plan = planDeltaValueAnnotations({
    subjectWords,
    pages,
    competingRows: parseEstimateRows(usaaWords),
    competingTotals: parseTotalsFromWords(usaaWords),
    competingLabel: "EOR",
    measureText,
  });

  it("underlines matched prices and highlights differing cells", () => {
    expect(plan.underlines.length).toBeGreaterThanOrEqual(8);
    expect(plan.highlights.length).toBeGreaterThanOrEqual(10);
  });

  it("stamps competing values beside the ESTIMATE TOTALS cells (one per differing category)", () => {
    // 5 labor categories differ; the category with both an hour and a rate gap
    // gets one combined "<label> h @ $r/hr" stamp.
    expect(plan.stamps.length).toBe(5);
    expect(plan.stamps.filter((stamp) => stamp.text.includes("@") && stamp.text.includes("/hr")).length).toBe(1);
    for (const stamp of plan.stamps) expect(stamp.text.startsWith("EOR ")).toBe(true);
  });

  it("never stamps an unread basis as a zero one (R10)", () => {
    // A category whose competing hours/rate could not be read must not be
    // stamped "0.0 @ $0.00/hr" — a zero basis tells the shop the other side
    // pays nothing and points the negotiation at the wrong line. The branch is
    // still chosen by what DIFFERS; only the printed value is zero-suppressed.
    for (const stamp of plan.stamps) {
      expect(stamp.text).not.toMatch(/\$0\.00\/hr/);
      expect(stamp.text).not.toMatch(/0\.0 @/);
    }
  });

  it("places keyed notes for MISSED/shortfall/value findings and reports the reverse pass", () => {
    expect(plan.notes.length).toBeGreaterThanOrEqual(4);
    // Descriptive, not accusatory, and sourced from deltaRules.json — RO 22116
    // shipped "MISSED on AMERICAN FAMILY" 44 times, including on deductions the
    // shop itself took off and on operations the carrier bundles elsewhere.
    expect(plan.notes.some((note) => /not written on EOR/.test(note.request.text))).toBe(true);
    expect(plan.notes.every((note) => !/MISSED on/.test(note.request.text))).toBe(true);
    expect(plan.notes.some((note) => /On EOR only:/.test(note.request.text))).toBe(true);
    expect(plan.unplacedNotes).toEqual([]);
  });

  it("every planned rect audits at zero failures against the measured page words", () => {
    const placements = [
      ...plan.stamps.map((stamp, index) => ({ id: `stamp-${index}`, rect: stamp.rect })),
      ...plan.notes.map((note) => ({ id: note.request.id, rect: note.rect })),
    ];
    expect(auditPlacements(placements, subjectWords, pages)).toEqual([]);
  });

  it("never marks a cell without a measured bbox", () => {
    for (const rect of [...plan.underlines, ...plan.highlights]) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(pages.some((page) => page.pageNumber === rect.pageNumber)).toBe(true);
    }
  });
});

describe("an appendix table that lists estimate lines again is not read as estimate lines", () => {
  // RO 22120: a CCC shop print ends with a TIRE PARTS SUPPLIERS page (Line,
  // Description, Supplier, Price). Its rows carry the line numbers already
  // read on the estimate page, and the price printed at the right edge falls
  // in the paint column the grid carried over: the layer printed "Ln 33 …
  // (454.3 hr P): not written on the comparison estimate" for a $454.26 tire
  // already annotated at its own line. Same layout, synthetic page.
  const shopWords = loadWords("shop_words.json");
  const usaaWords = loadWords("usaa_words.json");
  const appendixPage = Math.max(...shopWords.keys()) + 1;
  const word = (text: string, x0: number, x1: number, top: number): Word => ({ text, x0, x1, top, bottom: top + 8 });
  const withAppendix = new Map(shopWords);
  withAppendix.set(appendixPage, [
    word("TIRE", 250, 270, 100),
    word("PARTS", 272, 298, 100),
    word("SUPPLIERS", 300, 345, 100),
    word("Line", 29, 46, 120),
    word("Description", 66, 110, 120),
    word("Supplier", 230, 265, 120),
    word("Price", 545, 566, 120),
    // Line 47 prints on the estimate as "Repl RT Upper panel … 163.58 0.3".
    word("47", 36, 45, 140),
    word("RT", 66, 76, 140),
    word("Upper", 78, 100, 140),
    word("panel", 102, 121, 140),
    word("$", 530, 535, 140),
    word("163.58", 540, 565, 140),
  ]);
  const subjectWords = toPlacementWords(withAppendix);
  const pages = [...withAppendix.keys()].map((pageNumber) => ({ pageNumber, pageWidth: 612, pageHeight: 792 }));
  const plan = planDeltaValueAnnotations({
    subjectWords,
    pages,
    competingRows: parseEstimateRows(usaaWords),
    competingTotals: parseTotalsFromWords(usaaWords),
    competingLabel: "EOR",
    measureText,
  });
  const pieces = plan.notes.flatMap((note) => note.request.text.split(" | "));

  it("states no price as hours and reports no line twice", () => {
    expect(pieces.filter((piece) => /163\.6 hr|163\.58 hr/.test(piece))).toEqual([]);
    expect(plan.findings.filter((finding) => finding.subject.page === appendixPage)).toEqual([]);
    const keyed = pieces.map((piece) => /^Ln (\d+)\b/.exec(piece)?.[1]).filter(Boolean);
    expect(keyed.length).toBe(new Set(keyed).size);
    expect(plan.highlights.filter((rect) => rect.pageNumber === appendixPage)).toEqual([]);
  });

  it("the estimate line itself is still compared where it prints", () => {
    // Its $163.58 matches the comparison: the price cell on page 3 keeps its underline.
    expect(plan.underlines.some((rect) => rect.pageNumber === 3 && Math.abs(rect.y + 1.5 - 331) < 1 && rect.x < 420)).toBe(true);
  });
});

describe("firstRowPerLine", () => {
  const row = (line: number, page: number) => ({ line, page }) as unknown as Parameters<typeof firstRowPerLine>[0][number];
  it("keeps the first row of each printed line number, and every row read without one", () => {
    const rows = [row(3, 1), row(0, 1), row(3, 4), row(0, 2), row(5, 2)];
    expect(firstRowPerLine(rows)).toEqual([rows[0], rows[1], rows[3], rows[4]]);
  });
});

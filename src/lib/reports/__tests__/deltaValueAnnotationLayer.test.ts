import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planDeltaValueAnnotations } from "../deltaValueAnnotationLayer";
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

/**
 * RO 21995 — the Delta Citation Density copy of the LOWER estimate.
 *
 * The citation document marks up the carrier's SOR-3 (the document a
 * supplement answers): our values stamped beside theirs, a numbered badge on
 * each carrier line worth raising, a findings index at the end. The findings
 * are the Appraisal Dispute Report's own units, so the two cannot disagree.
 *
 * The SOR-3 word layer (tests/fixtures/21995/sor3_words.json) is the measured
 * layer of the real print with identifying words removed; the rendered page
 * base is a blank PDF of the same page size, so every placement assertion is
 * against the measured words, which is what the placement rule checks.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { adaptForensicToPlainSummary } from "../plainLanguageSummaryAdapter";
import { buildPlainSummaryModel } from "../plainLanguageSummary";
import { buildLowerEstimateFindings, BADGE_MIN } from "../appraisalSummary/lowerEstimateFindings";
import { buildLowerEstimateCitationPdf } from "../lowerEstimateCitationDensity";
import type { PdfWord } from "../citationDensityRowAnchors";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/21995");
const delta = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "delta_rows.json"), "utf8"));
const words: PdfWord[] = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "sor3_words.json"), "utf8")).map(
  (w: Omit<PdfWord, "normalizedText">) => ({ ...w, normalizedText: w.text.toLowerCase() })
);

function model() {
  const adapted = adaptForensicToPlainSummary({
    reconciliation: delta.reconciliation,
    rows: { higher: delta.higher, lower: delta.lower, deltas: delta.deltas },
    higherDocumentName: "Shop final 21995.pdf",
    lowerDocumentName: "SOR-3 21995.pdf",
    higherText: readFileSync(path.join(FIXTURE_DIR, "shop_final_rows_text.txt"), "utf8"),
    lowerText: readFileSync(path.join(FIXTURE_DIR, "sor3_rows_text.txt"), "utf8"),
    vehicleLabel: "2026 Rivian R1S",
    roNumber: "21995",
    generatedAt: "2026-09-25T20:00:00.000Z",
  });
  if (!adapted.ok) throw new Error(adapted.reason);
  return { model: buildPlainSummaryModel(adapted.input), pairs: adapted.input.pairs };
}

/** A blank PDF with the SOR's page count and size, standing in for the print. */
async function blankLower(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pages = Math.max(...words.map((w) => w.pageNumber));
  for (let i = 0; i < pages; i += 1) doc.addPage([words[0].pageWidth, words[0].pageHeight]);
  return doc.save();
}

describe("the findings are the dispute report's units, on the carrier's lines", () => {
  const { model: m, pairs } = model();
  const set = buildLowerEstimateFindings(m, pairs);
  const at = (line: number) => set.findings.find((f) => f.carrierLine === line)!;

  it("badges run in carrier-line order and every finding says something", () => {
    const badged = set.findings.filter((f) => f.number > 0);
    expect(badged.map((f) => f.number)).toEqual(badged.map((_, i) => i + 1));
    expect(badged.map((f) => f.carrierLine)).toEqual([...badged.map((f) => f.carrierLine)].sort((a, b) => a - b));
    expect(set.findings.every((f) => f.entries.length > 0)).toBe(true);
  });

  it("a badge is earned by a check or by money", () => {
    for (const f of set.findings) {
      const weight = f.entries.reduce((sum, e) => sum + Math.abs(e.amount ?? 0), 0);
      const earned = f.entries.some((e) => e.kind === "check") || weight >= BADGE_MIN;
      expect(f.number > 0).toBe(earned);
    }
  });

  it("stamps our value beside theirs on the lines the dispute is about", () => {
    expect(at(2).stamps).toContainEqual({ field: "labor", value: "4.3" }); // O/H bumper vs R&I 1.6
    expect(at(61).stamps).toContainEqual({ field: "labor", value: "1.0 M" }); // oil pump labor they do not pay
    expect(at(57).stamps).toContainEqual({ field: "price", value: "175.00" }); // forklift they left unpriced
    expect(at(22).stamps).toContainEqual({ field: "labor", value: "1.3 Body" }); // their mechanical coding pays more
  });

  it("carries the carrier's own checks on their lines", () => {
    expect(at(169).entries[0]).toMatchObject({ kind: "check" });
    expect(at(169).entries.some((e) => e.kind === "over" && e.amount === -1980)).toBe(true);
    expect(at(98).entries[0].text).toMatch(/quad-motor.*dual motor/);
    expect(at(57).entries[0].text).toMatch(/Ask them to price it/);
  });

  it("our work with no line on theirs sits where a reader of theirs would look", () => {
    // Tires sit beside the wheels they pay; procedure research beside the bumper.
    const tires = set.findings.find((f) => f.entries.some((e) => /Pirelli/.test(e.text)))!;
    expect([75, 76, 77, 78]).toContain(tires.carrierLine);
    const pre = set.findings.find((f) => f.entries.some((e) => /Pre wash/.test(e.text)))!;
    expect(pre.carrierLine).toBeGreaterThan(150);
    expect(set.unanchored.map((e) => e.text)).toEqual([expect.stringMatching(/^Paint materials/)]);
  });

  it("every dollar of the gross view is on the page or in the index", () => {
    const placed = [...set.findings.flatMap((f) => f.entries), ...set.unanchored].reduce((sum, e) => sum + (e.amount ?? 0), 0);
    expect(Math.round((placed + m.ledger.tax) * 100) / 100).toBe(2712.8);
  });
});

describe("the rendered copy places every mark on measured, empty space", async () => {
  const { model: m, pairs } = model();
  const set = buildLowerEstimateFindings(m, pairs);
  const base = await blankLower();
  const result = await buildLowerEstimateCitationPdf({
    lowerPdfBytes: base,
    words,
    set,
    model: m,
    lowerName: "SOR-3 21995.pdf",
    higherName: "Shop final 21995.pdf",
    redactionScope: "natural_person",
    redact: false,
  });

  it("draws every badge, and anything it could not place is named", () => {
    expect(result.badges).toBe(set.findings.filter((f) => f.number > 0).length);
    expect(result.stamps).toBeGreaterThanOrEqual(30);
    expect(result.unplaced.length).toBeLessThanOrEqual(2);
    for (const lost of result.unplaced) expect(lost).toMatch(/^Ln \d+: /);
  });

  it("appends the findings index after the estimate's own pages", async () => {
    const doc = await PDFDocument.load(result.bytes);
    const originalPages = Math.max(...words.map((w) => w.pageNumber));
    expect(doc.getPageCount()).toBeGreaterThan(originalPages);
    expect(result.pageCount).toBe(doc.getPageCount());
  });

  it("stamps our totals beside theirs on every category that differs", () => {
    // Body, paint, mechanical, frame-vs-our-aluminum, and paint supplies.
    expect(result.totalsStamps).toBe(5);
  });

  it("audit: no badge, stamp or note touches a measured word or another mark, and all sit on the page", () => {
    const pad = 1;
    const hit = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x - pad < b.x + b.width && a.x + a.width + pad > b.x && a.y - pad < b.y + b.height && a.y + a.height + pad > b.y;
    const marks = result.placements.filter((p) => p.kind !== "highlight");
    expect(marks.length).toBeGreaterThan(40);
    for (const mark of marks) {
      const { rect } = mark;
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.y).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThan(words[0].pageWidth);
      expect(rect.y + rect.height).toBeLessThan(words[0].pageHeight);
      const onPage = words.filter((w) => w.pageNumber === rect.pageNumber);
      expect(onPage.filter((w) => hit(rect, w)).map((w) => w.text)).toEqual([]);
      const others = marks.filter((o) => o !== mark && o.rect.pageNumber === rect.pageNumber);
      expect(others.some((o) => hit(rect, o.rect))).toBe(false);
    }
  });

  it("every highlight sits on a measured value word", () => {
    for (const { rect } of result.placements.filter((p) => p.kind === "highlight")) {
      const under = words.filter(
        (w) => w.pageNumber === rect.pageNumber && w.x >= rect.x - 0.5 && w.x + w.width <= rect.x + rect.width + 0.5 && w.y >= rect.y - 0.5
      );
      expect(under.length).toBeGreaterThan(0);
    }
  });
});

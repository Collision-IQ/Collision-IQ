import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runForensicSingle } from "@/lib/reports/forensicSingle/engine";
import { planReports } from "@/lib/reports/forensicSingle/reportPlan";
import { buildNormalizedEstimate, buildNormalizedEstimateFromText } from "@/lib/reports/forensicSingle/fromEstimateText";
import { renderForensicSingleReportPdf } from "@/lib/reports/forensicSingle/renderer";
import type { NormalizedEstimate } from "@/lib/reports/forensicSingle/types";
import type { PdfWord } from "@/lib/reports/citationDensityRowAnchors";

const fixturePath = (...parts: string[]) => path.join(process.cwd(), ...parts);

/** The hand-normalized single-estimate fixture the engine was proven against. */
const loadFixture = (): NormalizedEstimate =>
  JSON.parse(
    readFileSync(fixturePath("src/lib/reports/forensicSingle/__tests__/fixture-single-estimate.json"), "utf8")
  ) as NormalizedEstimate;

/** A real CCC ONE print: flattened text plus its measured word layer. */
const loadCccSample = () => {
  const text = readFileSync(fixturePath("tests/fixtures/ccc-1259209948-text.txt"), "utf8");
  const raw = JSON.parse(readFileSync(fixturePath("tests/fixtures/ccc-1259209948-words.json"), "utf8")) as Array<{
    p: number;
    x: number;
    y: number;
    w: number;
    t: string;
  }>;
  const words: PdfWord[] = raw.map((word) => ({
    pageNumber: word.p,
    text: word.t,
    normalizedText: word.t,
    x: word.x,
    y: word.y,
    width: word.w,
    height: 8,
    pageWidth: 612,
    pageHeight: 792,
  }));
  return { text, words };
};

describe("forensic-single engine (hand-normalized fixture)", () => {
  it("reconciles to $0.00 unexplained and books the ambiguous misc line as body labor", () => {
    const report = runForensicSingle(loadFixture());
    expect(report.reconciliation.unexplained).toBe(0);
    expect(report.reconciliation.notes.some((note) => /Denib/.test(note))).toBe(true);
    expect(report.reconciliation.clearCoatCheck?.every((line) => line.includes("correct"))).toBe(true);
  });

  it("fires the rule set of the hand-built review and nothing else", () => {
    const report = runForensicSingle(loadFixture());
    const ids = report.findings.map((finding) => finding.ruleId).sort();
    expect(ids).toEqual(
      ["DB-001", "GR-001", "HD-001", "HY-001", "MC-001", "NI-001", "RF-001", "RR-001", "RS-001", "ST-001", "TX-001", "UF-001"].sort()
    );
  });

  it("ranks the repair-vs-replace finding first and holds release", () => {
    const report = runForensicSingle(loadFixture());
    expect(report.findings[0].ruleId).toBe("RR-001");
    expect(report.findings[0].severity).toBe("CRITICAL");
    expect(report.verdict.holdRelease).toBe(true);
  });

  it("quantifies exposure exactly as the hand-built review did", () => {
    const report = runForensicSingle(loadFixture());
    const by = Object.fromEntries(report.findings.map((finding) => [finding.ruleId, finding.exposure.quantified]));
    expect(by["RS-001"]).toBe(33.0);
    expect(by["ST-001"]).toBe(99.0);
    expect(by["GR-001"]).toBe(110.0);
    expect(by["NI-001"]).toBe(142.5);
    expect(by["TX-001"]).toBe(-122.7);
    expect(report.exposure.quantifiedLow).toBe(261.8);
    expect(report.exposure.quantifiedHigh).toBe(290.6);
  });

  it("tax rule: goods-only basis for a private owner in a labor-exempt state, silent elsewhere", () => {
    const privatePa = loadFixture();
    privatePa.header.owner = { name: "John Smith", state: "PA" };
    const tx = runForensicSingle(privatePa).findings.find((finding) => finding.ruleId === "TX-001");
    expect(tx?.exposure.quantified).toBe(-93.9);

    const privateNj = loadFixture();
    privateNj.header.owner = { name: "John Smith", state: "NJ" };
    expect(runForensicSingle(privateNj).findings.some((finding) => finding.ruleId === "TX-001")).toBe(false);
  });

  it("puts a reconciliation failure first when printed totals do not rebuild", () => {
    const broken = loadFixture();
    broken.totals.grandTotal = 2200.0;
    const report = runForensicSingle(broken);
    expect(report.findings[0].ruleId).toBe("RC-001");
    expect(report.verdict.holdRelease).toBe(true);
  });
});

describe("forensic-single adapter (real CCC print)", () => {
  it("measured-word lane closes the printed totals to $0.00 and reads header fields", () => {
    const { text, words } = loadCccSample();
    const read = buildNormalizedEstimate({ text, words, fileName: "estimate.pdf" });
    expect(read.lane).toBe("pdf");
    const est = read.estimate;
    expect(est.header.system).toBe("CCC");
    expect(est.header.documentTitle).toBe("Preliminary Estimate");
    expect(est.header.workfileId).toBe("4b53232a");
    expect(est.header.vehicle.year).toBe(2021);
    expect(est.header.vehicle.make).toBe("Lexus");
    expect(est.header.owner?.state).toBe("PA");
    expect(est.totals.labor.find((l) => l.category === "BODY")?.hours).toBe(26.8);
    expect(est.totals.labor.find((l) => l.category === "REFINISH")?.hours).toBe(17.3);
    expect(est.totals.salesTax).toEqual({ basis: 11451.09, ratePct: 6, amount: 687.07 });
    expect(est.totals.grandTotal).toBe(12138.16);
    // Taxed-charge markers come from the word to the right of the price cell,
    // including the glued "T m" form.
    expect(est.lines.find((l) => l.lineNo === 98)?.taxed).toBe(true);
    expect(est.lines.find((l) => l.lineNo === 32)?.taxed).toBe(true);
    expect(est.lines.find((l) => l.lineNo === 10)?.taxed).toBe(false);
    // Paint-column hours stay in the paint column.
    expect(est.lines.find((l) => l.lineNo === 11)?.paintHrs).toBe(1.2);
    expect(est.lines.find((l) => l.lineNo === 11)?.laborHrs).toBeNull();

    const report = runForensicSingle(est);
    expect(report.reconciliation.unexplained).toBe(0);
    expect(report.findings.some((finding) => finding.ruleId === "RC-001")).toBe(false);
  });

  it("text lane still reads header and totals when no word layer exists", () => {
    const { text } = loadCccSample();
    const est = buildNormalizedEstimateFromText(text, { fileName: "estimate.pdf" });
    expect(est.header.system).toBe("CCC");
    expect(est.totals.grandTotal).toBe(12138.16);
    expect(est.lines.length).toBeGreaterThan(50);
    expect(est.lines.find((l) => l.lineNo === 108)?.taxed).toBe(true);
  });

  it("falls back to the text lane when the word layer yields no rows", () => {
    const { text } = loadCccSample();
    const read = buildNormalizedEstimate({ text, words: [{ pageNumber: 1, text: "x", normalizedText: "x", x: 0, y: 0, width: 1, height: 8, pageWidth: 612, pageHeight: 792 }] });
    expect(read.lane).toBe("text");
    expect(read.warnings.length).toBeGreaterThan(0);
  });
});

describe("forensic-single renderer", () => {
  it("renders a multi-page PDF from the fixture report", async () => {
    const report = runForensicSingle(loadFixture());
    const pdf = await renderForensicSingleReportPdf(report, { sourceFileName: "estimate.pdf" });
    expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
    expect(pdf.bytes.length).toBeGreaterThan(5000);
    expect(String.fromCharCode(...pdf.bytes.slice(0, 5))).toBe("%PDF-");
  });
});

describe("report plan routing", () => {
  it("one estimate → forensic single; two → forensic delta + citation density; none → disabled single", () => {
    const one = planReports({ estimateIds: ["a"] });
    expect(one.mode).toBe("FORENSIC_SINGLE");
    expect(one.documents.map((d) => d.kind)).toEqual(["FORENSIC_SINGLE"]);
    expect(one.card.downloadLabel).toBe("Download Forensic Report");

    const two = planReports({ estimateIds: ["a", "b"] });
    expect(two.mode).toBe("FORENSIC_WITH_CITATION_DENSITY");
    expect(two.documents.map((d) => d.kind)).toEqual(["FORENSIC_DELTA", "CITATION_DENSITY"]);
    expect(two.card.title).toBe("Forensic Report w/ Citation Density Report");

    const none = planReports({ estimateIds: [] });
    expect(none.mode).toBe("FORENSIC_SINGLE");
    expect(none.documents).toEqual([]);
    expect(none.card.disabledReason).toBeTruthy();
  });
});

describe("universality", () => {
  it("rule catalog carries no carrier, shop or claim literals", () => {
    const source = readFileSync(fixturePath("src/lib/reports/forensicSingle/rules/catalog.ts"), "utf8");
    for (const literal of ["Sedgwick", "Bensalem", "USAA", "Allstate", "GEICO", "Conestoga", "4A260939"]) {
      expect(source.includes(literal)).toBe(false);
    }
  });
});

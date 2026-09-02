import { describe, expect, it } from "vitest";
import jsPDF from "jspdf";
import {
  flattenPunctuation,
  isWinAnsiSafe,
  toWinAnsiPdfText,
  withWinAnsiPage,
  withWinAnsiText,
} from "../winAnsiText";

const NBSP = "\u00A0";
const ZERO_WIDTH = "\u200B";
const BOM = "\uFEFF";
const NUL = "\u0000";

describe("WinAnsi transliteration", () => {
  it("leaves untouched every character a standard font can already draw", () => {
    // WinAnsi carries typographic punctuation in bytes 0x80-0x9F, whose code
    // points sit well outside Latin-1. Treating the allowed set as "ASCII plus
    // Latin-1" silently deleted the em dash from a shipped report label, so
    // this asserts the whole block survives untouched.
    const text =
      "Bumper cover \u2014 the shop\u2019s estimate \u00B7 $1,240.00 \u00D7 2 \u2022 45\u00B0 \u201Cquoted\u201D \u2026 \u20AC5 \u2122";
    expect(toWinAnsiPdfText(text)).toBe(text);
    expect(isWinAnsiSafe(text)).toBe(true);
  });

  it("flattens punctuation only when a builder opts in", () => {
    const text = "Bumper cover \u2014 the shop\u2019s estimate \u2026";
    expect(toWinAnsiPdfText(text)).toBe(text);
    expect(flattenPunctuation(text)).toBe("Bumper cover - the shop's estimate ...");
  });

  it("spells out operators instead of deleting them", () => {
    // An operator that silently vanishes changes what a threshold says.
    expect(toWinAnsiPdfText("hours \u2265 2.0")).toBe("hours >= 2.0");
    expect(toWinAnsiPdfText("hours \u2264 2.0")).toBe("hours <= 2.0");
    expect(toWinAnsiPdfText("price \u2260 0")).toBe("price != 0");
    expect(toWinAnsiPdfText("\u00B10.5")).toBe("+/-0.5");
  });

  it("spells out arrows, which comparison output is written with", () => {
    expect(toWinAnsiPdfText("source \u2192 keyed")).toBe("source -> keyed");
    expect(toWinAnsiPdfText("a \u2190 b")).toBe("a <- b");
  });

  it("normalises the invisible characters pasted text arrives with", () => {
    expect(toWinAnsiPdfText("a" + NBSP + "b")).toBe("a b");
    expect(toWinAnsiPdfText("a" + ZERO_WIDTH + "b")).toBe("ab");
    expect(toWinAnsiPdfText("a" + BOM + "b")).toBe("ab");
  });

  it("drops what it cannot spell rather than guessing at it", () => {
    expect(toWinAnsiPdfText("done \u2705")).toBe("done ");
    expect(toWinAnsiPdfText("\u5C71")).toBe("");
  });

  it("keeps newlines so words are not glued together", () => {
    expect(toWinAnsiPdfText("first\nsecond")).toBe("first\nsecond");
  });

  it("is idempotent", () => {
    const once = toWinAnsiPdfText("source \u2192 keyed \u2265 2.0 \u2014 done");
    expect(toWinAnsiPdfText(once)).toBe(once);
    expect(isWinAnsiSafe(once)).toBe(true);
  });

  it("handles null and undefined without throwing", () => {
    expect(toWinAnsiPdfText(null)).toBe("");
    expect(toWinAnsiPdfText(undefined)).toBe("");
  });
});

/** Read the text operands out of a generated PDF's first content stream. */
function contentStreamOf(doc: jsPDF): string {
  const bytes = Buffer.from(doc.output("arraybuffer"));
  const raw = bytes.toString("latin1");
  const start = raw.indexOf("stream", raw.indexOf("4 0 obj"));
  return raw.slice(start + 7, raw.indexOf("endstream", start));
}

describe("guarded jsPDF documents", () => {
  it("writes no UTF-16 fallback for text a standard font cannot encode", () => {
    // The defect this guards: jsPDF silently re-encodes such a string as
    // UTF-16BE with no byte-order mark while still pointing at a WinAnsi
    // font, so the reader gets NUL-interleaved mojibake.
    const unguarded = new jsPDF();
    unguarded.text("source \u2192 keyed", 10, 10);
    expect(contentStreamOf(unguarded)).toContain(NUL + "s" + NUL + "o" + NUL + "u");

    const guarded = withWinAnsiText(new jsPDF());
    guarded.text("source \u2192 keyed", 10, 10);
    const stream = contentStreamOf(guarded);
    expect(stream).not.toContain(NUL);
    expect(stream).toContain("(source -> keyed) Tj");
  });

  it("guards every string of a multi-line draw", () => {
    const doc = withWinAnsiText(new jsPDF());
    doc.text(["first \u2265 1", "second \u2192 2"], 10, 10);
    const stream = contentStreamOf(doc);
    expect(stream).not.toContain(NUL);
    expect(stream).toContain("first >= 1");
    expect(stream).toContain("second -> 2");
  });

  it("measures line breaks on the same text it draws", () => {
    const doc = withWinAnsiText(new jsPDF());
    const lines = doc.splitTextToSize("source \u2192 keyed \u2265 2.0", 200) as string[];
    expect(lines.join(" ")).not.toMatch(/[\u2192\u2265]/);
    expect(lines.every((line) => isWinAnsiSafe(line))).toBe(true);
  });

  it("does not stack wrappers when applied twice", () => {
    const doc = withWinAnsiText(new jsPDF());
    expect(withWinAnsiText(doc)).toBe(doc);
    doc.text("a \u2192 b", 10, 10);
    expect(contentStreamOf(doc)).toContain("(a -> b) Tj");
  });
});

describe("guarded pdf-lib pages", () => {
  it("never lets an unencodable character reach the font", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    // Unguarded, pdf-lib throws - a curly quote in an estimate description
    // would fail the whole render, not just that line.
    const bare = pdf.addPage();
    expect(() => bare.drawText("source \u2192 keyed", { font, size: 10 })).toThrow();

    const guarded = withWinAnsiPage(pdf.addPage());
    expect(() => guarded.drawText("source \u2192 keyed", { font, size: 10 })).not.toThrow();
  });

  it("is idempotent so a page fetched in a loop is wrapped once", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const page = withWinAnsiPage(pdf.addPage());
    expect(withWinAnsiPage(page)).toBe(page);
  });
});

/**
 * Citation Density on an Allstate Supplement of Record (RO 22120, 2026-10-04)
 * shipped its annotated pages blank, and fixing that exposed what the blank
 * pages hid: the redaction missed the insured's name, address, phone and the
 * claim number, and painted the "Type of Loss" row instead.
 *
 * 1. Blank pages: the print's font (Tahoma) is not embedded and is not one of
 *    the standard 14, so pdf.js draws it with the canvas's fillText in a
 *    generic family. A Vercel function has no system fonts, so nothing drew.
 * 2. Missed identity: that print's text layer splits every word into its own
 *    item ("Insured:" / "XIN" / "JIN"); the label rules expect a label and its
 *    whole value. Words are now joined into phrases first.
 *
 * Every name and number below is invented.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  PDFJS_STANDARD_FONT_DATA_URL,
  groupWordsIntoRuns,
  identifierSpans,
  planStructuralRedactions,
  redactAndRasterizePdf,
  registerCanvasFallbackFonts,
  type MeasuredWord,
} from "../rasterRedactPdf";

const word = (text: string, x: number, y: number, size = 8): MeasuredWord => ({
  text,
  x,
  y,
  width: text.length * size * 0.5,
  height: size,
});

describe("groupWordsIntoRuns", () => {
  it("joins the words of one phrase and keeps a label, its value and the next column apart", () => {
    const runs = groupWordsIntoRuns([
      // Words one 2pt space apart (8pt print), as on the Supplement of Record.
      word("Insured:", 23, 586),
      word("JANE", 99, 586),
      word("DOE", 117, 586),
      word("Owner", 190, 586),
      word("Policy", 212, 586),
      word("#:", 238, 586),
    ]);
    expect(runs.map((run) => run.text)).toEqual(["Insured:", "JANE DOE", "Owner Policy #:"]);
    const name = runs[1];
    expect(name.parts.map((part) => name.text.slice(part.start, part.end))).toEqual(["JANE", "DOE"]);
  });

  it("does not join words on different lines", () => {
    const runs = groupWordsIntoRuns([word("Type", 23, 572), word("Insured:", 23, 586)]);
    expect(runs.map((run) => run.text)).toEqual(["Insured:", "Type"]);
  });
});

describe("block headings versus row labels", () => {
  const measure = (words: MeasuredWord[]) => groupWordsIntoRuns(words).map(({ parts: _parts, ...run }) => run);

  it("a label with its value beside it opens no block over the rows beneath", () => {
    const items = measure([word("Insured:", 23, 586), word("JANE", 99, 586), word("DOE", 117, 586)]);
    expect(planStructuralRedactions(items, 612, 792).filter((region) => region.reason === "label_block")).toEqual([]);
  });

  it("a heading with only the next column's heading beside it still opens its block", () => {
    const items = measure([
      word("Owner", 23, 520),
      word("(Insured):", 45, 520),
      word("Inspection", 165, 520),
      word("Location:", 207, 520),
    ]);
    const blocks = planStructuralRedactions(items, 612, 792).filter((region) => region.reason === "label_block");
    expect(blocks.length).toBe(2);
  });
});

describe("contact patterns on phrases", () => {
  const cover = (text: string) => identifierSpans(text, undefined, { scope: "full" }).map((span) => text.slice(span.start, span.end));

  it("does not read a drivetrain in the options list as a street", () => {
    expect(cover("4 Wheel Drive")).toEqual([]);
    expect(cover("All Wheel Drive")).toEqual([]);
  });

  it("still covers a street that ends in Drive", () => {
    expect(cover("4 Elm Drive")).toEqual(["4 Elm Drive"]);
  });
});

describe("redactAndRasterizePdf on a word-split print", () => {
  it("covers both words of the insured's name and leaves the claim facts beneath it", async () => {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage([612, 792]);
    // One drawText per word, one space apart, alternating fonts so pdf.js
    // keeps each word its own text item, the way the Supplement of Record's
    // text layer is split (one font would be merged into "JANE DOE").
    const drawWords = (words: string[], x: number, y: number) => {
      let at = x;
      words.forEach((text, index) => {
        const font = index % 2 === 0 ? regular : bold;
        page.drawText(text, { x: at, y, size: 8, font });
        at += font.widthOfTextAtSize(text, 8) + font.widthOfTextAtSize(" ", 8);
      });
    };
    drawWords(["Insured:"], 23, 586);
    drawWords(["JANE", "DOE"], 99, 586);
    drawWords(["Type", "of", "Loss:"], 23, 572);
    drawWords(["Collision"], 99, 572);
    const result = await redactAndRasterizePdf(await pdf.save(), { scope: "full" });
    // Exactly the two words of the name: before, "JANE" alone was rejected as
    // too short to be a name, and the block rule painted the four words of the
    // "Type of Loss: Collision" row.
    expect(result.redactedRegionCount).toBe(2);
  });
});

describe("fonts for pages that do not embed theirs", () => {
  it("registers pdf.js's Liberation Sans for the generic families pdf.js falls back to", async () => {
    const files = fs.readdirSync(PDFJS_STANDARD_FONT_DATA_URL).filter((file) => file.startsWith("LiberationSans-"));
    expect(files.length).toBe(4);
    const { GlobalFonts } = await import("@napi-rs/canvas");
    registerCanvasFallbackFonts(GlobalFonts);
    for (const family of ["sans-serif", "serif", "monospace"]) {
      expect(GlobalFonts.has(family), family).toBe(true);
    }
  });

  it("ships those fonts with both routes that rasterize", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    for (const route of ["/api/reports/citation-density/annotated-estimate", "/api/reports/oem-citation-density/annotated-estimate"]) {
      const block = config.slice(config.indexOf(`"${route}"`), config.indexOf("],", config.indexOf(`"${route}"`)));
      expect(block, route).toContain("./node_modules/pdfjs-dist/standard_fonts/**");
    }
  });
});

/**
 * Text-density-first scan detection (RO 22084).
 *
 * A page with a positioned text layer is never a scan, whatever image sits
 * underneath it. The pure classifier is pinned on its thresholds, and the
 * probe is run against real PDFs built here: text over a full-page image
 * (hybrid), image only (scan), text only (text).
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  MIN_WORDS_FOR_TEXT_PAGE,
  classifyPdfTextLayer,
  probePdfTextLayer,
  type PdfPageTextProfile,
} from "../pdfTextLayerProbe";

const profile = (page: number, words: number, paintsImage: boolean): PdfPageTextProfile => ({ page, words, paintsImage });

describe("classifyPdfTextLayer", () => {
  it("text on every page with a raster underneath is hybrid, never a scan", () => {
    const result = classifyPdfTextLayer([profile(1, 180, true), profile(2, 240, true), profile(3, 95, true)]);
    expect(result.kind).toBe("hybrid");
    expect(result.textPages).toBe(3);
    expect(result.medianWordsPerPage).toBe(180);
  });

  it("text and no images is text; a handful of words per page is a scan", () => {
    expect(classifyPdfTextLayer([profile(1, 200, false), profile(2, 150, false)]).kind).toBe("text");
    expect(classifyPdfTextLayer([profile(1, 3, true), profile(2, 0, true)]).kind).toBe("scan");
    expect(classifyPdfTextLayer([profile(1, MIN_WORDS_FOR_TEXT_PAGE - 1, false)]).kind).toBe("scan");
    expect(classifyPdfTextLayer([]).kind).toBe("scan");
  });

  it("sixty percent of pages must carry text: 3 of 5 does, 2 of 5 does not", () => {
    const three = [profile(1, 200, true), profile(2, 200, true), profile(3, 200, true), profile(4, 2, true), profile(5, 0, true)];
    expect(classifyPdfTextLayer(three).kind).toBe("hybrid");
    const two = [profile(1, 200, true), profile(2, 200, true), profile(3, 1, true), profile(4, 2, true), profile(5, 0, true)];
    expect(classifyPdfTextLayer(two).kind).toBe("scan");
  });
});

// A 1x1 white PNG; scaled to the page it stands in for a full-page raster.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64"
);

async function buildPdf(options: { pages: number; text: boolean; image: boolean; wordsPerPage?: number }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = options.image ? await doc.embedPng(ONE_PIXEL_PNG) : null;
  for (let index = 0; index < options.pages; index += 1) {
    const page = doc.addPage([612, 792]);
    if (png) page.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
    if (options.text) {
      const wordsPerPage = options.wordsPerPage ?? 120;
      const perLine = 10;
      for (let line = 0; line * perLine < wordsPerPage; line += 1) {
        const words = Array.from({ length: Math.min(perLine, wordsPerPage - line * perLine) }, (_, i) => `w${line}${i}`);
        page.drawText(words.join(" "), { x: 40, y: 740 - line * 14, size: 9, font });
      }
    }
  }
  return doc.save();
}

describe("probePdfTextLayer on real documents", () => {
  it("text drawn over a full-page image reads as hybrid with its words counted", async () => {
    const probe = await probePdfTextLayer(await buildPdf({ pages: 2, text: true, image: true }));
    expect(probe.numpages).toBe(2);
    expect(probe.classification.kind).toBe("hybrid");
    for (const page of probe.pages) {
      expect(page.words).toBeGreaterThanOrEqual(MIN_WORDS_FOR_TEXT_PAGE);
      expect(page.paintsImage).toBe(true);
    }
    expect(probe.text).toContain("w00");
  });

  it("an image-only document reads as a scan", async () => {
    const probe = await probePdfTextLayer(await buildPdf({ pages: 2, text: false, image: true }));
    expect(probe.classification.kind).toBe("scan");
    expect(probe.pages.every((page) => page.words === 0 && page.paintsImage)).toBe(true);
  });

  it("a plain text document reads as text", async () => {
    const probe = await probePdfTextLayer(await buildPdf({ pages: 1, text: true, image: false }));
    expect(probe.classification.kind).toBe("text");
    expect(probe.pages[0].paintsImage).toBe(false);
  });

  it("bytes that are not a PDF throw, so the caller falls back to its previous path", async () => {
    await expect(probePdfTextLayer(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});

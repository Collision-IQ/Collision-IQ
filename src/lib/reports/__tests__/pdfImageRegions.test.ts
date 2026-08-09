/**
 * The occupancy extractor, tested against real PDFs rather than a mock, because
 * the thing that can go wrong is the coordinate maths and the graphics-state
 * replay — neither of which a stubbed operator list would exercise.
 *
 * The page-raster exclusion is the load-bearing case. Export redaction
 * rasterizes source pages, and plenty of carrier estimates arrive as scans, so
 * "one image covering the whole page" is common. Counting that as occupancy
 * would mark every page 100% full and suppress every in-page keyed note on
 * exactly the documents that most need them.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractPdfImageRegions } from "../pdfImageRegions";

/** Smallest valid PNG: a single opaque pixel. Scaled up by the draw call. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function pdfWithImage(draw: { x: number; y: number; width: number; height: number }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const png = await doc.embedPng(ONE_PIXEL_PNG);
  page.drawText("estimate row text", { x: 60, y: 700, size: 10 });
  page.drawImage(png, draw);
  return doc.save();
}

async function regionsOf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
  return extractPdfImageRegions(pdf);
}

describe("extractPdfImageRegions", () => {
  it("finds a discrete mark and reports it in top-left page coordinates", async () => {
    // pdf-lib draws from the bottom-left; a 110pt box at y=150 therefore sits
    // 792 - 150 - 110 = 532 from the top.
    const regions = await regionsOf(await pdfWithImage({ x: 60, y: 150, width: 110, height: 110 }));
    expect(regions).toHaveLength(1);
    expect(regions[0].pageNumber).toBe(1);
    expect(regions[0].x).toBeCloseTo(60, 0);
    expect(regions[0].y).toBeCloseTo(532, 0);
    expect(regions[0].width).toBeCloseTo(110, 0);
    expect(regions[0].height).toBeCloseTo(110, 0);
  });

  it("EXCLUDES a full-page raster, so scanned pages keep their note placement", async () => {
    const regions = await regionsOf(await pdfWithImage({ x: 0, y: 0, width: 612, height: 792 }));
    expect(regions).toEqual([]);
  });

  it("ignores a hairline rule drawn as an image", async () => {
    const regions = await regionsOf(await pdfWithImage({ x: 60, y: 400, width: 400, height: 0.5 }));
    expect(regions).toEqual([]);
  });

  it("returns nothing rather than throwing when the document cannot be read", async () => {
    const broken = {
      numPages: 2,
      getPage: async () => {
        throw new Error("unreadable page");
      },
    };
    await expect(extractPdfImageRegions(broken)).resolves.toEqual([]);
  });
});

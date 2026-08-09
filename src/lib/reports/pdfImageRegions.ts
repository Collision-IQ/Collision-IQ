/**
 * NON-TEXT OCCUPANCY: where a page is covered by something the text layer
 * cannot see.
 *
 * The keyed-note placer chooses "whitespace verified empty on the original
 * render". Until now that verification was built purely from extracted text
 * words, so a region carrying an IMAGE — a payment QR code, a shop logo, a
 * signature block, a damage photo — measured as empty and got a note stamped
 * across it. On RO 22194 page 5 the unanchored note band landed squarely on the
 * Sunbit payment QR code, rendering both the QR code and the notes unreadable.
 *
 * The Delta Annotation Rule requires placement in whitespace VERIFIED empty on
 * the original render. Text-only verification does not satisfy that; a page is
 * empty where it carries neither glyphs nor marks. This module supplies the
 * second half.
 *
 * Coordinates are returned in the same top-left-origin space the word
 * extractor uses, so the two can be merged into one occupancy set.
 */

export type PdfImageRegion = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 2-D affine matrix as PDF stores it: [a, b, c, d, e, f]. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 applied first, then m2 — PDF's `cm` composition order. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

/**
 * An image is painted into the unit square and mapped by the current transform,
 * so its page footprint is the bounding box of the four transformed corners.
 * Rotation and flips (PDF images are commonly drawn with a negative d) both
 * fall out of taking min/max rather than assuming an axis-aligned scale.
 */
function unitSquareBounds(matrix: Matrix): { x0: number; y0: number; x1: number; y1: number } {
  const [a, b, c, d, e, f] = matrix;
  const corners: Array<[number, number]> = [
    [e, f],
    [a + e, b + f],
    [c + e, d + f],
    [a + c + e, b + d + f],
  ];
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

/**
 * Marks smaller than this in either dimension are ignored. Estimating platforms
 * paint hairline rules and single-pixel spacers as image XObjects; treating
 * those as occupancy would blank out every usable band on the page and push
 * every note to the appendix. A QR code, logo or photo is far larger.
 */
const MIN_SIGNIFICANT_DIMENSION = 12;

/**
 * A mark covering essentially the whole page is a PAGE RASTER, not a discrete
 * object: a scanned estimate, or a page a redaction pass has flattened to an
 * image. Treating it as occupancy would mark every page of every scanned
 * document 100% full and suppress every keyed note — turning a placement fix
 * into a total loss of in-page notes on exactly the documents that need them
 * most. A full-page raster carries no information about WHERE the marks are,
 * so it is excluded and those pages fall back to text-layer placement.
 *
 * Measured against real output: the redacted delta report renders each page as
 * a single 612x792 image at the page origin.
 */
const PAGE_RASTER_AREA_RATIO = 0.9;

/**
 * Extract image footprints per page from an already-loaded pdf.js document.
 *
 * Never throws: a page whose operator list cannot be read contributes no
 * regions, which degrades to the previous text-only behaviour for that page
 * rather than failing the export.
 */
export async function extractPdfImageRegions(pdf: {
  numPages: number;
  getPage: (pageNumber: number) => Promise<unknown>;
}): Promise<PdfImageRegion[]> {
  const regions: PdfImageRegion[] = [];
  let ops: Record<string, number> | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    ops = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS ?? null;
  } catch {
    return regions;
  }
  if (!ops) return regions;

  const IMAGE_OPS = new Set(
    [ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintJpegXObject, ops.paintImageMaskXObject]
      .filter((op): op is number => typeof op === "number")
  );

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    try {
      const page = (await pdf.getPage(pageNumber)) as {
        getViewport: (params: { scale: number }) => { width: number; height: number };
        getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
      };
      const viewport = page.getViewport({ scale: 1 });
      const operatorList = await page.getOperatorList();

      // Replay the graphics state machine far enough to know the CTM at each
      // paint. Only save/restore/transform affect it for our purposes.
      let ctm: Matrix = [...IDENTITY] as Matrix;
      const stack: Matrix[] = [];

      for (let index = 0; index < operatorList.fnArray.length; index += 1) {
        const fn = operatorList.fnArray[index];
        if (fn === ops.save) {
          stack.push([...ctm] as Matrix);
          continue;
        }
        if (fn === ops.restore) {
          ctm = stack.pop() ?? ([...IDENTITY] as Matrix);
          continue;
        }
        if (fn === ops.transform) {
          const args = operatorList.argsArray[index] as number[] | undefined;
          if (args && args.length >= 6) {
            ctm = multiply(
              [args[0], args[1], args[2], args[3], args[4], args[5]],
              ctm
            );
          }
          continue;
        }
        if (!IMAGE_OPS.has(fn)) continue;

        const bounds = unitSquareBounds(ctm);
        const width = bounds.x1 - bounds.x0;
        const height = bounds.y1 - bounds.y0;
        if (width < MIN_SIGNIFICANT_DIMENSION || height < MIN_SIGNIFICANT_DIMENSION) continue;

        const pageArea = viewport.width * viewport.height;
        if (pageArea > 0 && (width * height) / pageArea >= PAGE_RASTER_AREA_RATIO) continue;

        regions.push({
          pageNumber,
          x: bounds.x0,
          // pdf.js user space has a bottom-left origin; the word extractor
          // reports top-left. Convert so both describe the same page.
          y: viewport.height - bounds.y1,
          width,
          height,
        });
      }
    } catch {
      // This page contributes no occupancy; text-only behaviour stands for it.
    }
  }
  return regions;
}

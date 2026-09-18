/**
 * Text-density-first scan detection.
 *
 * RO 22084 failure mode: a hybrid PDF — a full-page raster of the form's rule
 * lines with a real, positioned text layer on top — came through the upload
 * path's first parser with next to no text, was treated as a scan, and was
 * OCR'd. The OCR output replaced a perfectly good text layer: the Delta engine
 * then read fragments, resolved neither grand total, and R24 refused to ship.
 *
 * The rule this module encodes: a page with a positioned text layer is NEVER
 * a scan, no matter what image sits underneath it. Images only matter when
 * text is absent. The probe reads the document with the same pdfjs lane the
 * report pipeline uses for coordinates, counts positioned words per page, and
 * notes whether the page also paints an image, so the caller can tell "text",
 * "hybrid" and "scan" apart before spending 45-80 seconds on OCR.
 */

export interface PdfPageTextProfile {
  page: number;
  /** Non-whitespace positioned words on the page. */
  words: number;
  /** The page paints at least one image XObject (a raster under the text). */
  paintsImage: boolean;
}

export type PdfTextLayerKind = "text" | "hybrid" | "scan";

export interface PdfTextLayerClassification {
  kind: PdfTextLayerKind;
  pages: PdfPageTextProfile[];
  textPages: number;
  medianWordsPerPage: number;
}

/**
 * Below this many positioned words a page is treated as image-only. CCC and
 * Mitchell pages run 60–600 words; a true scan with no OCR layer runs 0–5.
 */
export const MIN_WORDS_FOR_TEXT_PAGE = 40;
/** Share of pages that must carry a text layer for the document to count as one. */
export const TEXT_PAGE_SHARE = 0.6;

/** Pure: classify a document from its per-page profiles. Order matters — the
 *  text layer decides; images only distinguish "hybrid" from "text". */
export function classifyPdfTextLayer(pages: PdfPageTextProfile[]): PdfTextLayerClassification {
  const counts = pages.map((page) => page.words).sort((a, b) => a - b);
  const medianWordsPerPage = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const textPages = pages.filter((page) => page.words >= MIN_WORDS_FOR_TEXT_PAGE).length;
  const anyImage = pages.some((page) => page.paintsImage);
  const kind: PdfTextLayerKind =
    pages.length > 0 && textPages >= Math.ceil(pages.length * TEXT_PAGE_SHARE)
      ? anyImage
        ? "hybrid"
        : "text"
      : "scan";
  return { kind, pages, textPages, medianWordsPerPage };
}

export interface PdfTextLayerProbe {
  /** Page text in reading order, items on one baseline joined as the first
   *  parser lane joins them, so downstream readers see one shape. */
  text: string;
  numpages: number;
  pages: PdfPageTextProfile[];
  classification: PdfTextLayerClassification;
}

/**
 * Read the positioned text layer with pdfjs (legacy build, the configuration
 * the serverless pipeline already runs) and classify the document. Throws
 * when the bytes cannot be opened at all; the caller treats that as "no
 * text layer could be read" and proceeds as before.
 */
export async function probePdfTextLayer(buffer: Buffer | Uint8Array): Promise<PdfTextLayerProbe> {
  const { ensurePdfJsNodePolyfills } = await import("@/lib/reports/citationDensityRowAnchors");
  const polyfillError = await ensurePdfJsNodePolyfills([]);
  if (polyfillError) throw new Error(polyfillError);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const ops = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS ?? {};
  const imageOps = new Set(
    [ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintJpegXObject, ops.paintImageMaskXObject].filter(
      (op): op is number => typeof op === "number"
    )
  );

  const pageTexts: string[] = [];
  const pages: PdfPageTextProfile[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line: string[] = [];
    let lastY: number | null = null;
    let words = 0;
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      const str = item.str ?? "";
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line.length) {
        lines.push(line.join(""));
        line = [];
      }
      if (str) {
        line.push(str);
        words += str.split(/\s+/).filter(Boolean).length;
      }
      if (y !== null) lastY = y;
    }
    if (line.length) lines.push(line.join(""));
    pageTexts.push(lines.join("\n"));

    let paintsImage = false;
    if (imageOps.size > 0) {
      try {
        const operatorList = await page.getOperatorList();
        paintsImage = operatorList.fnArray.some((fn: number) => imageOps.has(fn));
      } catch {
        // An unreadable operator list says nothing about the text layer.
      }
    }
    pages.push({ page: pageNumber, words, paintsImage });
  }

  return {
    text: pageTexts.join("\n"),
    numpages: pdf.numPages,
    pages,
    classification: classifyPdfTextLayer(pages),
  };
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePdfJsNodePolyfills } from "@/lib/reports/citationDensityRowAnchors";

// Server-side OCR fallback for image-only ("scanned") PDFs. When pdf-parse
// extracts (near) zero text, the pages are scanned images with no text layer.
// We rasterize each page with pdf.js + @napi-rs/canvas and read it with
// tesseract.js (WASM — no system binary, works in serverless). This is the
// durable fix for "scanned doc comes through as image only": the estimate text
// gets into the reviewed set and the line-item extractors automatically.

const DEFAULT_MAX_PAGES = 10;
const RENDER_SCALE = 350 / 72; // ~350 DPI — sharper small CCC table text
const OCR_CONTRAST = 1.5; // boost separation of text from background before OCR

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ── OCR row reconstruction from word bounding boxes ──────────────────────────
type OcrBbox = { x0: number; y0: number; x1: number; y1: number };
type OcrWord = { text?: string; bbox?: OcrBbox };
type OcrLine = { words?: OcrWord[] };
type OcrParagraph = { lines?: OcrLine[] };
type OcrBlock = { paragraphs?: OcrParagraph[] };

function collectOcrWords(blocks: OcrBlock[] | null | undefined): Array<{ text: string; xc: number; yc: number; h: number }> {
  const words: Array<{ text: string; xc: number; yc: number; h: number }> = [];
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? "").trim();
          const b = word.bbox;
          if (!text || !b) continue;
          words.push({ text, xc: (b.x0 + b.x1) / 2, yc: (b.y0 + b.y1) / 2, h: Math.max(1, b.y1 - b.y0) });
        }
      }
    }
  }
  return words;
}

/**
 * Rebuild horizontal rows from OCR word boxes: group words whose vertical
 * centers are close (a table row), then order each row left-to-right. This
 * restores row-major estimate lines even when tesseract read the columns
 * top-to-bottom. Returns "" when there are too few positioned words to trust,
 * so the caller falls back to tesseract's linear text.
 */
function reconstructRowsFromBlocks(blocks: OcrBlock[] | null | undefined): string {
  const words = collectOcrWords(blocks);
  if (words.length < 10) return "";

  const heights = words.map((w) => w.h).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
  const rowTolerance = Math.max(6, medianHeight * 0.6);

  const sorted = [...words].sort((a, b) => a.yc - b.yc || a.xc - b.xc);
  const rows: Array<{ anchorY: number; words: Array<{ text: string; xc: number }> }> = [];
  for (const word of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(word.yc - row.anchorY) <= rowTolerance) {
      row.words.push({ text: word.text, xc: word.xc });
    } else {
      rows.push({ anchorY: word.yc, words: [{ text: word.text, xc: word.xc }] });
    }
  }

  return rows
    .map((row) =>
      row.words
        .sort((a, b) => a.xc - b.xc)
        .map((w) => w.text)
        .join(" ")
    )
    .join("\n")
    .trim();
}

/**
 * Point tesseract.js at the bundled language data + wasm core so a cold
 * serverless instance never has to fetch ~10MB from a CDN on the first scanned
 * upload. Everything is optional and existence-checked: if an asset isn't found
 * (e.g. a stripped deploy), the field is omitted and tesseract.js falls back to
 * its default CDN behavior — so this can only speed things up, never break them.
 */
function resolveTesseractWorkerOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = {
    // Cache to a writable temp dir instead of the CWD (which polluted the repo).
    cachePath: path.join(os.tmpdir(), "collision-iq-tesseract"),
  };
  try {
    fs.mkdirSync(options.cachePath as string, { recursive: true });
  } catch {
    // ignore — tesseract will surface its own error if the dir is unusable
  }

  // Bundled English traineddata (gzipped) vendored under assets/tessdata.
  const langDir = path.join(process.cwd(), "assets", "tessdata");
  if (fs.existsSync(path.join(langDir, "eng.traineddata.gz"))) {
    options.langPath = langDir;
    options.gzip = true;
  }

  // WASM core shipped with the tesseract.js-core dependency.
  const coreDir = path.join(process.cwd(), "node_modules", "tesseract.js-core");
  if (fs.existsSync(coreDir)) {
    options.corePath = coreDir;
  }

  return options;
}

/** OCR is disabled only when explicitly turned off. */
export function isPdfOcrFallbackEnabled(): boolean {
  return process.env.PDF_OCR_FALLBACK_DISABLED?.trim() !== "1";
}

/**
 * A PDF whose extracted text is far below what a real document would carry is
 * treated as image-only. Scales with page count so a mostly-image multi-page
 * scan still qualifies, while a normal text PDF never does.
 */
export function shouldOcrPdf(extractedText: string, pageCount?: number): boolean {
  if (!isPdfOcrFallbackEnabled()) return false;
  const trimmedLength = (extractedText || "").replace(/\s+/g, " ").trim().length;
  const pages = pageCount && pageCount > 0 ? pageCount : 1;
  return trimmedLength < Math.max(50, pages * 20);
}

async function renderPdfPagesToPng(
  buffer: Buffer,
  maxPages: number
): Promise<Buffer[]> {
  const polyfillError = await ensurePdfJsNodePolyfills([]);
  if (polyfillError) throw new Error(polyfillError);

  const { createCanvas } = await import("@napi-rs/canvas");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await loadingTask.promise;

  const pageImages: Buffer[] = [];
  const pageLimit = Math.min(pdf.numPages, maxPages);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    // White background so transparent PDF regions OCR cleanly.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      // pdf.js accepts any canvas-2d-compatible context; @napi-rs/canvas fits.
      // Cast through unknown: the Node canvas types don't match the DOM types
      // pdf.js declares, but the runtime shapes are compatible.
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    } as unknown as Parameters<typeof page.render>[0]).promise;

    // Preprocess for OCR: grayscale + contrast boost. Tesseract reads a clean
    // high-contrast grayscale far more accurately than a color raster, so the
    // faint CCC table text and section headers come through reliably.
    try {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = image.data;
      const intercept = 128 * (1 - OCR_CONTRAST);
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        let v = OCR_CONTRAST * gray + intercept;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
      context.putImageData(image, 0, 0);
    } catch {
      // If pixel access is unavailable, OCR the un-preprocessed raster.
    }

    pageImages.push(await canvas.encode("png"));
  }
  return pageImages;
}

/**
 * OCR an image-only PDF. Never throws — returns null on any failure so callers
 * can fall back to whatever pdf-parse produced. Returns concatenated page text.
 */
export async function ocrPdfBuffer(
  buffer: Buffer,
  options?: { maxPages?: number }
): Promise<{ text: string; pagesOcred: number } | null> {
  const maxPages = options?.maxPages ?? envInt("PDF_OCR_MAX_PAGES", DEFAULT_MAX_PAGES);

  let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;
  try {
    const pageImages = await renderPdfPagesToPng(buffer, maxPages);
    if (pageImages.length === 0) return null;

    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng", undefined, resolveTesseractWorkerOptions() as never);
    // Tune for tabular estimates: treat the page as a single column of
    // variable-size text and keep column spacing so the layout is preserved.
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "4", // PSM_SINGLE_COLUMN
        preserve_interword_spaces: "1",
      } as never);
    } catch {
      // Older tesseract.js signatures may reject setParameters; proceed with defaults.
    }

    const pageTexts: string[] = [];
    for (let i = 0; i < pageImages.length; i += 1) {
      const { data } = await worker.recognize(pageImages[i], {}, { blocks: true } as never);
      // Reconstruct rows from word positions. A CCC estimate is a multi-column
      // table; tesseract's linear text output often reads it column-major (all
      // line numbers, then all descriptions, then all prices), which destroys
      // the row structure the delta matcher needs. Regrouping words by vertical
      // position rebuilds true rows ("19 Repl Absorber 163520300C 1 78.00 0.2").
      const rowText = reconstructRowsFromBlocks(
        (data as unknown as { blocks?: OcrBlock[] | null }).blocks
      );
      const pageText = (rowText || data.text || "").trim();
      if (pageText) pageTexts.push(`===== Page ${i + 1} =====\n${pageText}`);
    }

    const text = pageTexts.join("\n\n").trim();
    if (!text) return null;
    return { text, pagesOcred: pageImages.length };
  } catch (error) {
    console.warn("[pdf-ocr-fallback] OCR failed (non-blocking)", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    try {
      await worker?.terminate();
    } catch {
      // ignore terminate errors
    }
  }
}

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
      const { data } = await worker.recognize(pageImages[i]);
      const pageText = (data.text || "").trim();
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

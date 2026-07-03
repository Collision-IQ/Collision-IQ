import { ensurePdfJsNodePolyfills } from "@/lib/reports/citationDensityRowAnchors";

// Server-side OCR fallback for image-only ("scanned") PDFs. When pdf-parse
// extracts (near) zero text, the pages are scanned images with no text layer.
// We rasterize each page with pdf.js + @napi-rs/canvas and read it with
// tesseract.js (WASM — no system binary, works in serverless). This is the
// durable fix for "scanned doc comes through as image only": the estimate text
// gets into the reviewed set and the line-item extractors automatically.

const DEFAULT_MAX_PAGES = 10;
const RENDER_SCALE = 300 / 72; // ~300 DPI for legible OCR

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    worker = await createWorker("eng");

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

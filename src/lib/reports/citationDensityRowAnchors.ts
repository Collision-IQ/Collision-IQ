import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { PDFDocument } from "pdf-lib";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import { buildPdfRectFromTopLeftAnchor } from "./citationDensityCoordinates";

export type SourceDocumentRole = "carrier" | "shop";

export type PdfWord = {
  pageNumber: number;
  text: string;
  normalizedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

export type PdfTextExtractionMethod = "pdfjs-legacy-primary" | "pdfjs-legacy-node-fallback";

export type PdfTextExtractionDiagnostics = {
  method: PdfTextExtractionMethod;
  error?: string;
  warnings: string[];
  pdfWorkerResolvedPath?: string;
  pdfWorkerExists?: boolean;
  pdfWorkerSrc?: string;
  pdfjsImportMode?: "externalized-node-module" | "next-bundled-chunk";
  workerResolutionAttempted: boolean;
  workerResolutionSucceeded: boolean;
  workerResolutionError?: string;
  parserFallbackUsed: boolean;
  textExtractionInfrastructureStage?: "polyfills" | "pdfjs-import" | "worker-resolution" | "get-document" | "get-text-content";
  pageCount: number;
  perPageTextLengths: number[];
  perPageTextItemCounts: number[];
  firstNonEmptyTextPage: number | null;
  firstNonEmptyTextSample: string;
};

export type PdfTextLine = {
  pageNumber: number;
  text: string;
  normalizedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  words: PdfWord[];
  synthetic?: boolean;
};

export type PdfQuad = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type EstimateRowAnchorSelectionOption = {
  anchorId: string;
  sourceDocumentRole: SourceDocumentRole;
  pageNumber: number;
  lineNumber: string | null;
  section?: string;
  anchorType: EstimateRowAnchorType;
  text: string;
};

export type EstimateRowAnchorType =
  | "estimate_line"
  | "line_note"
  | "embedded_link_row"
  | "supplier_row"
  | "totals_row"
  | "section_row"
  | "guide_row";

export type EstimateRowAnchor = {
  anchorId: string;
  sourceDocumentId: string;
  sourceDocumentRole: SourceDocumentRole;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  rotation: 0 | 90 | 180 | 270;
  lineNumber: string | null;
  section?: string;
  rowText: string;
  normalizedRowText: string;
  noteText?: string;
  normalizedNoteText?: string;
  supplierText?: string;
  normalizedSupplierText?: string;
  anchorType: EstimateRowAnchorType;
  operation?: string | null;
  description?: string | null;
  partNumber?: string | null;
  qty?: number | null;
  price?: number | null;
  labor?: number | null;
  paint?: number | null;
  pdfBoundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pdfQuad: PdfQuad;
  normalizedUiRect: {
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
  };
  x: number;
  y: number;
  width: number;
  height: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  confidence: number;
  synthetic?: boolean;
};

type BuildOptions = {
  sourceDocumentRole: SourceDocumentRole;
  sourceDocumentId?: string;
};

export async function extractPdfRowAnchors(bytes: Uint8Array, options: BuildOptions): Promise<EstimateRowAnchor[]> {
  const { words } = await extractPdfWordsWithDiagnostics(bytes);
  return buildEstimateRowAnchorsFromLines(buildPdfTextLines(words), options);
}

export async function extractPdfWords(bytes: Uint8Array): Promise<PdfWord[]> {
  return (await extractPdfWordsWithDiagnostics(bytes)).words;
}

export async function extractPdfWordsWithDiagnostics(bytes: Uint8Array): Promise<{
  words: PdfWord[];
  diagnostics: PdfTextExtractionDiagnostics;
}> {
  const warnings: string[] = [];
  let infrastructureStage: PdfTextExtractionDiagnostics["textExtractionInfrastructureStage"] = "polyfills";
  const polyfillError = await ensurePdfJsNodePolyfills(warnings);
  if (polyfillError) {
    return {
      words: [],
      diagnostics: {
        method: "pdfjs-legacy-primary",
        error: polyfillError,
        warnings,
        workerResolutionAttempted: false,
        workerResolutionSucceeded: false,
        parserFallbackUsed: false,
        textExtractionInfrastructureStage: infrastructureStage,
        pageCount: 0,
        perPageTextLengths: [],
        perPageTextItemCounts: [],
        firstNonEmptyTextPage: null,
        firstNonEmptyTextSample: "",
      },
    };
  }

  infrastructureStage = "get-document";
  const primary = await extractPdfWordsWithPdfjs(bytes, "pdfjs-legacy-primary", {
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  }).catch((error) => emptyExtractionDiagnostics("pdfjs-legacy-primary", error));
  if (primary.words.length > 0) {
    return {
      words: primary.words,
      diagnostics: {
        ...primary.diagnostics,
        parserFallbackUsed: false,
        warnings: [...warnings, ...primary.diagnostics.warnings],
      },
    };
  }

  const fallback = await extractPdfWordsWithPdfjs(bytes, "pdfjs-legacy-node-fallback", {
    data: Uint8Array.from(Buffer.from(bytes)),
    useSystemFonts: true,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    isEvalSupported: false,
    stopAtErrors: false,
    useWorkerFetch: false,
  }).catch((error) => emptyExtractionDiagnostics("pdfjs-legacy-node-fallback", error));

  return {
    words: fallback.words,
    diagnostics: {
      ...fallback.diagnostics,
      parserFallbackUsed: true,
      warnings: [
        ...warnings,
        ...primary.diagnostics.warnings,
        primary.diagnostics.error
          ? `Primary pdfjs extraction failed: ${primary.diagnostics.error}; retried with Node fallback options.`
          : "Primary pdfjs extraction returned zero text items; retried with Node fallback options.",
        ...fallback.diagnostics.warnings,
      ],
    },
  };
}

export async function ensurePdfJsNodePolyfills(warnings: string[]) {
  if (
    typeof globalThis.DOMMatrix !== "undefined" &&
    typeof globalThis.ImageData !== "undefined" &&
    typeof globalThis.Path2D !== "undefined"
  ) {
    return null;
  }

  try {
    const canvas = await import("@napi-rs/canvas");
    const maybeCanvas = canvas as unknown as {
      DOMMatrix?: unknown;
      ImageData?: unknown;
      Path2D?: unknown;
    };
    const target = globalThis as unknown as Record<"DOMMatrix" | "ImageData" | "Path2D", unknown>;

    if (typeof globalThis.DOMMatrix === "undefined" && maybeCanvas.DOMMatrix) {
      target.DOMMatrix = maybeCanvas.DOMMatrix;
    }
    if (typeof globalThis.ImageData === "undefined" && maybeCanvas.ImageData) {
      target.ImageData = maybeCanvas.ImageData;
    }
    if (typeof globalThis.Path2D === "undefined" && maybeCanvas.Path2D) {
      target.Path2D = maybeCanvas.Path2D;
    }

    warnings.push("Loaded @napi-rs/canvas PDF.js Node polyfills.");
    return null;
  } catch (error) {
    return `Missing PDF.js Node polyfill dependency @napi-rs/canvas: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function emptyExtractionDiagnostics(
  method: PdfTextExtractionMethod,
  error: unknown
): {
  words: PdfWord[];
  diagnostics: PdfTextExtractionDiagnostics;
} {
  return {
    words: [],
    diagnostics: {
      method,
      error: error instanceof Error ? error.message : String(error),
      warnings: [],
      workerResolutionAttempted: false,
      workerResolutionSucceeded: false,
      parserFallbackUsed: method === "pdfjs-legacy-node-fallback",
      textExtractionInfrastructureStage: "pdfjs-import",
      pageCount: 0,
      perPageTextLengths: [],
      perPageTextItemCounts: [],
      firstNonEmptyTextPage: null,
      firstNonEmptyTextSample: "",
    },
  };
}

async function extractPdfWordsWithPdfjs(
  bytes: Uint8Array,
  method: PdfTextExtractionMethod,
  documentOptions: Record<string, unknown>
): Promise<{
  words: PdfWord[];
  diagnostics: PdfTextExtractionDiagnostics;
}> {
  const warnings: string[] = [];
  let infrastructureStage: PdfTextExtractionDiagnostics["textExtractionInfrastructureStage"] = "pdfjs-import";
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let workerDiagnostics: ReturnType<typeof resolvePdfJsNodeWorker> | undefined;
  infrastructureStage = "worker-resolution";
  workerDiagnostics = configurePdfJsNodeWorker(pdfjs, warnings);

  const getDocumentOptions = {
    ...documentOptions,
    disableWorker: true,
  };

  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    infrastructureStage = "get-document";
    const loadingTask = pdfjs.getDocument(getDocumentOptions as unknown as Parameters<typeof pdfjs.getDocument>[0]);
    pdf = await loadingTask.promise;
  } catch (error) {
    return {
      words: [],
      diagnostics: {
        method,
        error: error instanceof Error ? error.message : String(error),
        warnings,
        ...(workerDiagnostics ?? {}),
        workerResolutionAttempted: workerDiagnostics?.workerResolutionAttempted ?? true,
        workerResolutionSucceeded: workerDiagnostics?.workerResolutionSucceeded ?? false,
        parserFallbackUsed: method === "pdfjs-legacy-node-fallback",
        textExtractionInfrastructureStage: infrastructureStage,
        pageCount: 0,
        perPageTextLengths: [],
        perPageTextItemCounts: [],
        firstNonEmptyTextPage: null,
        firstNonEmptyTextSample: "",
      },
    };
  }
  const words: PdfWord[] = [];
  const perPageTextLengths: number[] = [];
  const perPageTextItemCounts: number[] = [];
  let firstNonEmptyTextPage: number | null = null;
  let firstNonEmptyTextSample = "";

  try {
    infrastructureStage = "get-text-content";
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      } as unknown as Parameters<typeof page.getTextContent>[0]);
      let pageTextLength = 0;
      let pageTextItemCount = 0;
      const pageChunks: string[] = [];
      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string") continue;
        const text = item.str.replace(/\s+/g, " ").trim();
        if (!text) continue;
        pageTextItemCount += 1;
        pageTextLength += text.length;
        pageChunks.push(text);
        const transform = item.transform;
        const x = Number(transform[4] ?? 0);
        const pdfJsY = Number(transform[5] ?? 0);
        const height = Math.max(Number((item as { height?: number }).height ?? 8), 6);
        const width = Math.max(Number((item as { width?: number }).width ?? 40), text.length * 4);
        words.push({
          pageNumber,
          text,
          normalizedText: normalizeMatchText(text),
          x,
          y: viewport.height - pdfJsY - height * 0.4,
          width,
          height,
          pageWidth: viewport.width,
          pageHeight: viewport.height,
        });
      }
      perPageTextLengths.push(pageTextLength);
      perPageTextItemCounts.push(pageTextItemCount);
      if (firstNonEmptyTextPage === null && pageTextLength > 0) {
        firstNonEmptyTextPage = pageNumber;
        firstNonEmptyTextSample = truncateExtractionSample(pageChunks.join(" "));
      }
    }
  } catch (error) {
    return {
      words: [],
      diagnostics: {
        method,
        error: error instanceof Error ? error.message : String(error),
        warnings,
        ...workerDiagnostics,
        workerResolutionAttempted: workerDiagnostics?.workerResolutionAttempted ?? true,
        workerResolutionSucceeded: workerDiagnostics?.workerResolutionSucceeded ?? false,
        parserFallbackUsed: method === "pdfjs-legacy-node-fallback",
        textExtractionInfrastructureStage: infrastructureStage,
        pageCount: pdf.numPages,
        perPageTextLengths,
        perPageTextItemCounts,
        firstNonEmptyTextPage,
        firstNonEmptyTextSample,
      },
    };
  }

  return {
    words,
    diagnostics: {
      method,
      warnings,
      ...workerDiagnostics,
      workerResolutionAttempted: workerDiagnostics?.workerResolutionAttempted ?? true,
      workerResolutionSucceeded: workerDiagnostics?.workerResolutionSucceeded ?? false,
      parserFallbackUsed: method === "pdfjs-legacy-node-fallback",
      textExtractionInfrastructureStage: "get-text-content",
      pageCount: pdf.numPages,
      perPageTextLengths,
      perPageTextItemCounts,
      firstNonEmptyTextPage,
      firstNonEmptyTextSample,
    },
  };
}

const requireFromThisModule = createRequire(pathToFileURL(__filename).href);

export function resolvePdfJsNodeWorker() {
  try {
    const workerPath = requireFromThisModule.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const workerExists = fs.existsSync(workerPath);
    const workerSrc = workerExists ? pathToFileURL(workerPath).href : undefined;
    const pdfjsImportMode = workerPath.includes(`${path.sep}node_modules${path.sep}`)
      ? "externalized-node-module" as const
      : "next-bundled-chunk" as const;

    return {
      pdfWorkerResolvedPath: workerPath,
      pdfWorkerExists: workerExists,
      pdfWorkerSrc: workerSrc,
      pdfjsImportMode,
      workerResolutionAttempted: true,
      workerResolutionSucceeded: workerExists,
      workerResolutionError: workerExists ? undefined : `PDF.js worker file not found at ${workerPath}`,
    };
  } catch (error) {
    return {
      pdfWorkerResolvedPath: undefined,
      pdfWorkerExists: false,
      pdfWorkerSrc: undefined,
      pdfjsImportMode: undefined,
      workerResolutionAttempted: true,
      workerResolutionSucceeded: false,
      workerResolutionError: error instanceof Error ? error.message : String(error),
    };
  }
}

function configurePdfJsNodeWorker(
  pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs"),
  warnings: string[]
) {
  const workerDiagnostics = resolvePdfJsNodeWorker();
  if (workerDiagnostics.workerResolutionSucceeded && workerDiagnostics.pdfWorkerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerDiagnostics.pdfWorkerSrc;
    warnings.push(`Configured PDF.js workerSrc from ${workerDiagnostics.pdfWorkerResolvedPath}`);
  } else {
    warnings.push(
      `PDF.js worker resolution skipped; server extraction will use disableWorker=true. ${workerDiagnostics.workerResolutionError ?? "Worker path unavailable."}`
    );
  }

  return workerDiagnostics;
}

function truncateExtractionSample(value: string, maxLength = 500) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function buildPdfTextLines(words: PdfWord[]): PdfTextLine[] {
  const byPage = new Map<number, PdfWord[]>();
  for (const word of words) {
    const pageWords = byPage.get(word.pageNumber) ?? [];
    pageWords.push(word);
    byPage.set(word.pageNumber, pageWords);
  }

  const lines: PdfTextLine[] = [];
  for (const [, pageWords] of byPage.entries()) {
    const rows: PdfWord[][] = [];
    for (const word of [...pageWords].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find((candidate) =>
        Math.abs(average(candidate.map((item) => item.y)) - word.y) <= Math.max(3.5, word.height * 0.55)
      );
      if (row) row.push(word);
      else rows.push([word]);
    }

    for (const row of rows) {
      const ordered = [...row].sort((a, b) => a.x - b.x);
      const text = ordered.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 3) continue;
      const minX = Math.min(...ordered.map((item) => item.x));
      const minY = Math.min(...ordered.map((item) => item.y));
      const maxX = Math.max(...ordered.map((item) => item.x + item.width));
      const maxY = Math.max(...ordered.map((item) => item.y + item.height));
      lines.push({
        pageNumber: ordered[0].pageNumber,
        text,
        normalizedText: normalizeMatchText(text),
        x: minX,
        y: minY,
        width: Math.max(40, maxX - minX),
        height: Math.max(8, maxY - minY),
        pageWidth: ordered[0].pageWidth,
        pageHeight: ordered[0].pageHeight,
        words: ordered,
      });
    }
  }
  return lines;
}

export function buildStoredTextRowAnchors(
  sourceText: string | null | undefined,
  pdfDoc: PDFDocument,
  options: BuildOptions
): EstimateRowAnchor[] {
  const text = sourceText?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  const pageCount = Math.max(1, pdfDoc.getPageCount());
  const pages = splitStoredTextIntoPages(text, pageCount);
  const lines: PdfTextLine[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pdfDoc.getPage(Math.min(pageIndex, pageCount - 1));
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const rawLines = pageText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const usableLines = mergeContinuationLines(rawLines);
    const rowHeight = Math.max(8, Math.min(13, (pageHeight - 120) / Math.max(1, usableLines.length)));

    usableLines.forEach((line, index) => {
      const y = clamp(72 + index * rowHeight, 42, pageHeight - 42);
      lines.push({
        pageNumber: Math.min(pageIndex, pageCount - 1) + 1,
        text: line,
        normalizedText: normalizeMatchText(line),
        x: 42,
        y,
        width: Math.min(pageWidth - 84, Math.max(180, line.length * 4.8)),
        height: 9,
        pageWidth,
        pageHeight,
        words: [],
        synthetic: true,
      });
    });
  });

  return buildEstimateRowAnchorsFromLines(lines, options);
}

export function buildEstimateRowAnchorSelectionOptions(
  anchors: EstimateRowAnchor[]
): EstimateRowAnchorSelectionOption[] {
  return anchors
    .filter((anchor) => !anchor.synthetic && anchor.confidence >= 0.82 && !isGenericOrMalformedAnchorText(anchor.rowText))
    .map((anchor) => ({
      anchorId: anchor.anchorId,
      sourceDocumentRole: anchor.sourceDocumentRole,
      pageNumber: anchor.pageNumber,
      lineNumber: anchor.lineNumber,
      section: anchor.section || undefined,
      anchorType: anchor.anchorType,
      text: getModelVisibleAnchorText(anchor),
    }));
}

export function filterSelectedEstimateRowAnchors(
  anchors: EstimateRowAnchor[],
  selectedAnchorIds: string[]
): EstimateRowAnchor[] {
  const anchorIndex = new Map(anchors.map((anchor) => [anchor.anchorId, anchor]));
  const seen = new Set<string>();
  const selected: EstimateRowAnchor[] = [];
  for (const anchorId of selectedAnchorIds) {
    if (seen.has(anchorId)) continue;
    const anchor = anchorIndex.get(anchorId);
    if (!anchor) continue;
    selected.push(anchor);
    seen.add(anchorId);
  }
  return selected;
}

export function buildEstimateRowAnchorsFromLines(lines: PdfTextLine[], options: BuildOptions): EstimateRowAnchor[] {
  const anchors: EstimateRowAnchor[] = [];
  let section = "";
  let previousEstimateRow: EstimateRowAnchor | null = null;

  for (const line of [...lines].sort((a, b) => a.pageNumber - b.pageNumber || a.y - b.y || a.x - b.x)) {
    if (isGenericOrMalformedAnchorText(line.text)) continue;
    const lineNumber = extractLineNumber(line.text);
    const sectionName = detectSection(line.text);
    const type = classifyLine(line.text, lineNumber, sectionName, section);
    if (sectionName) section = sectionName;

    if (!lineNumber && previousEstimateRow && line.pageNumber === previousEstimateRow.pageNumber && shouldAttachContinuationLine(line, type)) {
      attachContinuationLine(previousEstimateRow, line, {
        asNote: type === "line_note" || isNoteContinuation(line.text),
        forceType: detectEmbeddedLinkRow(line.text) ? "embedded_link_row" : undefined,
      });
      continue;
    }

    if (!type) continue;
    const parsed = parseEstimateRowFields(line.text, lineNumber);
    const rect = buildPdfRectFromTopLeftAnchor(line, {
      pdfWidth: line.pageWidth,
      pdfHeight: line.pageHeight,
      rotation: 0,
    }, 2);
    const geometry = buildAnchorGeometry(rect);
    const anchor: EstimateRowAnchor = {
      anchorId: `${options.sourceDocumentId ?? `${options.sourceDocumentRole}-estimate`}:p${line.pageNumber}:${lineNumber ?? anchors.length + 1}:${type}`,
      sourceDocumentId: options.sourceDocumentId ?? `${options.sourceDocumentRole}-estimate`,
      sourceDocumentRole: options.sourceDocumentRole,
      pageNumber: line.pageNumber,
      pageWidth: line.pageWidth,
      pageHeight: line.pageHeight,
      rotation: 0,
      lineNumber,
      section,
      rowText: line.text,
      normalizedRowText: line.normalizedText,
      anchorType: type,
      operation: parsed.operation,
      description: parsed.description,
      partNumber: parsed.partNumber,
      qty: parsed.qty,
      price: parsed.price,
      labor: parsed.labor,
      paint: parsed.paint,
      pdfBoundingBox: geometry.pdfBoundingBox,
      pdfQuad: geometry.pdfQuad,
      normalizedUiRect: geometry.normalizedUiRect,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      xPct: rect.xPct,
      yPct: rect.yPct,
      wPct: rect.wPct,
      hPct: rect.hPct,
      confidence: type === "estimate_line" ? 0.96 : type === "line_note" || type === "embedded_link_row" ? 0.92 : 0.88,
      synthetic: line.synthetic,
    };
    if (type === "supplier_row") {
      anchor.supplierText = line.text;
      anchor.normalizedSupplierText = line.normalizedText;
    }
    anchors.push(anchor);
    previousEstimateRow = type === "estimate_line" || type === "line_note" || type === "embedded_link_row" ? anchor : previousEstimateRow;
  }

  return anchors;
}

function shouldAttachContinuationLine(line: PdfTextLine, type: EstimateRowAnchorType | null) {
  if (type === "section_row" || type === "totals_row" || type === "supplier_row" || type === "guide_row") return false;
  if (type === "line_note" || type === "embedded_link_row") return true;
  if (detectSection(line.text)) return false;
  if (isGenericOrMalformedAnchorText(line.text)) return false;
  const normalized = normalizeMatchText(line.text);
  if (!normalized) return false;
  if (/^\d{1,4}\b/.test(normalized)) return false;
  return /[a-z]/.test(normalized) && !/^(?:page|estimate|claim|vehicle)\b/.test(normalized);
}

function attachContinuationLine(
  anchor: EstimateRowAnchor,
  line: PdfTextLine,
  options: { asNote: boolean; forceType?: EstimateRowAnchorType }
) {
  if (options.asNote) {
    anchor.noteText = `${anchor.noteText ? `${anchor.noteText} ` : ""}${line.text}`;
    anchor.normalizedNoteText = normalizeMatchText(anchor.noteText);
  } else {
    anchor.rowText = `${anchor.rowText} ${line.text}`.replace(/\s+/g, " ").trim();
    anchor.normalizedRowText = normalizeMatchText(anchor.rowText);
    const parsed = parseEstimateRowFields(anchor.rowText, anchor.lineNumber);
    anchor.operation = parsed.operation;
    anchor.description = parsed.description;
    anchor.partNumber = parsed.partNumber;
    anchor.qty = parsed.qty;
    anchor.price = parsed.price;
    anchor.labor = parsed.labor;
    anchor.paint = parsed.paint;
  }
  anchor.width = Math.max(anchor.width, line.x + line.width - anchor.x);
  anchor.height = Math.max(anchor.height, line.y + line.height - anchor.y);
  const normalized = buildPdfRectFromTopLeftAnchor(anchor, getAnchorPageGeometry(anchor), 0);
  Object.assign(anchor, buildAnchorGeometry(normalized), {
    anchorType: options.forceType ?? anchor.anchorType,
    confidence: Math.max(anchor.confidence, options.asNote ? 0.92 : 0.9),
  });
}

function isNoteContinuation(text: string) {
  return /^\s*(?:note|notes?)\b/i.test(text) || /\b(?:not correct style|available upon request|via this link|see estimate note)\b/i.test(text);
}

function getModelVisibleAnchorText(anchor: EstimateRowAnchor) {
  return [
    anchor.lineNumber ? `Line ${anchor.lineNumber}` : null,
    anchor.section ? `Section ${anchor.section}` : null,
    anchor.operation,
    anchor.description,
    anchor.partNumber ? `Part ${anchor.partNumber}` : null,
    typeof anchor.qty === "number" ? `Qty ${anchor.qty}` : null,
    typeof anchor.price === "number" ? `Price ${normalizeMoney(anchor.price)}` : null,
    typeof anchor.labor === "number" ? `Labor ${anchor.labor}` : null,
    typeof anchor.paint === "number" ? `Paint ${anchor.paint}` : null,
    anchor.noteText ? `Note ${anchor.noteText}` : null,
    anchor.supplierText ? `Supplier ${anchor.supplierText}` : null,
    anchor.anchorType === "totals_row" ? `Totals ${anchor.rowText}` : anchor.rowText,
  ].filter(Boolean).join(" | ");
}

function getAnchorPageGeometry(anchor: EstimateRowAnchor) {
  return {
    pdfWidth: anchor.pageWidth,
    pdfHeight: anchor.pageHeight,
    rotation: anchor.rotation,
  };
}

function buildAnchorGeometry(rect: ReturnType<typeof buildPdfRectFromTopLeftAnchor>) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    xPct: rect.xPct,
    yPct: rect.yPct,
    wPct: rect.wPct,
    hPct: rect.hPct,
    pdfBoundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    pdfQuad: buildTopLeftPdfQuad(rect),
    normalizedUiRect: {
      xPct: rect.xPct,
      yPct: rect.yPct,
      wPct: rect.wPct,
      hPct: rect.hPct,
    },
  };
}

function buildTopLeftPdfQuad(rect: { x: number; y: number; width: number; height: number }): PdfQuad {
  return [
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y,
    rect.x,
    rect.y + rect.height,
    rect.x + rect.width,
    rect.y + rect.height,
  ].map(roundCoordinate) as PdfQuad;
}

function parseEstimateRowFields(text: string, lineNumber: string | null) {
  const withoutLineNumber = lineNumber
    ? text.replace(new RegExp(`^\\s*(?:line\\s*)?${escapeRegex(lineNumber)}\\b\\s*`, "i"), "").trim()
    : text.trim();
  const price = extractLastMoney(withoutLineNumber);
  const numericTokens = extractNumericTokens(withoutLineNumber.replace(/\$[\d,]+(?:\.\d{2})?/g, " "));
  const labor = detectLaborValue(withoutLineNumber, numericTokens);
  const paint = detectPaintValue(withoutLineNumber, numericTokens);
  const qty = detectQuantityValue(withoutLineNumber, numericTokens, labor, paint);
  const partNumber = extractPartNumber(withoutLineNumber);
  const description = withoutLineNumber
    .replace(/\$[\d,]+(?:\.\d{2})?/g, " ")
    .replace(/\b(?:qty|quantity|labor|paint|refinish|hrs?|hours?)\b[:\s]*\d+(?:\.\d+)?/gi, " ")
    .replace(/\b(?:part|part\s*no|part\s*#|pn)\b[:#\s-]*[a-z0-9-]{4,}/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
  return {
    operation: description ? description.split(/\s+/).slice(0, 5).join(" ") : null,
    description,
    partNumber,
    qty,
    price,
    labor,
    paint,
  };
}

function extractLastMoney(value: string): number | null {
  const matches = [...value.matchAll(/\$([\d,]+(?:\.\d{2})?)/g)];
  if (!matches.length) return null;
  return Number(matches[matches.length - 1][1].replace(/,/g, ""));
}

function extractNumericTokens(value: string) {
  return [...value.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => ({
    value: Number(match[0]),
    index: match.index ?? 0,
  }));
}

function detectLaborValue(text: string, tokens: Array<{ value: number; index: number }>) {
  const explicit = text.match(/\b(?:labor|body|mech|frame|structural|hrs?|hours?)\b\D{0,8}(\d+(?:\.\d+)?)/i);
  if (explicit) return Number(explicit[1]);
  if (!/\b(?:scan|calibration|r&i|r\s*&\s*i|repair|replace|refinish|labor|test|aim|initialize|program|mask|sand|polish)\b/i.test(text)) {
    return null;
  }
  return tokens.find((token) => token.value > 0 && token.value < 40)?.value ?? null;
}

function detectPaintValue(text: string, tokens: Array<{ value: number; index: number }>) {
  const explicit = text.match(/\b(?:paint|refinish)\b\D{0,8}(\d+(?:\.\d+)?)/i);
  if (explicit) return Number(explicit[1]);
  if (!/\b(?:paint|refinish|blend|clear coat|mask|jamb|color|sand|polish)\b/i.test(text)) return null;
  return tokens.find((token) => token.value > 0 && token.value < 40)?.value ?? null;
}

function detectQuantityValue(
  text: string,
  tokens: Array<{ value: number; index: number }>,
  labor: number | null,
  paint: number | null
) {
  const explicit = text.match(/\b(?:qty|quantity)\b\D{0,8}(\d+(?:\.\d+)?)/i);
  if (explicit) return Number(explicit[1]);
  if (!/\b(?:part|cover|grille|lamp|bracket|molding|reflector|sensor|bumper|door|panel|lkq|aftermarket|a\/m)\b/i.test(text)) {
    return null;
  }
  const whole = tokens.find((token) =>
    Number.isInteger(token.value) &&
    token.value > 0 &&
    token.value <= 99 &&
    token.value !== labor &&
    token.value !== paint
  );
  return whole?.value ?? null;
}

function extractPartNumber(value: string) {
  const explicit = value.match(/\b(?:part\s*no|part\s*#|pn)\b[:#\s-]*([a-z0-9-]{4,})/i)?.[1];
  if (explicit) return explicit.toUpperCase();
  const standalone = value.match(/\b([A-Z0-9]{2,5}-[A-Z0-9-]{3,})\b/i)?.[1];
  return standalone ? standalone.toUpperCase() : null;
}

export function findBestEstimateRowAnchorForFinding(
  finding: CitationDensityFinding,
  anchors: EstimateRowAnchor[],
  usedAnchors: Set<string>,
  estimateRole: "carrier" | "shop" | "selected"
): EstimateRowAnchor | null {
  let best: { anchor: EstimateRowAnchor; score: number } | null = null;
  for (const anchor of anchors) {
    if (usedAnchors.has(anchor.anchorId)) continue;
    if (estimateRole !== "selected" && anchor.sourceDocumentRole !== estimateRole) continue;
    if (!gateVisibleCitationDensityAnnotation(finding, anchor, estimateRole)) continue;
    const score = scoreRowAnchor(finding, anchor, estimateRole);
    if (score > (best?.score ?? 0)) best = { anchor, score };
  }
  return best && best.score >= 42 ? best.anchor : null;
}

export function gateVisibleCitationDensityAnnotation(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  estimateRole: "carrier" | "shop" | "selected"
) {
  if (!anchor.anchorId || anchor.pageNumber < 1 || anchor.width <= 0 || anchor.height <= 0) return false;
  if (anchor.synthetic) return false;
  if (anchor.confidence < 0.82) return false;
  if (isGenericOrMalformedAnchorText(anchor.rowText)) return false;
  const lineNumber = getTargetLineNumber(finding, estimateRole);
  const evidence = getRoleEvidence(finding, estimateRole);
  const roleAnchor = getRoleAnchor(finding, estimateRole);
  if (roleAnchor?.sourceDocumentId && roleAnchor.sourceDocumentId !== anchor.sourceDocumentId) return false;
  if (roleAnchor?.pageNumber && roleAnchor.pageNumber !== anchor.pageNumber) return false;
  const evidenceText = normalizeMatchText(`${evidence?.description ?? ""} ${finding.operationLabel ?? ""}`);
  const rowText = [anchor.normalizedRowText, anchor.normalizedNoteText, anchor.normalizedSupplierText].filter(Boolean).join(" ");
  if (lineNumber) {
    if (anchor.lineNumber !== String(lineNumber).trim()) return false;
    return (
      sharedTermScore(evidenceText, rowText, 10) >= 4 ||
      keyTokenScore(evidenceText, rowText, 10) >= 4 ||
      (typeof evidence?.amount === "number" && rowText.includes(normalizeMoney(evidence.amount))) ||
      (typeof evidence?.laborHours === "number" && rowText.includes(String(evidence.laborHours)))
    );
  }
  if (anchor.anchorType === "totals_row") {
    return /total|rate|paint|material|labor|net cost/.test(evidenceText) && /total|rate|paint|material|labor|net cost/.test(rowText);
  }
  if (anchor.anchorType === "supplier_row") {
    return /supplier|alternate|aftermarket|lkq|used|capa|part/.test(evidenceText) && /supplier|alternate|aftermarket|lkq|used|capa|part/.test(rowText);
  }
  if (anchor.anchorType === "embedded_link_row") {
    return /link|url|report|available|referenced|adas|oem|procedure|egnyte/.test(evidenceText) &&
      /https?|www|link|url|report|available|referenced|egnyte|revv/.test(rowText);
  }
  if (anchor.anchorType === "guide_row") {
    return /ccc|motor|guide|p page|included|not included|database|deg/.test(evidenceText) &&
      /ccc|motor|guide|p page|included|not included|database|deg/.test(rowText);
  }
  if (anchor.anchorType === "section_row") {
    return Boolean(getTargetSection(finding, estimateRole)) && sharedTermScore(getTargetSection(finding, estimateRole) ?? "", rowText, 10) >= 5;
  }
  if (
    typeof evidence?.amount === "number" &&
    rowText.includes(normalizeMoney(evidence.amount)) &&
    keyTokenScore(evidenceText, rowText, 10) >= 2
  ) {
    return true;
  }
  if (
    typeof evidence?.laborHours === "number" &&
    rowText.includes(String(evidence.laborHours)) &&
    keyTokenScore(evidenceText, rowText, 10) >= 2
  ) {
    return true;
  }
  return sharedTermScore(evidenceText, rowText, 10) >= 4;
}

function scoreRowAnchor(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const evidence = getRoleEvidence(finding, estimateRole);
  const anchorText = [anchor.normalizedRowText, anchor.normalizedNoteText, anchor.normalizedSupplierText].filter(Boolean).join(" ");
  let score = 0;
  if (evidence?.lineNumber && anchor.lineNumber === String(evidence.lineNumber).trim()) score += 130;
  if (evidence?.description) {
    const description = normalizeMatchText(evidence.description);
    if (description && (anchorText.includes(description) || description.includes(anchorText))) score += 80;
    score += sharedTermScore(description, anchorText, 42);
    score += keyTokenScore(description, anchorText, 34);
  }
  if (typeof evidence?.amount === "number" && anchorText.includes(normalizeMoney(evidence.amount))) score += 18;
  if (typeof evidence?.laborHours === "number" && anchorText.includes(String(evidence.laborHours))) score += 14;
  const operation = normalizeMatchText(finding.operationLabel);
  score += sharedTermScore(operation, anchorText, 32);
  score += keyTokenScore(operation, anchorText, 36);
  if (anchor.anchorType === "totals_row" && /total|rate|paint|material|labor|net cost/.test(`${operation} ${normalizeMatchText(evidence?.description ?? "")}`)) score += 42;
  if (anchor.anchorType === "supplier_row" && /supplier|alternate|aftermarket|lkq|part/.test(`${operation} ${normalizeMatchText(evidence?.description ?? "")}`)) score += 42;
  if (anchor.anchorType === "embedded_link_row" && /link|url|report|available|referenced|egnyte|revv/.test(`${operation} ${normalizeMatchText(evidence?.description ?? "")}`)) score += 42;
  if (anchor.anchorType === "guide_row" && /ccc|motor|guide|p page|included|not included|database|deg/.test(`${operation} ${normalizeMatchText(evidence?.description ?? "")}`)) score += 38;
  return score;
}

function getRoleEvidence(finding: CitationDensityFinding, estimateRole: "carrier" | "shop" | "selected") {
  if (estimateRole === "shop") return finding.shopEvidence ?? finding.shopAnchor;
  if (estimateRole === "carrier") return finding.carrierEvidence ?? finding.carrierAnchor;
  return finding.carrierEvidence ?? finding.carrierAnchor ?? finding.shopEvidence ?? finding.shopAnchor;
}

function getRoleAnchor(finding: CitationDensityFinding, estimateRole: "carrier" | "shop" | "selected") {
  if (estimateRole === "shop") return finding.shopAnchor;
  if (estimateRole === "carrier") return finding.carrierAnchor;
  return finding.carrierAnchor ?? finding.shopAnchor;
}

function getTargetLineNumber(finding: CitationDensityFinding, estimateRole: "carrier" | "shop" | "selected") {
  const evidence = getRoleEvidence(finding, estimateRole);
  return evidence?.lineNumber ? String(evidence.lineNumber).trim() : undefined;
}

function getTargetSection(finding: CitationDensityFinding, estimateRole: "carrier" | "shop" | "selected") {
  const anchor = estimateRole === "shop"
    ? finding.shopAnchor
    : estimateRole === "carrier"
      ? finding.carrierAnchor
      : finding.carrierAnchor ?? finding.shopAnchor;
  return anchor?.section || undefined;
}

function classifyLine(
  text: string,
  lineNumber: string | null,
  sectionName: string | null,
  currentSection: string
): EstimateRowAnchorType | null {
  const normalized = normalizeMatchText(text);
  if (detectGuideRow(text)) return "guide_row";
  if (detectEmbeddedLinkRow(text)) return "embedded_link_row";
  if (
    lineNumber &&
    (/\b(?:suppliers?|alternate parts suppliers?)\b/.test(normalizeMatchText(currentSection)) ||
      /\b(?:suppliers?|alternate parts suppliers?|alternate suppliers?)\b/.test(normalized))
  ) return "supplier_row";
  if (lineNumber) return /note|available|not correct|report/.test(normalized) ? "line_note" : "estimate_line";
  if (isTotalsRow(normalized, currentSection)) return "totals_row";
  if (/\bsupplier|alternate|aftermarket|lkq|used part|capa\b/.test(`${normalized} ${normalizeMatchText(currentSection)}`)) return "supplier_row";
  if (sectionName) return "section_row";
  if (/\bnote|available upon request|not correct|report\b/.test(normalized)) return "line_note";
  return null;
}

function isTotalsRow(normalized: string, currentSection: string) {
  const section = normalizeMatchText(currentSection);
  if (/\btotal|subtotal|net cost|grand total|paint supplies|paint materials|body labor|paint labor|labor rate|total cost of repairs|net cost of repairs\b/.test(normalized)) {
    return true;
  }
  if (/\bestimate totals?\b/.test(section)) {
    return /\b(?:parts|body labor|paint labor|paint supplies|total cost of repairs|net cost of repairs|sales tax|deductible)\b/.test(normalized) &&
      /(?:\$?\d[\d,.]*|\d+(?:\.\d+)?\s*(?:hrs?|@))/.test(normalized);
  }
  return false;
}

function detectEmbeddedLinkRow(text: string) {
  return /\b(?:https?:\/\/|www\.|via this link|link available|available upon request|referenced link|egnyte|revv\s*adas|revvadas|adas report|oe docs)\b/i.test(text);
}

function detectGuideRow(text: string) {
  const normalized = normalizeMatchText(text);
  return /\b(?:ccc|motor|guide|p pages?|included|not included|database|estimating guide|procedure pages?|deg)\b/.test(normalized) &&
    /\b(?:guide|database|included|not included|p pages?|deg|motor|ccc)\b/.test(normalized);
}

function extractLineNumber(text: string) {
  return text.match(/^\s*(?:line\s*)?(\d{1,4})\b/i)?.[1] ?? null;
}

function detectSection(text: string) {
  const normalized = normalizeMatchText(text);
  const match = normalized.match(/^(front bumper|grille|radiator support|fender|electrical|windshield|vehicle diagnostics|miscellaneous operations|estimate totals?|supplement summary|alternate parts suppliers?|parts|body|paint|refinish|diagnostics?|calibration|totals?|summary|ccc|motor|p pages|included|not included)\b/);
  return match?.[1] ?? null;
}

function mergeContinuationLines(lines: string[]) {
  const merged: string[] = [];
  for (const line of lines) {
    const startsEstimateRow = /^\s*(?:line\s*)?\d{1,4}\b/i.test(line);
    const startsSection = Boolean(detectSection(line));
    if (!merged.length || startsEstimateRow || startsSection) {
      merged.push(line);
      continue;
    }
    if (/\b(?:note|available|via this link|not correct|supplier|guide|database|included|not included|paint materials?|labor|total|report)\b/i.test(line)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function splitStoredTextIntoPages(text: string, pageCount: number) {
  const formFeedPages = text.split(/\f/).map((page) => page.trim());
  if (formFeedPages.length > 1) return padPages(formFeedPages, pageCount);
  const markerPages = text
    .split(/\n\s*(?:-{2,}\s*)?(?:page|pg)\s+\d+(?:\s+of\s+\d+)?\s*(?:-{2,})?\s*\n/gi)
    .map((page) => page.trim())
    .filter(Boolean);
  if (markerPages.length > 1) return padPages(markerPages, pageCount);
  return distributeLinesAcrossPages(text, pageCount);
}

function padPages(pages: string[], pageCount: number) {
  if (pages.length >= pageCount) return pages.slice(0, pageCount);
  return [...pages, ...Array.from({ length: pageCount - pages.length }, () => "")];
}

function distributeLinesAcrossPages(text: string, pageCount: number) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (pageCount <= 1 || lines.length <= 1) return [text];
  const perPage = Math.ceil(lines.length / pageCount);
  return Array.from({ length: pageCount }, (_, index) =>
    lines.slice(index * perPage, (index + 1) * perPage).join("\n")
  );
}

function isGenericOrMalformedAnchorText(value: string): boolean {
  return (
    /^\s*(?:repair operation|proc report|comparison or screenshot cues)\s*$/i.test(value) ||
    /\bproc\s+(?:pre|post)[-\s]?repair scanm\b/i.test(value) ||
    /\b(?:citation density gap report|annotation legend|unanchored citation density|disclosure|privacy|estimate summary only|disclaimer|abbreviations?)\b/i.test(value)
  );
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\ba\/m\b/g, " aftermarket ")
    .replace(/\bnon[-\s]?oem\b/g, " non oem ")
    .replace(/[^a-z0-9.$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMoney(value: number) {
  return String(Math.round(value * 100) / 100).replace(/\.00$/, "");
}

function sharedTermScore(a: string, b: string, max: number) {
  const terms = a.split(" ")
    .map(canonicalMatchToken)
    .filter((term) => term.length > 2 && !/^\d+$/.test(term) && !COMMON_MATCH_TERMS.has(term));
  if (!terms.length) return 0;
  const haystack = new Set(b.split(" ").map(canonicalMatchToken));
  const matches = terms.filter((term) => haystack.has(term) || b.includes(term)).length;
  return Math.min(max, Math.round((matches / terms.length) * max));
}

function keyTokenScore(a: string, b: string, max: number) {
  const sourceTokens = buildKeyTokens(a);
  if (!sourceTokens.size) return 0;
  const targetTokens = buildKeyTokens(b);
  const targetList = [...targetTokens];
  const matches = [...sourceTokens].filter((token) =>
    targetTokens.has(token) ||
    targetList.some((target) => token.length > 4 && (target.includes(token) || token.includes(target)))
  ).length;
  return Math.min(max, Math.round((matches / sourceTokens.size) * max));
}

function buildKeyTokens(value: string) {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .map(canonicalMatchToken)
      .filter((term) => term.length > 2 && !/^\d+$/.test(term) && !COMMON_MATCH_TERMS.has(term))
  );
}

function canonicalMatchToken(value: string) {
  const token = value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!token) return "";
  const directAlias: Record<string, string> = {
    a: "",
    m: "",
    am: "aftermarket",
    scanm: "scan",
    spre: "pre",
    spost: "post",
    proc: "",
    hrs: "hours",
    lt: "left",
    rt: "right",
  };
  if (directAlias[token] !== undefined) return directAlias[token];
  return token.replace(/s$/, "");
}

const COMMON_MATCH_TERMS = new Set([
  "line",
  "item",
  "estimate",
  "carrier",
  "shop",
  "proof",
  "needed",
  "needs",
  "support",
  "current",
  "missing",
  "action",
  "attach",
  "procedure",
  "invoice",
  "present",
]);

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PDFDocument, PDFDict as PdfLibDict } from "pdf-lib";
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
  /** U-4: false when the document uses non-embedded fonts or fonts without a
   * ToUnicode map — the reflowed text stream is then untrustworthy
   * (glyph-shift artifacts like "R&I"→"R8d"). NOT the same as "scanned":
   * the text layer is live, its encoding is broken. */
  textLayerReliable?: boolean;
  textLayerUnreliableReason?: string;
};

/**
 * Inspect the document's font dictionaries (U-4): a font with no embedded
 * FontFile and no ToUnicode map produces a reflowed text stream that cannot
 * be trusted (the PeerNet/image-printer class of producer). Checked
 * structurally from the PDF object graph — never inferred from text content.
 *
 * "No ToUnicode" is NOT on its own a broken encoding. A simple font that
 * declares a well-known base encoding (WinAnsi/MacRoman/Standard/MacExpert)
 * carries the code→character mapping in the encoding itself, so its text
 * reflows correctly whether or not the program is embedded. RO 22140's SOR-2
 * is exactly this shape — non-embedded /ArialMT and /Arial-BoldMT under
 * /WinAnsiEncoding — and reading it as unreliable capped extraction
 * confidence at 0.45, pushed a cleanly-parseable document into the
 * glyph-repair fallback, and suppressed its delta marks at 24% coverage. The
 * fallback produced the bad parse; the document was fine.
 *
 * Composite (Type0) fonts stay unreliable without a ToUnicode map: under
 * Identity-H the codes are glyph indices into a program that is not present,
 * so nothing defines what character a code means.
 */
export async function assessPdfTextLayerReliability(bytes: Uint8Array): Promise<{
  reliable: boolean;
  reason?: string;
}> {
  try {
    const { PDFDocument, PDFName, PDFDict, PDFArray } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false });
    let sawFont = false;
    const unreliableFonts: string[] = [];
    const descriptorHasFontFile = (fontDict: PdfLibDict): boolean => {
      const descriptor = fontDict.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
      return Boolean(
        descriptor &&
          (descriptor.has(PDFName.of("FontFile")) ||
            descriptor.has(PDFName.of("FontFile2")) ||
            descriptor.has(PDFName.of("FontFile3")))
      );
    };
    // Encodings that DEFINE a code→character mapping on their own. A font
    // using one of these needs no ToUnicode map to decode.
    const knownBaseEncodings = new Set([
      "/WinAnsiEncoding",
      "/MacRomanEncoding",
      "/StandardEncoding",
      "/MacExpertEncoding",
    ]);
    // Subset/glyph-index names in a /Differences array (/g17, /index42,
    // /cid9) name a glyph in a program we do not have, so they carry no
    // character meaning even under a known base encoding.
    const opaqueGlyphName = /^\/(?:g|glyph|index|cid)\d+$/i;
    const encodingDefinesCharacters = (fontDict: PdfLibDict): boolean => {
      const subtype = String(fontDict.lookupMaybe(PDFName.of("Subtype"), PDFName) ?? "");
      // Type0/Identity-H maps codes to glyph indices, not characters.
      if (subtype === "/Type0") return false;
      const encoding = fontDict.lookup(PDFName.of("Encoding"));
      if (!encoding) return false;
      if (encoding instanceof PDFName) return knownBaseEncodings.has(String(encoding));
      if (encoding instanceof PDFDict) {
        const base = encoding.lookupMaybe(PDFName.of("BaseEncoding"), PDFName);
        if (!base || !knownBaseEncodings.has(String(base))) return false;
        const differences = encoding.lookupMaybe(PDFName.of("Differences"), PDFArray);
        if (differences) {
          for (let index = 0; index < differences.size(); index += 1) {
            const entry = differences.lookup(index);
            if (entry instanceof PDFName && opaqueGlyphName.test(String(entry))) return false;
          }
        }
        return true;
      }
      return false;
    };
    for (const page of doc.getPages()) {
      const resources = page.node.Resources();
      const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
      if (!fonts) continue;
      for (const key of fonts.keys()) {
        const font = fonts.lookupMaybe(key, PDFDict);
        if (!font) continue;
        sawFont = true;
        const baseFont = String(font.lookupMaybe(PDFName.of("BaseFont"), PDFName) ?? "unknown");
        if (font.has(PDFName.of("ToUnicode"))) continue; // decodable regardless of embedding
        // The standard-14 base fonts carry a WELL-KNOWN encoding by
        // definition — no FontFile and no ToUnicode is their normal state,
        // not a broken producer.
        if (/^\/?(?:Helvetica|Times|Courier|Symbol|ZapfDingbats)/.test(baseFont)) continue;
        // A declared base encoding decodes the text stream by itself; only
        // reach the embedding test when nothing defines the mapping.
        if (encodingDefinesCharacters(font)) continue;
        let embedded = descriptorHasFontFile(font);
        if (!embedded) {
          // Composite (Type0) fonts carry the descriptor on descendant fonts.
          const descendants = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
          if (descendants) {
            for (let index = 0; index < descendants.size(); index += 1) {
              const descendant = descendants.lookupMaybe(index, PDFDict);
              if (descendant && descriptorHasFontFile(descendant)) embedded = true;
            }
          }
        }
        if (!embedded && !unreliableFonts.includes(baseFont)) unreliableFonts.push(baseFont);
      }
    }
    if (!sawFont) return { reliable: true };
    if (unreliableFonts.length) {
      return {
        reliable: false,
        reason: `non-embedded font(s) with no ToUnicode map and no defined encoding: ${unreliableFonts.slice(0, 4).join(", ")}`,
      };
    }
    return { reliable: true };
  } catch {
    // Reliability assessment is advisory — never block extraction on it.
    return { reliable: true };
  }
}

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

  // U-4: structural text-layer reliability check — non-embedded fonts with no
  // ToUnicode map mean the reflowed text stream cannot be trusted; the
  // measured word layer (coordinates) is still extracted, the flag rides in
  // diagnostics so downstream repair and reporting can attribute a low match
  // rate to the broken encoding.
  const reliability = await assessPdfTextLayerReliability(bytes);
  if (!reliability.reliable) {
    warnings.push(`text_layer: unreliable — ${reliability.reason ?? "broken font encoding"}`);
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
        textLayerReliable: reliability.reliable,
        textLayerUnreliableReason: reliability.reason,
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
      textLayerReliable: reliability.reliable,
      textLayerUnreliableReason: reliability.reason,
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

const PDFJS_WORKER_SUBPATH = path.join("pdfjs-dist", "legacy", "build", "pdf.worker.mjs");

// Resolve the PDF.js Node worker by locating it under node_modules directly, rather than via
// createRequire(__filename). webpack cannot statically analyze createRequire's dynamic argument,
// so it warned ("module.createRequire failed parsing argument") and stubbed node:module — leaving
// the resolver undefined at runtime. Walking up from cwd (and this module) matches the path that
// next.config `outputFileTracingIncludes` already traces into the deployment, with no bundler
// static-analysis hazard.
function findPdfJsWorkerPath(): string | null {
  const roots = [
    process.cwd(),
    // Walk up from this module's directory to cover monorepo / hoisted layouts.
    ...moduleAncestorDirectories(),
  ];
  for (const root of roots) {
    const candidate = path.join(root, "node_modules", PDFJS_WORKER_SUBPATH);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function moduleAncestorDirectories(): string[] {
  const dirs: string[] = [];
  try {
    let current = typeof __dirname === "string" ? __dirname : process.cwd();
    for (let depth = 0; depth < 8; depth += 1) {
      dirs.push(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // __dirname unavailable — cwd already covers the common case.
  }
  return dirs;
}

export function resolvePdfJsNodeWorker() {
  try {
    const workerPath = findPdfJsWorkerPath();
    if (!workerPath) {
      return {
        pdfWorkerResolvedPath: undefined,
        pdfWorkerExists: false,
        pdfWorkerSrc: undefined,
        pdfjsImportMode: undefined,
        workerResolutionAttempted: true,
        workerResolutionSucceeded: false,
        workerResolutionError: `PDF.js worker file not found under any node_modules root for ${PDFJS_WORKER_SUBPATH}`,
      };
    }
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

/**
 * U-5: the TABLE REGION of each page, measured geometrically — the y-range
 * between the column-header row (Line/Oper/… or Qty/Extended headers) and
 * the SUBTOTALS rule. Text outside the region is never an operation row,
 * never anchorable, and never contributes row text — headers, footers,
 * disclaimers, and cover-page prose are excluded by construction instead of
 * by per-symptom patches.
 */
function measureTableRegions(lines: PdfTextLine[]): Map<number, { top: number; bottom: number }> {
  const regions = new Map<number, { top: number; bottom: number }>();
  const byPage = new Map<number, PdfTextLine[]>();
  for (const line of lines) {
    const list = byPage.get(line.pageNumber) ?? [];
    if (!list.length) byPage.set(line.pageNumber, list);
    list.push(line);
  }
  // Some producers print the column header ONCE (RO 22182 style) while others
  // repeat it per page (CCC default). A header establishes the table top for
  // its page AND carries to following pages — the table runs until the
  // SUBTOTALS rule — so continuation pages keep their region instead of
  // losing every anchor.
  const FOOTER_MARGIN = 40;
  // Footer chrome is detected GEOMETRICALLY: a line position that repeats at
  // the same y (±4pt) on 3+ pages in the bottom fifth of the page is page
  // chrome, never table content — no date/Page-N text test involved.
  const bottomBandPages = new Map<number, Set<number>>();
  for (const [pageNumber, pageLines] of byPage) {
    for (const line of pageLines) {
      if (line.y < line.pageHeight * 0.8) continue;
      const bucket = Math.round(line.y / 8);
      const pages = bottomBandPages.get(bucket) ?? new Set<number>();
      if (!pages.size) bottomBandPages.set(bucket, pages);
      pages.add(pageNumber);
    }
  }
  const footerBuckets = [...bottomBandPages.entries()].filter(([, pages]) => pages.size >= 3).map(([bucket]) => bucket);
  const footerTopY = footerBuckets.length ? Math.min(...footerBuckets) * 8 - 4 : null;
  let carriedTop: number | null = null;
  for (const pageNumber of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageLines = byPage.get(pageNumber)!;
    const pageHeight = pageLines[0]?.pageHeight ?? 792;
    const header = pageLines
      .filter(
        (line) =>
          (/\bLine\b/.test(line.text) && /\bOper\b/i.test(line.text) && /\bDescription\b/i.test(line.text)) ||
          (/\bQty\b/.test(line.text) && /\bExtended\b/i.test(line.text))
      )
      .sort((a, b) => a.y - b.y)[0];
    if (header) carriedTop = header.y + header.height;
    if (carriedTop === null) continue; // pages before any header: no region
    const top = header ? header.y + header.height : carriedTop;
    const subtotals = pageLines
      .filter((line) => /\bSUBTOTALS\b/i.test(line.text) && line.y > top)
      .sort((a, b) => a.y - b.y)[0];
    const chromeBottom = Math.min(
      pageHeight - FOOTER_MARGIN,
      footerTopY !== null && footerTopY > top ? footerTopY - 2 : pageHeight - FOOTER_MARGIN
    );
    regions.set(pageNumber, {
      top,
      bottom: Math.min(subtotals ? subtotals.y + subtotals.height : chromeBottom, chromeBottom),
    });
    // On per-page-header producers the next header re-establishes the top; on
    // print-once producers the SUBTOTALS rule ends the table for good.
    if (subtotals && !header) carriedTop = null;
    if (subtotals && header) carriedTop = header.y + header.height; // per-page style continues
  }
  return regions;
}

export function buildEstimateRowAnchorsFromLines(lines: PdfTextLine[], options: BuildOptions): EstimateRowAnchor[] {
  const anchors: EstimateRowAnchor[] = [];
  let section = "";
  let previousEstimateRow: EstimateRowAnchor | null = null;
  /** True when the previous line was NOTE payload — its wrapped continuation
   * belongs to the note, never to the row description. */
  let lastWasNoteLine: boolean = false;
  const tableRegions = measureTableRegions(lines);

  for (const line of [...lines].sort((a, b) => a.pageNumber - b.pageNumber || a.y - b.y || a.x - b.x)) {
    if (isGenericOrMalformedAnchorText(line.text)) continue;
    const lineNumber = extractLineNumber(line.text);
    const sectionName = detectSection(line.text);
    let type = classifyLine(line.text, lineNumber, sectionName, section);
    // The running section may only advance on a header that sits INSIDE the
    // measured table region. Cover-page all-caps text ("DORSEY, DAVID",
    // "PHILADELPHIA") has header shape but is not a header, and every row
    // below it would inherit the wrong section. Same geometric gate the
    // operation anchors use.
    if (sectionName) {
      // Gated to pages that HAVE a line-item table. A cover page carries
      // all-caps text with header shape ("DORSEY, DAVID", "PHILADELPHIA")
      // that is not a header, and every row below it would inherit it. The
      // gate is per PAGE, not per region: the ESTIMATE TOTALS header sits
      // below the SUBTOTALS rule, outside the table region but on a real
      // line-item page, and it is a genuine section — excluding it stripped
      // the totals rows of their anchors and pushed the grand-total gap into
      // the unanchored appendix.
      if (tableRegions.size === 0 || tableRegions.has(line.pageNumber)) section = sectionName;
    }
    // U-5 geometric gate: on documents where a table region is measurable,
    // operation-type anchors may only exist INSIDE a region. A line-numbered
    // string on a cover page ("4 Wheel Drive…" options prose stealing line 4)
    // or below the SUBTOTALS rule is structurally non-anchorable.
    if (
      tableRegions.size > 0 &&
      (type === "estimate_line" || type === "line_note" || type === "embedded_link_row")
    ) {
      const region = tableRegions.get(line.pageNumber);
      const inRegion = region ? line.y >= region.top - 2 && line.y <= region.bottom + 2 : false;
      if (!inRegion) type = "guide_row";
    }

    if (!lineNumber && previousEstimateRow && line.pageNumber === previousEstimateRow.pageNumber && shouldAttachContinuationLine(line, type)) {
      // A NOTE wraps. Its second line carries no "Note:" prefix of its own
      // ("Note: PARTS: … LABOR:" / "Time includes R&R grommets and gasket."),
      // so testing that line in isolation reads it as row description and the
      // note bleeds into the operation's identity — RO 22182 line 151 read
      // "LT Tail lamp assy Time includes R&R grommets and gasket." Anything
      // continuing a line that was itself note payload is note payload.
      const asNote: boolean = lastWasNoteLine || type === "line_note" || isNoteContinuation(line.text);
      attachContinuationLine(previousEstimateRow, line, {
        asNote,
        forceType: detectEmbeddedLinkRow(line.text) ? "embedded_link_row" : undefined,
      });
      lastWasNoteLine = asNote;
      continue;
    }
    lastWasNoteLine = type === "line_note" || isNoteContinuation(line.text);

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

/**
 * Build an estimate-row anchor directly from the typed delta engine's MEASURED
 * row bbox (top-left origin PDF points). Used when the visual-line layer
 * failed to produce a text anchor for a row the engine parsed cleanly (a row
 * split across visual lines, or its line number stolen by adjacent prose like
 * a "4 Wheel Drive…" options paragraph). The geometry is measured, not
 * guessed, so the anchor is NOT synthetic in the fuzzy-text sense.
 */
export function buildMeasuredEngineRowAnchor(params: {
  sourceDocumentId?: string;
  sourceDocumentRole: SourceDocumentRole;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  lineNumber: number;
  rowText: string;
  section?: string;
  box: { x0: number; x1: number; top: number; bottom: number };
}): EstimateRowAnchor {
  const line = {
    pageNumber: params.pageNumber,
    text: params.rowText,
    normalizedText: normalizeMatchText(params.rowText),
    x: params.box.x0,
    y: params.box.top,
    width: Math.max(4, params.box.x1 - params.box.x0),
    height: Math.max(4, params.box.bottom - params.box.top),
    pageWidth: params.pageWidth,
    pageHeight: params.pageHeight,
  };
  const rect = buildPdfRectFromTopLeftAnchor(line, {
    pdfWidth: params.pageWidth,
    pdfHeight: params.pageHeight,
    rotation: 0,
  }, 2);
  const geometry = buildAnchorGeometry(rect);
  const parsed = parseEstimateRowFields(params.rowText, String(params.lineNumber));
  return {
    anchorId: `${params.sourceDocumentId ?? `${params.sourceDocumentRole}-estimate`}:p${params.pageNumber}:${params.lineNumber}:engine_row`,
    sourceDocumentId: params.sourceDocumentId ?? `${params.sourceDocumentRole}-estimate`,
    sourceDocumentRole: params.sourceDocumentRole,
    pageNumber: params.pageNumber,
    pageWidth: params.pageWidth,
    pageHeight: params.pageHeight,
    rotation: 0,
    lineNumber: String(params.lineNumber),
    section: params.section,
    rowText: params.rowText,
    normalizedRowText: line.normalizedText,
    anchorType: "estimate_line",
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
    confidence: 0.9,
  };
}

function shouldAttachContinuationLine(line: PdfTextLine, type: EstimateRowAnchorType | null) {
  if (type === "section_row" || type === "totals_row" || type === "supplier_row" || type === "guide_row") return false;
  if (type === "line_note" || type === "embedded_link_row") return true;
  if (detectSection(line.text)) return false;
  if (isGenericOrMalformedAnchorText(line.text)) return false;
  const normalized = normalizeMatchText(line.text);
  if (!normalized) return false;
  if (/^\d{1,4}\b/.test(normalized)) return false;
  // End-of-table boundary: the last estimate row must never absorb the totals
  // header or the page's trailing prose ("Category Basis Rate Cost $ This
  // estimate is based on our initial visual inspection…") — a badge anchored
  // to that row would render inside the disclaimer paragraph.
  if (/\bcategory\s+basis\s+rate\b/i.test(line.text)) return false;
  if (/\bsubtotals?\b/i.test(normalized) && /\btotals?\b/.test(normalized)) return false;
  const wordCount = line.text.trim().split(/\s+/).length;
  if (wordCount >= 10 && /[.!?]\s*$/.test(line.text.trim())) return false; // full prose sentence
  if (wordCount >= 14) return false; // running paragraph, not a wrapped cell fragment
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
  if (detectGuideRow(text) && !isNumberedOperationRow(text)) return "guide_row";
  if (detectEmbeddedLinkRow(text)) return "embedded_link_row";
  if (
    lineNumber &&
    (/\b(?:suppliers?|alternate parts suppliers?)\b/.test(normalizeMatchText(currentSection)) ||
      /\b(?:suppliers?|alternate parts suppliers?|alternate suppliers?)\b/.test(normalized))
  ) return "supplier_row";
  if (lineNumber) {
    // U-5 shape rule (shared below BOTH detectors): a line-numbered ALL-CAPS
    // row with no lowercase and no value digits is a numbered SECTION HEADER
    // ("30 SIDE PANEL", "73 REAR BUMPER") — never an operation row. Anchoring
    // a finding there was the D-7 defect class.
    const afterNumber = text.replace(/^\s*\d{1,4}\s*/, "").trim();
    if (
      afterNumber.length > 0 &&
      afterNumber.length < 40 &&
      !/[a-z0-9]/.test(afterNumber) &&
      /[A-Z]/.test(afterNumber)
    ) {
      return "section_row";
    }
    return /note|available|not correct|report/.test(normalized) ? "line_note" : "estimate_line";
  }
  if (isTotalsRow(normalized, currentSection, text)) return "totals_row";
  if (/\bsupplier|alternate|aftermarket|lkq|used part|capa\b/.test(`${normalized} ${normalizeMatchText(currentSection)}`)) return "supplier_row";
  if (sectionName) return "section_row";
  if (/\bnote|available upon request|not correct|report\b/.test(normalized)) return "line_note";
  return null;
}

function isTotalsRow(normalized: string, currentSection: string, rawText = "") {
  // Abbreviation-legend lines ("LABOR D=DIAGNOSTIC E=ELECTRICAL …",
  // "M=Mechanical labor category.") carry category names but are boilerplate;
  // anchoring a totals finding there renders it on a legal page. Real totals
  // rows never carry "=" pairs.
  if ((rawText.match(/=/g) ?? []).length >= 2) return false;
  if (/\blabor category\b|\blabor categories\b/.test(normalized)) return false;
  const section = normalizeMatchText(currentSection);
  if (/\btotal|subtotal|net cost|grand total|paint supplies|paint materials|body labor|paint labor|labor rate|total cost of repairs|net cost of repairs\b/.test(normalized)) {
    return true;
  }
  if (/\bestimate totals?\b/.test(section)) {
    // Every rate/hours category row must anchor — the RO 22108 totals block
    // skipped Mechanical Labor, Aluminum Or Steel Repair, and Miscellaneous,
    // so their totals-delta findings had no row to land on.
    return (
      /\b(?:parts|body labor|paint labor|paint supplies|mechanical labor|diagnostic labor|electrical labor|structural labor|frame labor|glass labor|aluminum|miscellaneous|total cost of repairs|net cost of repairs|sales tax|deductible)\b/.test(normalized) ||
      /\d(?:\.\d+)?\s*hrs?\s*@/.test(normalized)
    ) &&
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

/**
 * A numbered CCC operation row — a leading line number followed by an op code.
 * Guide detection must never claim these: "85 R&I LT Window guide 0.3" and
 * "135 Repl Nameplate \"DUAL MOTOR\" …" are real estimate lines whose
 * descriptions merely contain a guide-ish word; classifying them as guide_row
 * dropped them from the anchor set, and the Delta report then reported their
 * lower-estimate twins as false lower-only lines (RO 22108).
 */
function isNumberedOperationRow(text: string) {
  return /^\s*\d{1,4}\s*[*#]?\s*(?:S0[0-9IlLoO]\s*)?(?:R\s*&\s*I|R&R|Repl|Rpr|Blnd|Subl|Refn|Algn|Add|O\/H|Overlap)\b/i.test(
    (text ?? "").trim()
  );
}

function extractLineNumber(text: string) {
  return text.match(/^\s*(?:line\s*)?(\d{1,4})\b/i)?.[1] ?? null;
}

function detectSection(text: string) {
  // A section header is recognized by SHAPE, never by name.
  //
  // Matching against a closed vocabulary of header names is the same class of
  // defect as hardcoding a column position. The RO 22182 Tesla pair prints
  // QUARTER PANEL, PILLARS ROCKER & FLOOR, REAR LAMPS, TRUNK LID and SEATS &
  // TRACKS — none of them on any list — so every row from line 17 through
  // line 200 inherited the one header that WAS listed, WINDSHIELD, and 54
  // findings named a part of the vehicle nowhere near the damage.
  //
  // The shape: all-caps body text with no value digits, in the description
  // column. A lowercase start is wrapped row prose ("calibration procedure"
  // continuing a camera row) and a digit-bearing line is a totals/value row
  // ("Parts4,473.91") — neither may become the running section, because every
  // following row inherits it.
  const body = (text ?? "").trim().replace(/^\d{1,4}\s*/, "").trim();
  if (!/^[A-Z]/.test(body) || /\d/.test(body)) return null;
  if (body.length < 3 || body.length > 48) return null;
  if (SECTION_DISQUALIFYING_OPERATION.test(body)) return null;
  // ALL CAPS. Every estimating platform prints section headers in caps, and a
  // mixed-case rule cannot tell a heading from a wrapped description word: the
  // RO 22182 shop estimate wraps "BetaPrime 5504G All-in-One" onto a second
  // line reading just "Primer", which then became a section and captured
  // every row beneath it.
  if (/[a-z]/.test(body)) return null;
  if (!/^[A-Z][A-Z &/,.'()-]*[A-Z)]$/.test(body)) return null;
  return normalizeMatchText(body) || null;
}

/** An operation token opens a row, never a heading. */
const SECTION_DISQUALIFYING_OPERATION =
  /^(?:R\s*&\s*[IR]|Rpr|Repl|Blnd|Refn|Subl|Algn|Add|O\/H|Overlap|Incl|Note)\b/i;

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
    /\b(?:citation density gap report|annotation legend|unanchored citation density|disclosure|privacy|estimate summary only|disclaimer|abbreviations?|fraud notice|generic estimate disclaimers?|legal notices?|work authorization|allstate parts policy|alternate parts policy|quality replacement parts|vehicle equipment list|policy declarations?|headers?|footers?)\b/i.test(value)
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

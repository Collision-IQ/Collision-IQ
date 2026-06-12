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
  anchorType: "estimate_line" | "line_note" | "supplier_row" | "totals_row" | "section_row";
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
  const words = await extractPdfWords(bytes);
  return buildEstimateRowAnchorsFromLines(buildPdfTextLines(words), options);
}

export async function extractPdfWords(bytes: Uint8Array): Promise<PdfWord[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    useSystemFonts: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await loadingTask.promise;
  const words: PdfWord[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const text = item.str.replace(/\s+/g, " ").trim();
      if (!text) continue;
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
  }

  return words;
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

    if (type === "line_note" && !lineNumber && previousEstimateRow && line.pageNumber === previousEstimateRow.pageNumber) {
      previousEstimateRow.noteText = `${previousEstimateRow.noteText ? `${previousEstimateRow.noteText} ` : ""}${line.text}`;
      previousEstimateRow.normalizedNoteText = normalizeMatchText(previousEstimateRow.noteText);
      previousEstimateRow.height = Math.max(previousEstimateRow.height, line.y + line.height - previousEstimateRow.y);
      const normalized = buildPdfRectFromTopLeftAnchor(previousEstimateRow, {
        pdfWidth: previousEstimateRow.pageWidth,
        pdfHeight: previousEstimateRow.pageHeight,
        rotation: previousEstimateRow.rotation,
      }, 0);
      Object.assign(previousEstimateRow, normalized, { anchorType: "line_note", confidence: Math.max(previousEstimateRow.confidence, 0.92) });
      continue;
    }

    if (!type) continue;
    const rect = buildPdfRectFromTopLeftAnchor(line, {
      pdfWidth: line.pageWidth,
      pdfHeight: line.pageHeight,
      rotation: 0,
    }, 2);
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
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      xPct: rect.xPct,
      yPct: rect.yPct,
      wPct: rect.wPct,
      hPct: rect.hPct,
      confidence: type === "estimate_line" ? 0.96 : type === "line_note" ? 0.92 : 0.88,
      synthetic: line.synthetic,
    };
    if (type === "supplier_row") {
      anchor.supplierText = line.text;
      anchor.normalizedSupplierText = line.normalizedText;
    }
    anchors.push(anchor);
    previousEstimateRow = type === "estimate_line" || type === "line_note" ? anchor : previousEstimateRow;
  }

  return anchors;
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
  return score;
}

function getRoleEvidence(finding: CitationDensityFinding, estimateRole: "carrier" | "shop" | "selected") {
  if (estimateRole === "shop") return finding.shopEvidence ?? finding.shopAnchor;
  if (estimateRole === "carrier") return finding.carrierEvidence ?? finding.carrierAnchor;
  return finding.carrierEvidence ?? finding.carrierAnchor ?? finding.shopEvidence ?? finding.shopAnchor;
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
): EstimateRowAnchor["anchorType"] | null {
  const normalized = normalizeMatchText(text);
  if (
    lineNumber &&
    (/\b(?:supplier|alternate parts supplier)\b/.test(normalizeMatchText(currentSection)) ||
      /\b(?:supplier|alternate parts supplier|alternate supplier)\b/.test(normalized))
  ) return "supplier_row";
  if (lineNumber) return /note|available|via this link|not correct|report/.test(normalized) ? "line_note" : "estimate_line";
  if (/\btotal|subtotal|net cost|grand total|paint supplies|paint materials|body labor|paint labor|labor rate\b/.test(normalized)) return "totals_row";
  if (/\bsupplier|alternate|aftermarket|lkq|used part|capa\b/.test(`${normalized} ${normalizeMatchText(currentSection)}`)) return "supplier_row";
  if (sectionName) return "section_row";
  if (/\bnote|available upon request|via this link|not correct|report\b/.test(normalized)) return "line_note";
  return null;
}

function extractLineNumber(text: string) {
  return text.match(/^\s*(?:line\s*)?(\d{1,4})\b/i)?.[1] ?? null;
}

function detectSection(text: string) {
  const normalized = normalizeMatchText(text);
  const match = normalized.match(/^(parts|body|paint|refinish|electrical|diagnostics?|calibration|totals?|summary|alternate parts supplier|ccc|motor|p pages|included|not included)\b/);
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
    /\b(?:citation density gap report|annotation legend|unanchored citation density|disclosure|privacy|estimate summary only|disclaimer|abbreviations?|motor guide|guide pages)\b/i.test(value) ||
    /\bmotor\b.*\b(?:database|guide|included|not included)\b/i.test(value)
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

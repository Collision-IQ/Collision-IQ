import { randomUUID } from "node:crypto";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

export type AnnotationMode = "margin_callouts" | "inline_highlight" | "both";

export type AnnotatedEstimateRequest = {
  findingIds?: string[];
  annotationMode?: AnnotationMode;
  includeLegend?: boolean;
  includeSummaryPage?: boolean;
  redactSensitive?: boolean;
};

export type AnnotatedEstimateResult = {
  exportId: string;
  bytes: Uint8Array;
  annotatedFindingCount: number;
  unresolvedAnchorCount: number;
  originalPageCount: number;
  finalPageCount: number;
  warnings: string[];
};

type TextAnchor = {
  pageIndex: number;
  text: string;
  normalizedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type MatchedFinding = {
  finding: CitationDensityFinding;
  anchor: TextAnchor;
};

const SOURCE_BOUNDARY_TEXT =
  "Estimate evidence supports the existence of a difference. It does not automatically prove OEM, P-page, DEG, legal, policy, or carrier-violation authority.";

const LABELS = [
  "NEEDS OEM",
  "NEEDS P-PAGE",
  "NEEDS INVOICE",
  "REFERENCED / NOT PRODUCED",
  "ESTIMATE GAP ONLY",
  "WEAK - DO NOT LEAD",
] as const;

const exportCache = new Map<string, { bytes: Uint8Array; filename: string; createdAt: number }>();
const EXPORT_TTL_MS = 30 * 60 * 1000;

export function putAnnotatedEstimateExport(bytes: Uint8Array, filename: string) {
  pruneExportCache();
  const exportId = randomUUID();
  exportCache.set(exportId, { bytes, filename, createdAt: Date.now() });
  return exportId;
}

export function getAnnotatedEstimateExport(exportId: string) {
  pruneExportCache();
  return exportCache.get(exportId) ?? null;
}

export function dataUrlToPdfBytes(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) return null;
  return Uint8Array.from(Buffer.from(match[1], "base64"));
}

export async function buildAnnotatedCitationDensityEstimatePdf(params: {
  sourcePdfBytes: Uint8Array;
  findings: CitationDensityFinding[];
  request?: AnnotatedEstimateRequest;
}): Promise<AnnotatedEstimateResult> {
  const request = params.request ?? {};
  const mode = request.annotationMode ?? "both";
  const selectedIds = new Set(request.findingIds?.filter(Boolean) ?? []);
  const findings = params.findings.filter((finding) => !selectedIds.size || selectedIds.has(finding.id));
  const warnings: string[] = [];
  const sourcePdfBytes = params.sourcePdfBytes.slice();
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  const originalPageCount = pdfDoc.getPageCount();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const anchors = await extractPdfTextAnchors(sourcePdfBytes).catch((error) => {
    warnings.push(
      `Text-coordinate extraction failed; findings were placed in the appendix. ${error instanceof Error ? error.message : "Unknown PDF text extraction error."}`
    );
    return [] as TextAnchor[];
  });

  if (!anchors.length) {
    warnings.push("No text coordinates were extracted from the source PDF. The PDF may be image-only.");
  }

  const matches: MatchedFinding[] = [];
  const unmatched: CitationDensityFinding[] = [];
  const usedAnchors = new Set<TextAnchor>();

  for (const finding of findings) {
    const anchor = findBestAnchorForFinding(finding, anchors, usedAnchors);
    if (!anchor) {
      unmatched.push(finding);
      continue;
    }
    usedAnchors.add(anchor);
    matches.push({ finding, anchor });
  }

  matches.forEach((match, index) => {
    const page = pdfDoc.getPage(match.anchor.pageIndex);
    drawFindingAnnotation(page, match, index + 1, {
      mode,
      font,
      boldFont,
      redactSensitive: request.redactSensitive !== false,
    });
  });

  if (request.includeLegend !== false) {
    addLegendPage(pdfDoc, { font, boldFont });
  }

  if (request.includeSummaryPage) {
    addSummaryPage(pdfDoc, {
      font,
      boldFont,
      annotatedCount: matches.length,
      unresolvedCount: unmatched.length,
      warnings,
    });
  }

  if (unmatched.length > 0) {
    addUnanchoredAppendix(pdfDoc, unmatched, {
      font,
      boldFont,
      redactSensitive: request.redactSensitive !== false,
    });
  }

  const bytes = await pdfDoc.save();
  const exportId = putAnnotatedEstimateExport(bytes, "citation-density-annotated-estimate.pdf");
  return {
    exportId,
    bytes,
    annotatedFindingCount: matches.length,
    unresolvedAnchorCount: unmatched.length,
    originalPageCount,
    finalPageCount: pdfDoc.getPageCount(),
    warnings,
  };
}

async function extractPdfTextAnchors(bytes: Uint8Array): Promise<TextAnchor[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    useSystemFonts: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await loadingTask.promise;
  const anchors: TextAnchor[] = [];

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
      anchors.push({
        pageIndex: pageNumber - 1,
        text,
        normalizedText: normalizeMatchText(text),
        x,
        y: viewport.height - pdfJsY - height * 0.4,
        width,
        height,
      });
    }
  }

  return anchors;
}

function findBestAnchorForFinding(
  finding: CitationDensityFinding,
  anchors: TextAnchor[],
  usedAnchors: Set<TextAnchor>
): TextAnchor | null {
  let best: { anchor: TextAnchor; score: number } | null = null;
  for (const anchor of anchors) {
    if (usedAnchors.has(anchor)) continue;
    const score = scoreAnchor(finding, anchor);
    if (score > (best?.score ?? 0)) {
      best = { anchor, score };
    }
  }

  return best && best.score >= 28 ? best.anchor : null;
}

function scoreAnchor(finding: CitationDensityFinding, anchor: TextAnchor): number {
  const evidence = [finding.carrierEvidence, finding.shopEvidence].filter(Boolean);
  const anchorText = anchor.normalizedText;
  let score = 0;

  for (const item of evidence) {
    if (item?.lineNumber && new RegExp(`(^|\\D)${escapeRegex(item.lineNumber)}(\\D|$)`).test(anchor.text)) {
      score += 90;
    }
    if (item?.description) {
      const description = normalizeMatchText(item.description);
      if (description && (anchorText.includes(description) || description.includes(anchorText))) {
        score += 80;
      }
      score += sharedTermScore(description, anchorText, 36);
    }
    if (typeof item?.amount === "number" && anchorText.includes(normalizeMoney(item.amount))) {
      score += 18;
    }
    if (typeof item?.laborHours === "number" && anchorText.includes(String(item.laborHours))) {
      score += 14;
    }
  }

  const operation = normalizeMatchText(finding.operationLabel);
  score += sharedTermScore(operation, anchorText, 30);
  if (anchorText.includes(operation) || operation.includes(anchorText)) score += 50;
  return score;
}

function drawFindingAnnotation(
  page: PDFPage,
  match: MatchedFinding,
  number: number,
  options: {
    mode: AnnotationMode;
    font: PDFFont;
    boldFont: PDFFont;
    redactSensitive: boolean;
  }
) {
  const { anchor, finding } = match;
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const highlightWidth = Math.min(Math.max(anchor.width, 120), pageWidth - anchor.x - 18);
  const highlightY = clamp(pageHeight - anchor.y - anchor.height, 16, pageHeight - 20);

  if (options.mode === "inline_highlight" || options.mode === "both") {
    page.drawRectangle({
      x: Math.max(anchor.x - 2, 8),
      y: highlightY - 2,
      width: highlightWidth + 4,
      height: Math.max(anchor.height + 5, 12),
      color: rgb(1, 0.9, 0.3),
      opacity: 0.28,
    });
    page.drawEllipse({
      x: Math.max(anchor.x - 10, 10),
      y: highlightY + 4,
      xScale: 8,
      yScale: 8,
      color: rgb(0.86, 0.18, 0.15),
      opacity: 0.92,
    });
    page.drawText(String(number), {
      x: Math.max(anchor.x - 14, 6),
      y: highlightY + 1,
      size: 8,
      font: options.boldFont,
      color: rgb(1, 1, 1),
    });
  }

  if (options.mode === "margin_callouts" || options.mode === "both") {
    const boxWidth = Math.min(185, Math.max(135, pageWidth * 0.32));
    const boxX = anchor.x + highlightWidth + boxWidth + 18 < pageWidth
      ? anchor.x + highlightWidth + 8
      : Math.max(pageWidth - boxWidth - 18, 18);
    const boxY = clamp(highlightY - 64, 26, pageHeight - 104);
    const label = getProofBucketLabel(finding);
    const lines = buildCalloutLines(finding, number, label, options.redactSensitive);

    page.drawLine({
      start: { x: Math.min(anchor.x + highlightWidth + 2, pageWidth - 20), y: highlightY + 4 },
      end: { x: boxX, y: boxY + 74 },
      thickness: 0.7,
      color: rgb(0.68, 0.2, 0.16),
      opacity: 0.85,
    });
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: 92,
      color: rgb(1, 0.98, 0.9),
      borderColor: rgb(0.68, 0.2, 0.16),
      borderWidth: 0.8,
      opacity: 0.96,
    });
    drawWrappedLines(page, lines, {
      x: boxX + 6,
      y: boxY + 79,
      width: boxWidth - 12,
      font: options.font,
      boldFont: options.boldFont,
      size: 6.7,
      lineHeight: 8,
      maxLines: 10,
    });
  }
}

function addLegendPage(pdfDoc: PDFDocument, options: { font: PDFFont; boldFont: PDFFont }) {
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  page.drawText("Citation Density Annotation Legend", {
    x: 48,
    y: height - 58,
    size: 18,
    font: options.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  drawWrappedLines(page, [SOURCE_BOUNDARY_TEXT], {
    x: 48,
    y: height - 84,
    width: width - 96,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 13,
    maxLines: 4,
  });

  let y = height - 145;
  for (const label of LABELS) {
    page.drawRectangle({
      x: 48,
      y: y - 3,
      width: 16,
      height: 10,
      color: rgb(1, 0.9, 0.3),
      opacity: 0.35,
    });
    page.drawText(label, {
      x: 74,
      y,
      size: 11,
      font: options.boldFont,
      color: rgb(0.12, 0.14, 0.18),
    });
    y -= 24;
  }
}

function addSummaryPage(
  pdfDoc: PDFDocument,
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    annotatedCount: number;
    unresolvedCount: number;
    warnings: string[];
  }
) {
  const page = pdfDoc.addPage();
  const { height } = page.getSize();
  page.drawText("Annotated Estimate Summary", {
    x: 48,
    y: height - 58,
    size: 18,
    font: options.boldFont,
  });
  drawWrappedLines(page, [
    `Annotated findings: ${options.annotatedCount}`,
    `Unresolved anchors: ${options.unresolvedCount}`,
    ...options.warnings,
  ], {
    x: 48,
    y: height - 92,
    width: 500,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 14,
    maxLines: 30,
  });
}

function addUnanchoredAppendix(
  pdfDoc: PDFDocument,
  findings: CitationDensityFinding[],
  options: { font: PDFFont; boldFont: PDFFont; redactSensitive: boolean }
) {
  let page = pdfDoc.addPage();
  let y = page.getHeight() - 54;
  page.drawText("Unanchored Findings", {
    x: 48,
    y,
    size: 18,
    font: options.boldFont,
  });
  y -= 28;

  findings.forEach((finding, index) => {
    const lines = buildCalloutLines(finding, index + 1, getProofBucketLabel(finding), options.redactSensitive);
    if (y < 118) {
      page = pdfDoc.addPage();
      y = page.getHeight() - 54;
    }
    drawWrappedLines(page, lines, {
      x: 48,
      y,
      width: page.getWidth() - 96,
      font: options.font,
      boldFont: options.boldFont,
      size: 9,
      lineHeight: 12,
      maxLines: 8,
    });
    y -= 104;
  });
}

function buildCalloutLines(
  finding: CitationDensityFinding,
  number: number,
  label: string,
  redactSensitive: boolean
) {
  const sanitize = (value: string) => {
    const text = value.replace(/\s+/g, " ").trim();
    return redactSensitive ? redactAnnotationText(text) : text;
  };

  return [
    `Finding #: ${number}`,
    `Label: ${label}`,
    `Citation Density: ${finding.citationDensityScore}/100`,
    `Carrier issue: ${sanitize(finding.operationLabel)}`,
    `Current support: ${sanitize(finding.currentSupportSummary)}`,
    `Missing proof: ${sanitize(finding.missingProofSummary)}`,
    `Next action: ${sanitize(finding.recommendedNextAction)}`,
  ];
}

function getProofBucketLabel(finding: CitationDensityFinding): string {
  if (finding.estimateGapType === "weak_do_not_lead") return "WEAK - DO NOT LEAD";
  if (finding.estimateGapType === "referenced_not_produced") return "REFERENCED / NOT PRODUCED";
  if (finding.citationStatus.invoiceOrCompletionProof === "needed") return "NEEDS INVOICE";
  if (finding.citationStatus.oem === "needed" || finding.missingAuthorityTypes.some((item) => /oem/i.test(item))) return "NEEDS OEM";
  if (finding.citationStatus.pPages === "needed" || finding.missingAuthorityTypes.some((item) => /p-?page/i.test(item))) return "NEEDS P-PAGE";
  return "ESTIMATE GAP ONLY";
}

function redactAnnotationText(value: string): string {
  return redactDownloadContent(value)
    .replace(/\b[A-HJ-NPR-Z0-9]{11}\*{6}\b/g, "[REDACTED_VIN]")
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[REDACTED_VIN]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court)\b\.?/gi, "[REDACTED_ADDRESS]");
}

function drawWrappedLines(
  page: PDFPage,
  lines: string[],
  options: {
    x: number;
    y: number;
    width: number;
    font: PDFFont;
    boldFont: PDFFont;
    size: number;
    lineHeight: number;
    maxLines: number;
  }
) {
  let y = options.y;
  let drawn = 0;
  for (const line of lines) {
    const [label, ...rest] = line.split(":");
    const body = rest.join(":").trim();
    const wrapped = wrapText(body ? `${label}: ${body}` : label, options.font, options.size, options.width);
    for (const wrappedLine of wrapped) {
      if (drawn >= options.maxLines) return;
      const labelMatch = wrappedLine.match(/^([^:]{1,22}:)(.*)$/);
      if (labelMatch) {
        page.drawText(labelMatch[1], {
          x: options.x,
          y,
          size: options.size,
          font: options.boldFont,
          color: rgb(0.12, 0.14, 0.18),
        });
        page.drawText(labelMatch[2].trim(), {
          x: options.x + options.boldFont.widthOfTextAtSize(labelMatch[1], options.size) + 2,
          y,
          size: options.size,
          font: options.font,
          color: rgb(0.12, 0.14, 0.18),
        });
      } else {
        page.drawText(wrappedLine, {
          x: options.x,
          y,
          size: options.size,
          font: options.font,
          color: rgb(0.12, 0.14, 0.18),
        });
      }
      y -= options.lineHeight;
      drawn += 1;
    }
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMoney(value: number) {
  return String(Math.round(value * 100) / 100).replace(/\.00$/, "");
}

function sharedTermScore(a: string, b: string, max: number) {
  const terms = a.split(" ").filter((term) => term.length > 2 && !/^\d+$/.test(term));
  if (!terms.length) return 0;
  const matches = terms.filter((term) => b.includes(term)).length;
  return Math.min(max, Math.round((matches / terms.length) * max));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pruneExportCache() {
  const cutoff = Date.now() - EXPORT_TTL_MS;
  for (const [id, entry] of exportCache.entries()) {
    if (entry.createdAt < cutoff) exportCache.delete(id);
  }
}

import { randomUUID } from "node:crypto";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import {
  PDFHexString,
  PDFName,
  type PDFRef,
} from "pdf-lib/cjs/core";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

export type AnnotationMode = "margin_callouts" | "inline_highlight" | "both";

export type AnnotatedEstimateRequest = {
  findingIds?: string[];
  annotationMode?: AnnotationMode;
  estimateRole?: "carrier" | "shop" | "selected";
  includeLegend?: boolean;
  includeSummaryPage?: boolean;
  includeUnanchoredAppendix?: boolean;
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
  annotationMetadata: CitationDensityAnnotationMetadata[];
};

export type CitationDensityAnnotationMetadata = {
  findingId: string;
  markerNumber: number;
  pageNumber: number;
  pdfPageWidth: number;
  pdfPageHeight: number;
  rotation: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  coordinateSpace: "pdf-points" | "normalized";
  targetLineNumber?: string;
  targetSection?: string;
  targetRawText: string;
  matchConfidence: "high" | "medium" | "low";
  anchorType: "exact_line" | "description" | "note" | "amount" | "section" | "totals" | "supplier" | "page_fallback";
  label: string;
  shortTitle: string;
  estimateLine: string;
  bestAuthority: string;
  authorityStatus: string;
  missingProof: string;
  nextAction: string;
  sourceRefs: string[];
  comment: string;
};

type TextAnchor = {
  pageIndex: number;
  text: string;
  normalizedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  synthetic?: boolean;
  groupedLine?: boolean;
};

type MatchedFinding = {
  finding: CitationDensityFinding;
  anchor: TextAnchor;
  matchKind: "line" | "page";
};

const SOURCE_BOUNDARY_TEXT =
  "Estimate evidence supports the existence of a difference. It does not automatically prove OEM, P-page, DEG, legal, policy, or carrier-violation authority.";
const CCC_SOURCE_BOUNDARY_TEXT =
  "CCC Secure Share source confirms this estimate line was present in the structured estimate data.";
const CCC_LIMITATION_TEXT =
  "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified.";

const LABELS = [
  "VERIFIED DOCUMENTATION",
  "VERIFIED OEM",
  "VERIFIED ADAS",
  "VERIFIED LEGAL",
  "NEEDS OEM",
  "NEEDS ADAS",
  "NEEDS P-PAGE",
  "NEEDS INVOICE",
  "REFERENCED / NOT PRODUCED",
  "ESTIMATE GAP ONLY",
  "ONLINE FALLBACK",
  "WEAK — DO NOT LEAD",
] as const;

const NO_LINE_ANCHORS_WARNING = "No line-level anchors could be placed.";

const exportCache = new Map<string, {
  bytes: Uint8Array;
  filename: string;
  createdAt: number;
  annotationMetadata: CitationDensityAnnotationMetadata[];
}>();
const EXPORT_TTL_MS = 30 * 60 * 1000;

export function putAnnotatedEstimateExport(
  bytes: Uint8Array,
  filename: string,
  annotationMetadata: CitationDensityAnnotationMetadata[] = []
) {
  pruneExportCache();
  const exportId = randomUUID();
  exportCache.set(exportId, { bytes, filename, createdAt: Date.now(), annotationMetadata });
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
  sourceText?: string | null;
  findings: CitationDensityFinding[];
  request?: AnnotatedEstimateRequest;
}): Promise<AnnotatedEstimateResult> {
  const request = params.request ?? {};
  const mode = request.annotationMode ?? "both";
  const estimateRole = request.estimateRole ?? "selected";
  const selectedIds = new Set(request.findingIds?.filter(Boolean) ?? []);
  const findings = params.findings.filter((finding) => !selectedIds.size || selectedIds.has(finding.id));
  const warnings: string[] = [];
  const sourcePdfBytes = params.sourcePdfBytes.slice();
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  const originalPageCount = pdfDoc.getPageCount();
  if (originalPageCount === 0) {
    throw new Error("Annotated Citation Density export requires an original estimate PDF with source pages.");
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pdfAnchors = await extractPdfTextAnchors(sourcePdfBytes).catch((error) => {
    warnings.push(
      `Text-coordinate extraction failed; findings were placed in the appendix. ${error instanceof Error ? error.message : "Unknown PDF text extraction error."}`
    );
    return [] as TextAnchor[];
  });
  const fallbackAnchors = buildStoredTextAnchors(params.sourceText, pdfDoc);
  const anchors = [...pdfAnchors, ...fallbackAnchors];

  if (!anchors.length) {
    warnings.push("No text coordinates were extracted from the source PDF. The PDF may be image-only.");
  } else if (!pdfAnchors.length && fallbackAnchors.length) {
    warnings.push("Used stored extracted text to place approximate estimate-page anchors.");
  }

  const matches: MatchedFinding[] = [];
  const unmatched: CitationDensityFinding[] = [];
  const usedAnchors = new Set<TextAnchor>();

  for (const finding of findings) {
    const anchor = findBestAnchorForFinding(finding, anchors, usedAnchors, estimateRole);
    if (anchor) {
      usedAnchors.add(anchor);
      matches.push({ finding, anchor, matchKind: "line" });
      continue;
    }

    const pageAnchor = findBestPageAnchorForFinding(finding, anchors, usedAnchors, pdfDoc, estimateRole);
    if (!pageAnchor) {
      unmatched.push(finding);
      continue;
    }

    if (!pageAnchor.synthetic) usedAnchors.add(pageAnchor);
    matches.push({ finding, anchor: pageAnchor, matchKind: "page" });
  }

  const lineMatchCount = matches.filter((match) => match.matchKind === "line").length;
  if (findings.length > 0 && lineMatchCount === 0) {
    warnings.push(
      `${NO_LINE_ANCHORS_WARNING} Findings were placed as page-level callouts and/or appendix entries.`
    );
    if (matches.length === 0) warnings.push("all_findings_unanchored");
  }

  const annotationMetadata: CitationDensityAnnotationMetadata[] = [];
  matches.forEach((match, index) => {
    const page = pdfDoc.getPage(match.anchor.pageIndex);
    const metadata = drawFindingAnnotation(pdfDoc, page, match, index + 1, {
      mode,
      font,
      boldFont,
      estimateRole,
      redactSensitive: request.redactSensitive !== false,
    });
    annotationMetadata.push(metadata);
  });

  if (findings.length > 0 && lineMatchCount === 0) {
    addNoLineAnchorWarningPage(pdfDoc, {
      font,
      boldFont,
      pageCalloutCount: matches.length,
      appendixCount: unmatched.length,
    });
  }

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

  if (unmatched.length > 0 && request.includeUnanchoredAppendix !== false) {
    addUnanchoredAppendix(pdfDoc, unmatched, {
      font,
      boldFont,
      estimateRole,
      redactSensitive: request.redactSensitive !== false,
    });
  }

  const bytes = await pdfDoc.save();
  const exportId = putAnnotatedEstimateExport(
    bytes,
    "citation-density-annotated-estimate.pdf",
    annotationMetadata
  );
  return {
    exportId,
    bytes,
    annotatedFindingCount: matches.length,
    unresolvedAnchorCount: unmatched.length,
    originalPageCount,
    finalPageCount: pdfDoc.getPageCount(),
    warnings,
    annotationMetadata,
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
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });
    }
  }

  return [...anchors, ...buildGroupedLineAnchors(anchors)];
}

function buildGroupedLineAnchors(anchors: TextAnchor[]): TextAnchor[] {
  const byPage = new Map<number, TextAnchor[]>();
  for (const anchor of anchors) {
    const pageAnchors = byPage.get(anchor.pageIndex) ?? [];
    pageAnchors.push(anchor);
    byPage.set(anchor.pageIndex, pageAnchors);
  }

  const grouped: TextAnchor[] = [];
  for (const [, pageAnchors] of byPage.entries()) {
    const rows: TextAnchor[][] = [];
    for (const anchor of [...pageAnchors].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find((candidate) =>
        Math.abs(average(candidate.map((item) => item.y)) - anchor.y) <= Math.max(3.5, anchor.height * 0.55)
      );
      if (row) {
        row.push(anchor);
      } else {
        rows.push([anchor]);
      }
    }

    for (const row of rows) {
      if (row.length < 2) continue;
      const ordered = [...row].sort((a, b) => a.x - b.x);
      const text = ordered.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 8) continue;
      const minX = Math.min(...ordered.map((item) => item.x));
      const minY = Math.min(...ordered.map((item) => item.y));
      const maxX = Math.max(...ordered.map((item) => item.x + item.width));
      const maxY = Math.max(...ordered.map((item) => item.y + item.height));
      grouped.push({
        pageIndex: ordered[0].pageIndex,
        text,
        normalizedText: normalizeMatchText(text),
        x: minX,
        y: minY,
        width: Math.max(40, maxX - minX),
        height: Math.max(8, maxY - minY),
        pageWidth: ordered[0].pageWidth,
        pageHeight: ordered[0].pageHeight,
        groupedLine: true,
      });
    }
  }
  return grouped;
}

function buildStoredTextAnchors(sourceText: string | null | undefined, pdfDoc: PDFDocument): TextAnchor[] {
  const text = sourceText?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  const pageCount = Math.max(1, pdfDoc.getPageCount());
  const pages = splitStoredTextIntoPages(text, pageCount);
  const anchors: TextAnchor[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pdfDoc.getPage(Math.min(pageIndex, pageCount - 1));
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const rawLines = pageText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const lines = mergeContinuationLines(rawLines);
    const usableLines = lines.length ? lines : rawLines;
    const topY = pageHeight - 72;
    const rowHeight = Math.max(8, Math.min(13, (pageHeight - 120) / Math.max(1, usableLines.length)));

    usableLines.forEach((line, index) => {
      const lineY = clamp(topY - index * rowHeight, 42, pageHeight - 42);
      anchors.push({
        pageIndex: Math.min(pageIndex, pageCount - 1),
        text: line,
        normalizedText: normalizeMatchText(line),
        x: 42,
        y: pageHeight - lineY - 9,
        width: Math.min(pageWidth - 84, Math.max(180, line.length * 4.8)),
        height: 9,
        pageWidth,
        pageHeight,
        synthetic: true,
        groupedLine: true,
      });
    });
  });

  return anchors;
}

function splitStoredTextIntoPages(text: string, pageCount: number) {
  const formFeedPages = text.split(/\f+/).map((page) => page.trim()).filter(Boolean);
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

function mergeContinuationLines(lines: string[]) {
  const merged: string[] = [];
  for (const line of lines) {
    const startsEstimateRow = /^\s*(?:line\s*)?\d{1,4}\b/i.test(line);
    const startsSection = /^(?:parts|body|paint|refinish|electrical|diagnostic|calibration|totals?|summary|alternate parts supplier|ccc|motor|p-?pages?|included|not included)\b/i.test(line);
    if (!merged.length || startsEstimateRow || startsSection) {
      merged.push(line);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (
      /(?:note|available|via this link|not correct|supplier|guide|database|included|not included|paint materials?|labor|total)/i.test(line) ||
      /^\$?\d+(?:\.\d+)?\b/.test(line)
    ) {
      merged[merged.length - 1] = `${previous} ${line}`;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function findBestAnchorForFinding(
  finding: CitationDensityFinding,
  anchors: TextAnchor[],
  usedAnchors: Set<TextAnchor>,
  estimateRole: "carrier" | "shop" | "selected"
): TextAnchor | null {
  let best: { anchor: TextAnchor; score: number } | null = null;
  for (const anchor of anchors) {
    if (usedAnchors.has(anchor)) continue;
    const score = scoreAnchor(finding, anchor, estimateRole);
    if (score > (best?.score ?? 0)) {
      best = { anchor, score };
    }
  }

  return best && best.score >= 24 ? best.anchor : null;
}

function findBestPageAnchorForFinding(
  finding: CitationDensityFinding,
  anchors: TextAnchor[],
  usedAnchors: Set<TextAnchor>,
  pdfDoc: PDFDocument,
  estimateRole: "carrier" | "shop" | "selected"
): TextAnchor | null {
  if (!anchors.length) return null;

  const pageScores = new Map<number, { score: number; anchor: TextAnchor | null }>();
  for (const anchor of anchors) {
    if (usedAnchors.has(anchor)) continue;
    const score = scorePageAnchor(finding, anchor, estimateRole);
    if (score <= 0) continue;
    const current = pageScores.get(anchor.pageIndex);
    if (!current || score > current.score) {
      pageScores.set(anchor.pageIndex, { score, anchor });
    }
  }

  const best = [...pageScores.entries()].sort((a, b) => b[1].score - a[1].score)[0];
  if (!best || best[1].score < 12 || !best[1].anchor) return null;

  const page = pdfDoc.getPage(best[0]);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const anchor = best[1].anchor;
  const desiredY = clamp(pageHeight - 96 - (best[0] % 4) * 36, 132, pageHeight - 76);

  return {
    pageIndex: best[0],
    text: `Page-level citation density callout: ${finding.operationLabel}`,
    normalizedText: normalizeMatchText(finding.operationLabel),
    x: clamp(anchor.x, 42, Math.max(42, pageWidth - 210)),
    y: pageHeight - desiredY - 12,
    width: Math.min(Math.max(anchor.width, 150), pageWidth - 84),
    height: 12,
    pageWidth,
    pageHeight,
    synthetic: true,
  };
}

function scorePageAnchor(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): number {
  const anchorText = anchor.normalizedText;
  const keywords = buildFindingKeywords(finding, estimateRole);
  let score = 0;

  for (const keyword of keywords) {
    if (keyword.length > 2 && anchorText.includes(keyword)) score += keyword.length > 5 ? 8 : 4;
  }

  for (const item of [finding.carrierEvidence, finding.shopEvidence].filter(Boolean)) {
    if (typeof item?.amount === "number" && anchorText.includes(normalizeMoney(item.amount))) score += 8;
    if (typeof item?.laborHours === "number" && anchorText.includes(String(item.laborHours))) score += 7;
  }

  return score + scoreSectionAffinity(finding, anchor, estimateRole);
}

function buildFindingKeywords(finding: CitationDensityFinding, estimateRole: "carrier" | "shop" | "selected") {
  const roleEvidence = estimateRole === "shop" ? finding.shopEvidence : estimateRole === "carrier" ? finding.carrierEvidence : null;
  const fallbackEvidence = estimateRole === "shop" ? finding.carrierEvidence : finding.shopEvidence;
  const roleAnchor = estimateRole === "shop" ? finding.shopAnchor : estimateRole === "carrier" ? finding.carrierAnchor : null;
  const source = [
    finding.operationLabel,
    roleAnchor?.operation,
    roleAnchor?.section,
    roleAnchor?.description,
    roleEvidence?.description,
    fallbackEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    finding.counterpartSummary,
    ...finding.missingAuthorityTypes,
  ].join(" ");
  const normalized = normalizeMatchText(source);
  const terms = normalized.split(" ").filter((term) =>
    term.length > 3 &&
    !/^\d+$/.test(term) &&
    !COMMON_MATCH_TERMS.has(term)
  );
  const extras: string[] = [];

  if (/struct|frame|unibody|apron|rail|measure|dimension|pull|set up|setup/.test(normalized)) {
    extras.push("structural", "frame", "measure", "dimension", "set", "setup", "apron", "rail");
  }
  if (/door|shell/.test(normalized)) extras.push("door", "shell");
  if (/steer|suspension|align/.test(normalized)) extras.push("steering", "suspension", "align");
  if (/calibration|adas|scan|radar|camera|module/.test(normalized)) {
    extras.push("calibration", "adas", "scan", "radar", "camera", "module");
  }
  if (/refinish|paint|blend|base coat|clear coat/.test(normalized)) {
    extras.push("refinish", "paint", "blend", "base", "coat");
  }
  if (/aftermarket|a m|a\/m|non oem|alternate|lkq|bumper|reflector|molding/.test(normalized)) {
    extras.push("aftermarket", "non", "oem", "alternate", "bumper", "cover", "reflector", "molding");
  }
  if (/corrosion|cavity|seam|weld|protection/.test(normalized)) {
    extras.push("corrosion", "protection", "cavity", "seam", "weld");
  }
  if (/mask|jamb|sand|polish|material|suppl|supplies/.test(normalized)) {
    extras.push("mask", "jamb", "sand", "polish", "material", "supplies");
  }

  return [...new Set([...terms.map(canonicalMatchToken).slice(0, 22), ...extras].filter((term) => term.length > 2))];
}

function scoreAnchor(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): number {
  const primaryEvidence = estimateRole === "shop" ? finding.shopEvidence : estimateRole === "carrier" ? finding.carrierEvidence : null;
  const secondaryEvidence = estimateRole === "shop" ? finding.carrierEvidence : finding.shopEvidence;
  const evidence = [primaryEvidence, secondaryEvidence].filter(Boolean);
  const anchorText = anchor.normalizedText;
  let score = 0;

  for (const item of evidence) {
    if (item?.lineNumber && matchesLineNumber(anchor.text, item.lineNumber)) {
      score += item === primaryEvidence ? 125 : 82;
    }
    if (item?.description) {
      const description = normalizeMatchText(item.description);
      if (description && (anchorText.includes(description) || description.includes(anchorText))) {
        score += item === primaryEvidence ? 95 : 55;
      }
      score += sharedTermScore(description, anchorText, 42);
      score += keyTokenScore(description, anchorText, 34);
    }
    if (typeof item?.amount === "number" && anchorText.includes(normalizeMoney(item.amount))) {
      score += 18;
    }
    if (typeof item?.laborHours === "number" && anchorText.includes(String(item.laborHours))) {
      score += 14;
    }
  }

  const operation = normalizeMatchText(finding.operationLabel);
  score += sharedTermScore(operation, anchorText, 34);
  score += keyTokenScore(operation, anchorText, 38);
  if (anchorText.includes(operation) || operation.includes(anchorText)) score += 50;
  score += scoreSectionAffinity(finding, anchor, estimateRole);
  if (anchor.groupedLine) score += 8;
  return score;
}

function drawFindingAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  match: MatchedFinding,
  number: number,
  options: {
    mode: AnnotationMode;
    font: PDFFont;
    boldFont: PDFFont;
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
  }
) {
  const { anchor, finding } = match;
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const highlightWidth = Math.min(Math.max(anchor.width, 120), pageWidth - anchor.x - 18);
  const highlightY = clamp(pageHeight - anchor.y - anchor.height, 16, pageHeight - 20);
  const highlightX = Math.max(anchor.x - 2, 8);
  const highlightHeight = Math.max(anchor.height + 5, 12);
  const label = getProofBucketLabel(finding);
  const shortTitle = formatShortIssueTitle(finding);
  const metadata = buildAnnotationMetadata(finding, anchor, number, label, shortTitle, {
    x: highlightX,
    y: highlightY - 2,
    width: highlightWidth + 4,
    height: highlightHeight,
    pageWidth,
    pageHeight,
    matchKind: match.matchKind,
    estimateRole: options.estimateRole,
    redactSensitive: options.redactSensitive,
  });

  if (options.mode === "inline_highlight" || options.mode === "both") {
    page.drawRectangle({
      x: highlightX,
      y: highlightY - 2,
      width: highlightWidth + 4,
      height: highlightHeight,
      color: rgb(1, 0.9, 0.3),
      opacity: 0.22,
    });
  }

  if (options.mode === "margin_callouts" || options.mode === "both") {
    drawCompactMarker(page, {
      number,
      label,
      shortTitle,
      anchorX: anchor.x,
      highlightX,
      highlightY,
      pageWidth,
      font: options.font,
      boldFont: options.boldFont,
    });
  }

  attachPdfFindingAnnotations(pdfDoc, page, metadata);
  return metadata;
}

function drawCompactMarker(
  page: PDFPage,
  options: {
    number: number;
    label: string;
    shortTitle: string;
    anchorX: number;
    highlightX: number;
    highlightY: number;
    pageWidth: number;
    font: PDFFont;
    boldFont: PDFFont;
  }
) {
  const markerX = options.anchorX > 56
    ? clamp(options.highlightX - 18, 8, options.pageWidth - 28)
    : clamp(options.highlightX + 4, 8, options.pageWidth - 28);
  const markerY = options.highlightY + 2;
  page.drawEllipse({
    x: markerX + 7,
    y: markerY + 7,
    xScale: 7,
    yScale: 7,
    color: rgb(0.72, 0.12, 0.1),
    opacity: 0.95,
  });
  page.drawText(String(options.number), {
    x: markerX + (options.number < 10 ? 4.6 : 2.2),
    y: markerY + 3.2,
    size: 7,
    font: options.boldFont,
    color: rgb(1, 1, 1),
  });

  const text = `${options.number}. ${options.label}: ${options.shortTitle}`;
  const textX = clamp(options.highlightX + 4, 28, options.pageWidth - 210);
  page.drawText(truncateText(text, 58), {
    x: textX,
    y: markerY + 3,
    size: 6.4,
    font: options.boldFont,
    color: rgb(0.45, 0.1, 0.08),
  });
}

function attachPdfFindingAnnotations(
  pdfDoc: PDFDocument,
  page: PDFPage,
  metadata: CitationDensityAnnotationMetadata
) {
  const annots = page.node.Annots() ?? pdfDoc.context.obj([]);
  page.node.set(PDFName.Annots, annots);
  const pageRef = page.ref;
  const rect = [
    metadata.x,
    metadata.y,
    metadata.x + metadata.width,
    metadata.y + metadata.height,
  ];
  const quadPoints = [
    metadata.x,
    metadata.y + metadata.height,
    metadata.x + metadata.width,
    metadata.y + metadata.height,
    metadata.x,
    metadata.y,
    metadata.x + metadata.width,
    metadata.y,
  ];
  const highlightRef = addPdfAnnotation(pdfDoc, pageRef, {
    Type: "Annot",
    Subtype: "Highlight",
    Rect: rect,
    QuadPoints: quadPoints,
    C: [1, 0.88, 0.22],
    CA: 0.36,
    T: PDFHexString.fromText("Collision IQ Citation Density"),
    Contents: PDFHexString.fromText(metadata.comment),
    NM: PDFHexString.fromText(`citation-density-${metadata.findingId}-highlight`),
    M: PDFHexString.fromText(formatPdfDate(new Date())),
    F: 4,
  });
  const noteRef = addPdfAnnotation(pdfDoc, pageRef, {
    Type: "Annot",
    Subtype: "Text",
    Rect: [
      clamp(metadata.x - 18, 4, page.getWidth() - 24),
      clamp(metadata.y + metadata.height - 2, 4, page.getHeight() - 24),
      clamp(metadata.x - 2, 20, page.getWidth() - 8),
      clamp(metadata.y + metadata.height + 14, 20, page.getHeight() - 8),
    ],
    Name: "Comment",
    Open: false,
    T: PDFHexString.fromText("Collision IQ Citation Density"),
    Contents: PDFHexString.fromText(metadata.comment),
    NM: PDFHexString.fromText(`citation-density-${metadata.findingId}-note`),
    M: PDFHexString.fromText(formatPdfDate(new Date())),
    C: [1, 0.84, 0.2],
    F: 4,
  });
  annots.push(highlightRef);
  annots.push(noteRef);
}

function addPdfAnnotation(
  pdfDoc: PDFDocument,
  pageRef: PDFRef,
  values: Record<string, unknown>
) {
  const dict = pdfDoc.context.obj({
    ...values,
    P: pageRef,
  });
  return pdfDoc.context.register(dict);
}

function buildAnnotationMetadata(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  number: number,
  label: string,
  shortTitle: string,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    pageWidth: number;
    pageHeight: number;
    matchKind: MatchedFinding["matchKind"];
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
  }
): CitationDensityAnnotationMetadata {
  const sanitize = (value: string) => {
    const text = normalizeSourceBoundaryText(value.replace(/\s+/g, " ").trim());
    return options.redactSensitive ? redactAnnotationText(text) : text;
  };
  const sourceRefs = formatAnnotationSourceRefs(finding).map(sanitize);
  const bestAuthority = sanitize(formatBestAuthority(finding));
  const metadata: CitationDensityAnnotationMetadata = {
    findingId: finding.id,
    markerNumber: number,
    pageNumber: anchor.pageIndex + 1,
    pdfPageWidth: roundCoordinate(options.pageWidth),
    pdfPageHeight: roundCoordinate(options.pageHeight),
    rotation: 0,
    x: roundCoordinate(options.x),
    y: roundCoordinate(options.y),
    width: roundCoordinate(options.width),
    height: roundCoordinate(options.height),
    xPct: roundRatio(options.x / Math.max(1, options.pageWidth)),
    yPct: roundRatio(options.y / Math.max(1, options.pageHeight)),
    wPct: roundRatio(options.width / Math.max(1, options.pageWidth)),
    hPct: roundRatio(options.height / Math.max(1, options.pageHeight)),
    coordinateSpace: "pdf-points",
    targetLineNumber: getTargetLineNumber(finding, options.estimateRole),
    targetSection: getTargetSection(finding, options.estimateRole),
    targetRawText: sanitize(anchor.text || formatEstimateLineForCallout(finding, options.estimateRole)),
    matchConfidence: getMatchConfidence(anchor, options.matchKind),
    anchorType: getAnchorType(finding, anchor, options.matchKind, options.estimateRole),
    label,
    shortTitle,
    estimateLine: sanitize(formatEstimateLineForCallout(finding, options.estimateRole)),
    bestAuthority,
    authorityStatus: finding.bestAvailableAuthority?.status ?? label,
    missingProof: sanitize(finding.missingProofSummary),
    nextAction: sanitize(finding.recommendedNextAction),
    sourceRefs,
    comment: "",
  };
  metadata.comment = buildPdfCommentBody(metadata, finding, options.estimateRole, options.redactSensitive);
  return metadata;
}

function getTargetLineNumber(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const evidence = estimateRole === "shop"
    ? finding.shopEvidence ?? finding.carrierEvidence
    : estimateRole === "carrier"
      ? finding.carrierEvidence ?? finding.shopEvidence
      : finding.carrierEvidence ?? finding.shopEvidence;
  return evidence?.lineNumber || undefined;
}

function getTargetSection(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const anchor = estimateRole === "shop"
    ? finding.shopAnchor ?? finding.carrierAnchor
    : estimateRole === "carrier"
      ? finding.carrierAnchor ?? finding.shopAnchor
      : finding.carrierAnchor ?? finding.shopAnchor;
  return anchor?.section || undefined;
}

function getMatchConfidence(anchor: TextAnchor, matchKind: MatchedFinding["matchKind"]): "high" | "medium" | "low" {
  if (matchKind === "page" || anchor.synthetic) return "low";
  if (anchor.groupedLine) return "high";
  return "medium";
}

function getAnchorType(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  matchKind: MatchedFinding["matchKind"],
  estimateRole: "carrier" | "shop" | "selected"
): CitationDensityAnnotationMetadata["anchorType"] {
  if (matchKind === "page") return "page_fallback";
  const lineNumber = getTargetLineNumber(finding, estimateRole);
  if (lineNumber && matchesLineNumber(anchor.text, lineNumber)) return "exact_line";
  const text = normalizeMatchText(anchor.text);
  if (/\btotal|subtotal|net cost|grand total|paint supplies|labor summary|body labor|paint labor|mechanical labor\b/.test(text)) return "totals";
  if (/\bsupplier|alternate|a m|aftermarket|part|oem\b/.test(text)) return "supplier";
  if (/\bnote|remark|message\b/.test(text)) return "note";
  if (/\$?\d[\d,.]*|\b\d+(?:\.\d+)?\s*(?:hrs?|hours)\b/.test(anchor.text)) return "amount";
  if (getTargetSection(finding, estimateRole)) return "section";
  return "description";
}

function buildPdfCommentBody(
  metadata: CitationDensityAnnotationMetadata,
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected",
  redactSensitive: boolean
) {
  const lines = buildCalloutLines(finding, metadata.markerNumber, metadata.label, redactSensitive, estimateRole);
  return [
    `Finding #${metadata.markerNumber}: ${metadata.shortTitle}`,
    ...lines.slice(1),
    metadata.sourceRefs.length ? `Source refs: ${metadata.sourceRefs.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function formatShortIssueTitle(finding: CitationDensityFinding) {
  const evidence = finding.carrierEvidence ?? finding.shopEvidence;
  return truncateText(evidence?.description || finding.operationLabel || "Citation Density finding", 48);
}

function formatAnnotationSourceRefs(finding: CitationDensityFinding) {
  const refs = [
    finding.carrierEvidence?.sourceLabel,
    finding.shopEvidence?.sourceLabel,
    finding.bestAvailableAuthority?.title,
    ...formatEmbeddedLinkLines(finding),
  ].filter((value): value is string => Boolean(value && value.trim()));
  return [...new Set(refs)].slice(0, 6);
}

function formatPdfDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number) {
  return Math.round(value * 10000) / 10000;
}

function truncateText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
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
  drawWrappedLines(page, [
    SOURCE_BOUNDARY_TEXT,
    CCC_SOURCE_BOUNDARY_TEXT,
    CCC_LIMITATION_TEXT,
  ], {
    x: 48,
    y: height - 84,
    width: width - 96,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 13,
    maxLines: 8,
  });

  let y = height - 178;
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

function addNoLineAnchorWarningPage(
  pdfDoc: PDFDocument,
  options: { font: PDFFont; boldFont: PDFFont; pageCalloutCount: number; appendixCount: number }
) {
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  page.drawText(NO_LINE_ANCHORS_WARNING, {
    x: 48,
    y: height - 58,
    size: 18,
    font: options.boldFont,
    color: rgb(0.68, 0.2, 0.16),
  });
  drawWrappedLines(page, [
    options.pageCalloutCount === 0
      ? "No estimate-page anchors were placed. Findings are listed in the appendix."
      : "The original estimate pages were preserved. Collision IQ could not place exact line-level anchors from the extracted PDF text.",
    `Page-level callouts placed on original estimate pages: ${options.pageCalloutCount}.`,
    `Findings appended in the unanchored appendix: ${options.appendixCount}.`,
    "Review the highlighted sections and appendix before relying on these findings.",
  ], {
    x: 48,
    y: height - 92,
    width: width - 96,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 14,
    maxLines: 16,
  });
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
  options: { font: PDFFont; boldFont: PDFFont; estimateRole: "carrier" | "shop" | "selected"; redactSensitive: boolean }
) {
  let page = pdfDoc.addPage();
  let y = page.getHeight() - 54;
  page.drawText("Unanchored Citation Density Findings", {
    x: 48,
    y,
    size: 18,
    font: options.boldFont,
  });
  y -= 28;

  findings.forEach((finding, index) => {
    const lines = buildCalloutLines(finding, index + 1, getProofBucketLabel(finding), options.redactSensitive, options.estimateRole);
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
  redactSensitive: boolean,
  estimateRole: "carrier" | "shop" | "selected" = "selected"
) {
  const sanitize = (value: string) => {
    const text = normalizeSourceBoundaryText(value.replace(/\s+/g, " ").trim());
    return redactSensitive ? redactAnnotationText(text) : text;
  };

  return [
    `Finding #: ${number}`,
    `Label: ${label}`,
    `Citation Density: ${finding.citationDensityScore}/100`,
    `Estimate line: ${sanitize(formatEstimateLineForCallout(finding, estimateRole))}`,
    `Best authority: ${sanitize(formatBestAuthority(finding))}`,
    ...formatEmbeddedLinkLines(finding).map((line) => `Estimate link: ${sanitize(line)}`),
    `Missing authority: ${sanitize(formatMissingAuthority(finding))}`,
    `Estimate note: ${sanitize(buildRoleCalloutNote(finding, estimateRole))}`,
    `Current support: ${sanitize(finding.currentSupportSummary)}`,
    `Missing proof: ${sanitize(finding.missingProofSummary)}`,
    `Next action: ${sanitize(finding.recommendedNextAction)}`,
  ];
}

function formatEstimateLineForCallout(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const evidence = estimateRole === "shop"
    ? finding.shopEvidence ?? finding.carrierEvidence
    : estimateRole === "carrier"
      ? finding.carrierEvidence ?? finding.shopEvidence
      : finding.carrierEvidence ?? finding.shopEvidence;
  const linePrefix = evidence?.lineNumber ? `Line ${evidence.lineNumber}: ` : "";
  return `${linePrefix}${evidence?.description ?? finding.operationLabel}`;
}

function formatEmbeddedLinkLines(finding: CitationDensityFinding) {
  return (finding.embeddedEstimateLinks ?? [])
    .slice(0, 2)
    .map((link) => `${link.redactedUrl} (${link.retrievalStatus}; ${link.authorityStatus})`);
}

function getProofBucketLabel(finding: CitationDensityFinding): string {
  if (finding.citationLabel) return finding.citationLabel;
  if (finding.bestAvailableAuthority?.type === "online_fallback") return "ONLINE FALLBACK";
  if (finding.citationStatus.oem === "verified") return "VERIFIED OEM";
  if (finding.citationStatus.adas === "verified") return "VERIFIED ADAS";
  if (finding.citationStatus.stateRegulation === "verified" || finding.citationStatus.policy === "verified") return "VERIFIED LEGAL";
  if (
    finding.citationStatus.invoiceOrCompletionProof === "verified" ||
    finding.citationStatus.photoOrTeardownProof === "verified"
  ) {
    return "VERIFIED DOCUMENTATION";
  }
  if (Object.values(finding.citationStatus).some((value) => value === "referenced_not_produced")) return "REFERENCED / NOT PRODUCED";
  if (finding.citationStatus.adas === "needed" && isAdasRelatedFinding(finding)) return "NEEDS ADAS";
  if (finding.estimateGapType === "weak_do_not_lead") return "WEAK — DO NOT LEAD";
  if (finding.estimateGapType === "referenced_not_produced") return "REFERENCED / NOT PRODUCED";
  if (finding.citationStatus.invoiceOrCompletionProof === "needed") return "NEEDS INVOICE";
  if (isPPageDegMotorFinding(finding)) return "NEEDS P-PAGE";
  if (
    (finding.citationStatus.oem === "needed" || finding.missingAuthorityTypes.some((item) => /oem|high[-\s]?voltage|hv/i.test(item))) &&
    isOemHvRelatedFinding(finding)
  ) return "NEEDS OEM";
  if (finding.citationStatus.pPages === "needed" || finding.missingAuthorityTypes.some((item) => /p-?page/i.test(item))) return "NEEDS P-PAGE";
  return "ESTIMATE GAP ONLY";
}

function isAdasRelatedFinding(finding: CitationDensityFinding) {
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
  ].join(" ");
  if (isPPageDegMotorFinding(finding)) return false;
  return /\b(?:adas|calibration|calibrate|aim|scan|diagnostic|dtc|radar|camera|sensor|blind spot|lane|aeb|srs|airbag|restraint|initiali[sz]ation|programming|module|pre[-\s]?scan|post[-\s]?scan)\b/i.test(text);
}

function isOemHvRelatedFinding(finding: CitationDensityFinding) {
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    ...finding.missingAuthorityTypes,
  ].join(" ");
  if (isPPageDegMotorFinding(finding)) return false;
  return /\b(?:high[-\s]?voltage|hv\b|ev battery|battery charge|isolation|deactivate|activate|oem procedure|position statement|one[-\s]?time[-\s]?use|structural|substrate|aluminum|material rule|repair method|fit[-\s]?sensitive)\b/i.test(text);
}

function isPPageDegMotorFinding(finding: CitationDensityFinding) {
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    ...finding.missingAuthorityTypes,
  ].join(" ");
  return /\b(?:finish sand|de[-\s]?nib|polish|mask|primer|refinish|paint|color|tint|pre[-\s]?wash|clean for delivery|adhesive|feather|prime|block|overlap|included|not included|database|manual entr|p-?page|deg|motor)\b/i.test(text);
}

function formatBestAuthority(finding: CitationDensityFinding) {
  const authority = finding.bestAvailableAuthority;
  if (!authority) {
    return "Estimate evidence only; no reviewed authority attached.";
  }
  return `${authority.title} (${authority.status}; ${authority.type}; ${authority.confidence} confidence)`;
}

function formatMissingAuthority(finding: CitationDensityFinding) {
  const missing = finding.missingAuthority?.length ? finding.missingAuthority : finding.missingAuthorityTypes;
  return missing.length ? missing.join(", ") : "None identified from current Citation Density review.";
}

function buildRoleCalloutNote(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const delta = buildEstimateDeltaText(finding);
  if (finding.crossEstimateIssue || finding.primaryAnnotationRole === "both" || finding.estimateGapType === "reduced_by_carrier") {
    return `Cross-estimate conflict. Carrier and shop estimates carry different labor/amount/scope. Reconcile with procedure support and completion proof.${delta}`;
  }
  if (estimateRole === "carrier") {
    if (finding.estimateGapType === "missing_from_carrier") {
      return "Missing or not located compared with shop estimate. Estimate evidence shows a difference, but OEM/P-page/invoice support has not yet been verified.";
    }
    return `Reduced or missing compared with shop estimate. Estimate evidence shows a difference, but OEM/P-page/invoice support has not yet been verified.${delta}`;
  }
  if (estimateRole === "shop") {
    if (finding.estimateGapType === "missing_from_carrier") {
      return "Not clearly carried on carrier estimate. Do not lead with this line until the missing OEM/P-page/invoice support is attached.";
    }
    return "Shop-added item. Do not lead with this line until the missing OEM/P-page/invoice support is attached.";
  }
  return "Estimate evidence shows a Citation Density issue. Verify authority and completion proof before leading with this item.";
}

function buildEstimateDeltaText(finding: CitationDensityFinding) {
  const amountDelta =
    typeof finding.shopEvidence?.amount === "number" && typeof finding.carrierEvidence?.amount === "number"
      ? ` Amount delta: ${formatSignedNumber(finding.shopEvidence.amount - finding.carrierEvidence.amount)}.`
      : "";
  const laborDelta =
    typeof finding.shopEvidence?.laborHours === "number" && typeof finding.carrierEvidence?.laborHours === "number"
      ? ` Labor delta: ${formatSignedNumber(finding.shopEvidence.laborHours - finding.carrierEvidence.laborHours)} hrs.`
      : "";
  const counterpart = finding.counterpartSummary ? ` ${finding.counterpartSummary}` : "";
  return `${amountDelta}${laborDelta}${counterpart}`;
}

function formatSignedNumber(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function redactAnnotationText(value: string): string {
  return normalizeSourceBoundaryText(redactDownloadContent(value))
    .replace(/\b[A-HJ-NPR-Z0-9]{11}\*{6}\b/g, "[REDACTED_VIN]")
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[REDACTED_VIN]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court)\b\.?/gi, "[REDACTED_ADDRESS]");
}

function normalizeSourceBoundaryText(value: string) {
  return value
    .replace(/\bEstimate documentation the existence of a difference\.?/gi, "Estimate evidence supports the existence of a difference.")
    .replace(/\bCCC Secure Share documentation this estimate line was present in the structured estimate data\.?/gi, CCC_SOURCE_BOUNDARY_TEXT)
    .replace(/\bOEMdocumentation support\b/gi, "OEM/P-page/DEG/legal support")
    .replace(/\bBase Coatdocumentation\b/gi, "Base Coat support")
    .replace(/\b(OEM|P-page|DEG|legal)documentation\b/gi, "$1 support");
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
  const sourceList = [...sourceTokens];
  const targetList = [...targetTokens];
  const matches = sourceList.filter((token) =>
    targetTokens.has(token) ||
    targetList.some((target) => token.length > 4 && (target.includes(token) || token.includes(target)))
  ).length;
  return Math.min(max, Math.round((matches / sourceList.length) * max));
}

function buildKeyTokens(value: string) {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .map(canonicalMatchToken)
      .filter((term) =>
        term.length > 2 &&
        !/^\d+$/.test(term) &&
        !COMMON_MATCH_TERMS.has(term)
      )
  );
}

function canonicalMatchToken(value: string) {
  const token = value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!token) return "";
  const known = [
    "aftermarket",
    "alternate",
    "bumper",
    "cover",
    "reflector",
    "molding",
    "blind",
    "spot",
    "radar",
    "calibration",
    "initialization",
    "pre",
    "post",
    "repair",
    "scan",
    "adas",
    "revvadas",
    "corrosion",
    "protection",
    "mask",
    "jamb",
    "jambs",
    "color",
    "sand",
    "polish",
    "paint",
    "supplies",
    "materials",
    "refinish",
    "labor",
    "rate",
    "manual",
    "motor",
    "database",
    "included",
    "section",
    "note",
    "total",
  ];
  const directAlias: Record<string, string> = {
    "a": "",
    "m": "",
    "am": "aftermarket",
    "scanm": "scan",
    "spre": "pre",
    "spost": "post",
    "proc": "",
    "hrs": "hours",
    "lt": "left",
    "rt": "right",
  };
  if (directAlias[token] !== undefined) return directAlias[token];
  const embedded = known.find((item) =>
    token !== item &&
    token.length <= item.length + 3 &&
    token.includes(item)
  );
  return embedded ?? token.replace(/s$/, "");
}

function scoreSectionAffinity(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const roleAnchor = estimateRole === "shop" ? finding.shopAnchor : estimateRole === "carrier" ? finding.carrierAnchor : null;
  const text = anchor.normalizedText;
  let score = 0;
  const section = normalizeMatchText(roleAnchor?.section ?? "");
  if (section) {
    if (text.includes(section) || section.includes(text)) score += 36;
    score += keyTokenScore(section, text, 22);
  }

  const operation = normalizeMatchText(`${finding.operationLabel} ${roleAnchor?.operation ?? ""}`);
  if (/scan|calibration|radar|initialization|adas/.test(operation) && /scan|calibration|diagnostic|adas|radar|electrical/.test(text)) {
    score += 22;
  }
  if (/aftermarket|bumper|cover|reflector|molding|part/.test(operation) && /parts|part|bumper|cover|reflector|molding|aftermarket|a m/.test(text)) {
    score += 22;
  }
  if (/refinish|paint|mask|jamb|sand|polish|material|suppl/.test(operation) && /refinish|paint|mask|jamb|sand|polish|material|suppl/.test(text)) {
    score += 22;
  }
  if (/corrosion|protection|seam|cavity|weld/.test(operation) && /corrosion|protection|seam|cavity|weld/.test(text)) {
    score += 22;
  }
  if (/total|labor|rate|paint/.test(operation) && /total|labor|rate|paint|suppl|material/.test(text)) {
    score += 18;
  }
  return score;
}

function matchesLineNumber(text: string, lineNumber: string) {
  const escaped = escapeRegex(lineNumber.trim());
  if (!escaped) return false;
  return new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(text);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

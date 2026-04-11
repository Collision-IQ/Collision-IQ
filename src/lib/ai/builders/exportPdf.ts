import jsPDF from "jspdf";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";

const LINE_HEIGHT = 4.8;
const LINE_HEIGHT_FACTOR = 1.15;
const SECTION_GAP = 5;
const BLOCK_GAP = 3.2;
const HEADING_BODY_GAP = 2.4;
const HEADING_HEIGHT = 9;

export type PdfPageLayout = {
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  contentWidth: number;
  topMargin: number;
  bottomMargin: number;
  contentBottomY: number;
  usableHeight: number;
};

type PdfRenderState = {
  y: number;
  lastPageNumber: number;
};

type PdfColor = [number, number, number];

const DEFAULT_TYPOGRAPHY = {
  fontFamily: "Helvetica",
  fontStyle: "Normal" as const,
  fontSize: 10,
  textColor: [60, 63, 68] as PdfColor,
  lineHeightFactor: LINE_HEIGHT_FACTOR,
  sectionGap: SECTION_GAP,
  blockGap: BLOCK_GAP,
  headingBodyGap: HEADING_BODY_GAP,
};

export async function exportCarrierPDF(input: CarrierReportDocument) {
  const redactedInput = redactCarrierReportDocument(input);

  const doc = new jsPDF({
    unit: "mm",
    format: "letter",
  });

  const layout = createPdfPageLayout(doc);
  const logoDataUrl = await loadLogoDataUrl(redactedInput.brand.logoPath).catch(() => null);
  const state: PdfRenderState = {
    y: layout.topMargin,
    lastPageNumber: doc.getCurrentPageInfo().pageNumber,
  };

  drawPageFrame(doc, layout.pageWidth, layout.pageHeight);
  resetPdfPageState(doc);

  state.y = drawBrandedHeader(doc, {
    x: layout.marginX,
    y: state.y,
    width: layout.contentWidth,
    logoDataUrl,
    companyName: redactedInput.brand.companyName,
    reportLabel: redactedInput.brand.reportLabel,
    title: redactedInput.header.title,
    subtitle: redactedInput.header.subtitle,
    generatedLabel: redactedInput.header.generatedLabel,
  });
  state.y += SECTION_GAP;

  ensurePdfSpace(doc, state, layout, estimateSummaryGridHeight(doc, layout.contentWidth, redactedInput.summary));
  state.y = drawSummaryGrid(doc, {
    x: layout.marginX,
    y: state.y,
    width: layout.contentWidth,
    items: redactedInput.summary,
  });
  state.y += SECTION_GAP + 1.5;

  for (const section of redactedInput.sections) {
    const sectionHeight = estimateSectionHeight(doc, layout.contentWidth, section);
    const keepTogetherHeight = estimateSectionKeepTogetherHeight(doc, layout.contentWidth, section);

    if (sectionHeight <= layout.usableHeight && state.y + sectionHeight > layout.contentBottomY) {
      addPdfPage(doc, state, layout, { force: true });
    } else {
      ensurePdfSpace(doc, state, layout, Math.min(sectionHeight, keepTogetherHeight));
    }

    drawSection(doc, {
      x: layout.marginX,
      width: layout.contentWidth,
      section,
      state,
      layout,
    });
    state.y += SECTION_GAP + 1;
  }

  const footerHeight = estimateFooterHeight(doc, layout.contentWidth, redactedInput.footer);
  ensurePdfSpace(doc, state, layout, footerHeight);
  resetPdfPageState(doc);
  state.y = drawFooterBlock(doc, {
    x: layout.marginX,
    y: state.y,
    width: layout.contentWidth,
    footer: redactedInput.footer,
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawPageNumber(doc, layout.pageWidth, layout.pageHeight);
  }

  doc.save(redactedInput.filename || "collision-academy-report.pdf");
}

function redactCarrierReportDocument(input: CarrierReportDocument): CarrierReportDocument {
  return {
    ...input,
    header: {
      ...input.header,
      title: redactDownloadContent(input.header.title),
      subtitle: redactDownloadContent(input.header.subtitle),
      generatedLabel: redactDownloadContent(input.header.generatedLabel),
    },
    summary: input.summary.map((item) => ({
      label: item.label,
      value: redactDownloadContent(item.value),
    })),
    sections: input.sections.map((section) => ({
      ...section,
      title: redactDownloadContent(section.title),
      body: section.body ? redactDownloadContent(section.body) : undefined,
      bullets: section.bullets?.map((bullet) => redactDownloadContent(bullet)),
      comparisonRows: section.comparisonRows?.map((row) => ({
        ...row,
        label: redactDownloadContent(row.label),
        leftLabel: redactDownloadContent(row.leftLabel),
        leftValue: redactDownloadContent(row.leftValue),
        rightLabel: redactDownloadContent(row.rightLabel),
        rightValue: redactDownloadContent(row.rightValue),
        delta: row.delta ? redactDownloadContent(row.delta) : undefined,
        note: row.note ? redactDownloadContent(row.note) : undefined,
      })),
    })),
    footer: input.footer.map((line) => redactDownloadContent(line)),
  };
}

export function createPdfPageLayout(doc: Pick<jsPDF, "internal">): PdfPageLayout {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const topMargin = 18;
  const bottomMargin = 18;
  const contentWidth = pageWidth - marginX * 2;
  const contentBottomY = pageHeight - bottomMargin;

  return {
    pageWidth,
    pageHeight,
    marginX,
    contentWidth,
    topMargin,
    bottomMargin,
    contentBottomY,
    usableHeight: contentBottomY - topMargin,
  };
}

export function resetPdfPageState(
  doc: Pick<jsPDF, "setFont" | "setFontSize" | "setTextColor" | "setLineHeightFactor">
) {
  doc.setFont(DEFAULT_TYPOGRAPHY.fontFamily, DEFAULT_TYPOGRAPHY.fontStyle);
  doc.setFontSize(DEFAULT_TYPOGRAPHY.fontSize);
  doc.setLineHeightFactor(DEFAULT_TYPOGRAPHY.lineHeightFactor);
  doc.setTextColor(...DEFAULT_TYPOGRAPHY.textColor);
}

export function addPdfPage(
  doc: Pick<jsPDF, "addPage" | "getCurrentPageInfo" | "setFont" | "setFontSize" | "setTextColor" | "setLineHeightFactor">,
  state: PdfRenderState,
  layout: PdfPageLayout,
  options?: { force?: boolean }
): boolean {
  const currentPageNumber = doc.getCurrentPageInfo().pageNumber;
  const atFreshTop = state.y <= layout.topMargin + 0.1;

  if (!options?.force && atFreshTop && currentPageNumber === state.lastPageNumber) {
    resetPdfPageState(doc);
    return false;
  }

  doc.addPage();
  state.y = layout.topMargin;
  state.lastPageNumber = doc.getCurrentPageInfo().pageNumber;
  drawPageFrame(doc as jsPDF, layout.pageWidth, layout.pageHeight);
  resetPdfPageState(doc);
  return true;
}

export function ensurePdfSpace(
  doc: Pick<jsPDF, "addPage" | "getCurrentPageInfo" | "setFont" | "setFontSize" | "setTextColor" | "setLineHeightFactor">,
  state: PdfRenderState,
  layout: PdfPageLayout,
  requiredHeight: number
) {
  if (state.y > layout.contentBottomY) {
    addPdfPage(doc, state, layout);
    return;
  }
  if (state.y + Math.max(requiredHeight, 0) <= layout.contentBottomY) {
    return;
  }
  addPdfPage(doc, state, layout);
}

async function loadLogoDataUrl(path: string): Promise<string> {
  const response = await fetch(path);
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read logo asset."));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read logo asset."));
    reader.readAsDataURL(blob);
  });
}

function drawPageFrame(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setDrawColor(223, 226, 232);
  doc.setLineWidth(0.2);
  doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
}

function drawBrandedHeader(
  doc: jsPDF,
  params: {
    x: number;
    y: number;
    width: number;
    logoDataUrl: string | null;
    companyName: string;
    reportLabel: string;
    title: string;
    subtitle: string;
    generatedLabel: string;
  }
): number {
  const topBandHeight = 18;
  const titleY = params.y + topBandHeight + 8;
  const logoBox = {
    x: params.x + 4,
    y: params.y + 4,
    width: 28,
    height: 8.5,
  };
  let logoRightX = logoBox.x;

  doc.setFillColor(248, 246, 242);
  doc.roundedRect(params.x, params.y, params.width, topBandHeight, 2, 2, "F");

  if (params.logoDataUrl) {
    const logoSize = resolveContainedImageSize(doc, params.logoDataUrl, logoBox.width, logoBox.height);
    const logoY = logoBox.y + (logoBox.height - logoSize.height) / 2;
    doc.addImage(params.logoDataUrl, "PNG", logoBox.x, logoY, logoSize.width, logoSize.height);
    logoRightX = logoBox.x + logoSize.width;
  }

  const brandTextX = Math.max(params.x + 42, logoRightX + 4);

  doc.setTextColor(62, 65, 70);
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(9);
  doc.text(params.companyName.toUpperCase(), brandTextX, params.y + 6.5);

  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(8.5);
  doc.text(params.reportLabel, brandTextX, params.y + 11.5);

  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(18);
  doc.setTextColor(28, 28, 30);
  doc.text(params.title, params.x, titleY);

  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(10);
  doc.setTextColor(82, 86, 92);
  const subtitleLines = doc.splitTextToSize(params.subtitle, params.width);
  doc.text(subtitleLines, params.x, titleY + 6);

  doc.setFontSize(8.5);
  doc.setTextColor(125, 129, 134);
  doc.text(params.generatedLabel, params.x + params.width, params.y + 7, { align: "right" });

  doc.setDrawColor(198, 90, 42);
  doc.setLineWidth(0.9);
  const dividerY = titleY + 6 + subtitleLines.length * LINE_HEIGHT + 3;
  doc.line(params.x, dividerY, params.x + params.width, dividerY);

  return dividerY;
}

function resolveContainedImageSize(
  doc: jsPDF,
  imageDataUrl: string,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  try {
    const imageProperties = doc.getImageProperties(imageDataUrl);
    const intrinsicWidth =
      typeof imageProperties.width === "number" && imageProperties.width > 0
        ? imageProperties.width
        : maxWidth;
    const intrinsicHeight =
      typeof imageProperties.height === "number" && imageProperties.height > 0
        ? imageProperties.height
        : maxHeight;
    const scale = Math.min(maxWidth / intrinsicWidth, maxHeight / intrinsicHeight);

    return {
      width: Number((intrinsicWidth * scale).toFixed(2)),
      height: Number((intrinsicHeight * scale).toFixed(2)),
    };
  } catch {
    return {
      width: maxWidth,
      height: maxHeight,
    };
  }
}

function drawSummaryGrid(
  doc: jsPDF,
  params: {
    x: number;
    y: number;
    width: number;
    items: Array<{ label: string; value: string }>;
  }
): number {
  const columnGap = 4;
  const cellWidth = (params.width - columnGap) / 2;
  const innerPaddingX = 3.5;
  const topPadding = 4;
  const bottomPadding = 3.5;
  const rowGap = 4;
  let maxY = params.y;

  params.items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellX = params.x + column * (cellWidth + columnGap);
    const cellY = params.y + row * (26 + rowGap);
    const valueLines = doc.splitTextToSize(item.value, cellWidth - innerPaddingX * 2);
    const visibleLines = Math.max(1, Math.min(valueLines.length, 4));
    const cellHeight = topPadding + 4.5 + 2 + visibleLines * 4.3 + bottomPadding;

    doc.setFillColor(250, 250, 251);
    doc.setDrawColor(230, 232, 236);
    doc.roundedRect(cellX, cellY, cellWidth, cellHeight, 2, 2, "FD");

    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(7.5);
    doc.setTextColor(96, 100, 106);
    doc.text(item.label.toUpperCase(), cellX + innerPaddingX, cellY + topPadding + 1);

    doc.setFont("Helvetica", "Normal");
    doc.setFontSize(10);
    doc.setTextColor(35, 37, 40);
    doc.text(valueLines.slice(0, 4), cellX + innerPaddingX, cellY + topPadding + 7.2);
    maxY = Math.max(maxY, cellY + cellHeight);
  });

  return maxY;
}

function estimateSummaryGridHeight(
  doc: Pick<jsPDF, "splitTextToSize">,
  width: number,
  items: Array<{ label: string; value: string }>
): number {
  const columnGap = 4;
  const cellWidth = (width - columnGap) / 2;
  const innerPaddingX = 3.5;
  const topPadding = 4;
  const bottomPadding = 3.5;
  const rowGap = 4;
  let height = 0;

  items.forEach((item, index) => {
    const valueLines = doc.splitTextToSize(item.value, cellWidth - innerPaddingX * 2);
    const visibleLines = Math.max(1, Math.min(valueLines.length, 4));
    const cellHeight = topPadding + 4.5 + 2 + visibleLines * 4.3 + bottomPadding;
    const row = Math.floor(index / 2);
    height = Math.max(height, row * (26 + rowGap) + cellHeight);
  });

  return height;
}

export function estimateSectionKeepTogetherHeight(
  doc: Pick<jsPDF, "splitTextToSize">,
  width: number,
  section: CarrierReportDocument["sections"][number]
): number {
  let height = HEADING_HEIGHT;

  if (section.body) {
    const bodyLines = doc.splitTextToSize(section.body, width);
    height += HEADING_BODY_GAP + Math.max(1, bodyLines.length) * LINE_HEIGHT;
    return height;
  }

  if (section.comparisonRows?.length) {
    height += HEADING_BODY_GAP + estimateComparisonRowHeight(doc, width, section.comparisonRows[0]);
    return height;
  }

  if (section.bullets?.length) {
    const bulletLines = doc.splitTextToSize(section.bullets[0], width - 8);
    height += HEADING_BODY_GAP + Math.max(1, bulletLines.length) * LINE_HEIGHT + BLOCK_GAP;
  }

  return height;
}

export function estimateSectionHeight(
  doc: Pick<jsPDF, "splitTextToSize">,
  width: number,
  section: CarrierReportDocument["sections"][number]
): number {
  let height = HEADING_HEIGHT;

  if (section.body) {
    const bodyLines = doc.splitTextToSize(section.body, width);
    height += HEADING_BODY_GAP + Math.max(1, bodyLines.length) * LINE_HEIGHT + BLOCK_GAP;
  }

  if (section.comparisonRows?.length) {
    if (!section.body) height += HEADING_BODY_GAP;
    height += section.comparisonRows.reduce(
      (sum, row) => sum + estimateComparisonRowHeight(doc, width, row) + BLOCK_GAP,
      0
    );
  }

  if (section.bullets?.length) {
    if (!section.body && !section.comparisonRows?.length) height += HEADING_BODY_GAP;
    height += section.bullets.reduce((sum, bullet) => {
      const lines = doc.splitTextToSize(bullet, width - 8);
      return sum + Math.max(1, lines.length) * LINE_HEIGHT + BLOCK_GAP;
    }, 0);
  }

  return height;
}

export function estimateComparisonRowHeight(
  doc: Pick<jsPDF, "splitTextToSize">,
  width: number,
  row: NonNullable<CarrierReportDocument["sections"][number]["comparisonRows"]>[number]
): number {
  const innerWidth = width - 8;
  const valueX = 22;
  const valueWidth = Math.max(10, width - valueX - 4);
  let height = 0;

  height += Math.max(1, doc.splitTextToSize(`[ ${row.label.toUpperCase()} ]`, innerWidth).length) * LINE_HEIGHT;
  height += BLOCK_GAP / 2;

  const fields: Array<string | undefined> = [
    row.leftValue,
    row.rightValue,
    row.delta,
    row.note,
  ];

  for (const field of fields) {
    if (!field?.trim()) continue;
    height += Math.max(1, doc.splitTextToSize(field, valueWidth).length) * LINE_HEIGHT;
    height += BLOCK_GAP / 2;
  }

  return height;
}

function drawSection(
  doc: jsPDF,
  params: {
    x: number;
    width: number;
    section: CarrierReportDocument["sections"][number];
    state: PdfRenderState;
    layout: PdfPageLayout;
  }
) {
  const startContinuationPage = () => {
    addPdfPage(doc, params.state, params.layout, { force: true });
    drawSectionHeading(doc, params.x, params.width, params.section.title, params.state, true);
  };

  ensurePdfSpace(
    doc,
    params.state,
    params.layout,
    Math.min(estimateSectionKeepTogetherHeight(doc, params.width, params.section), params.layout.usableHeight)
  );
  drawSectionHeading(doc, params.x, params.width, params.section.title, params.state, false);

  if (params.section.body) {
    params.state.y += HEADING_BODY_GAP;
    doc.setFont("Helvetica", "Normal");
    doc.setFontSize(10);
    doc.setTextColor(...DEFAULT_TYPOGRAPHY.textColor);

    for (const line of doc.splitTextToSize(params.section.body, params.width)) {
      if (params.state.y + LINE_HEIGHT > params.layout.contentBottomY) {
        startContinuationPage();
        doc.setFont("Helvetica", "Normal");
        doc.setFontSize(10);
        doc.setTextColor(...DEFAULT_TYPOGRAPHY.textColor);
        params.state.y += HEADING_BODY_GAP;
      }
      doc.text(line, params.x, params.state.y);
      params.state.y += LINE_HEIGHT;
    }
    params.state.y += BLOCK_GAP;
  }

  if (params.section.comparisonRows?.length) {
    if (!params.section.body) params.state.y += HEADING_BODY_GAP;
    for (const row of params.section.comparisonRows) {
      drawComparisonRowBlock(doc, {
        x: params.x,
        width: params.width,
        row,
        state: params.state,
        layout: params.layout,
        startContinuationPage,
      });
      params.state.y += BLOCK_GAP;
    }
  }

  if (params.section.bullets?.length) {
    if (!params.section.body && !params.section.comparisonRows?.length) {
      params.state.y += HEADING_BODY_GAP;
    }

    for (const bullet of params.section.bullets) {
      doc.setFont("Helvetica", "Normal");
      doc.setFontSize(10);
      doc.setTextColor(62, 65, 70);

      for (const [index, line] of doc.splitTextToSize(bullet, params.width - 8).entries()) {
        if (params.state.y + LINE_HEIGHT > params.layout.contentBottomY) {
          startContinuationPage();
          doc.setFont("Helvetica", "Normal");
          doc.setFontSize(10);
          doc.setTextColor(62, 65, 70);
          params.state.y += HEADING_BODY_GAP;
        }
        if (index === 0) {
          doc.setFillColor(190, 80, 30);
          doc.circle(params.x + 1.8, params.state.y - 1.2, 0.8, "F");
        }
        doc.text(line, params.x + 5, params.state.y);
        params.state.y += LINE_HEIGHT;
      }
      params.state.y += BLOCK_GAP;
    }
  }
}

function drawSectionHeading(
  doc: jsPDF,
  x: number,
  width: number,
  title: string,
  state: PdfRenderState,
  continued: boolean
) {
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(11.5);
  doc.setTextColor(190, 80, 30);
  doc.text(continued ? `${title.toUpperCase()} (CONT.)` : title.toUpperCase(), x, state.y);

  doc.setDrawColor(226, 228, 233);
  doc.setLineWidth(0.25);
  doc.line(x, state.y + 1.5, x + width, state.y + 1.5);
  state.y += HEADING_HEIGHT;
}

function drawComparisonRowBlock(
  doc: jsPDF,
  params: {
    x: number;
    width: number;
    row: NonNullable<CarrierReportDocument["sections"][number]["comparisonRows"]>[number];
    state: PdfRenderState;
    layout: PdfPageLayout;
    startContinuationPage: () => void;
  }
) {
  const innerX = params.x + 4;
  const innerWidth = params.width - 8;
  const valueX = innerX + 18;
  const valueWidth = Math.max(10, params.width - (valueX - params.x) - 4);
  const rowHeight = estimateComparisonRowHeight(doc, params.width, params.row);

  if (rowHeight <= params.layout.usableHeight && params.state.y + rowHeight > params.layout.contentBottomY) {
    params.startContinuationPage();
  }

  const ensureLineSpace = () => {
    if (params.state.y + LINE_HEIGHT <= params.layout.contentBottomY) return;
    params.startContinuationPage();
  };

  const drawTagLine = (line: string) => {
    ensureLineSpace();
    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(10.5);
    doc.setTextColor(35, 37, 40);
    doc.text(line, innerX, params.state.y + 3);
    params.state.y += LINE_HEIGHT;
  };

  const drawLabeledField = (
    fieldLabel: string,
    fieldValue: string | undefined,
    options?: { boldValue?: boolean; color?: PdfColor; isNote?: boolean }
  ) => {
    const value = (fieldValue || "").trim();
    if (!value) return;

    const valueLines = doc.splitTextToSize(value, valueWidth);
    valueLines.forEach((line, index) => {
      ensureLineSpace();
      if (index === 0) {
        doc.setFont("Helvetica", "Bold");
        doc.setFontSize(options?.isNote ? 8.5 : 9.5);
        doc.setTextColor(58, 61, 66);
        doc.text(`${fieldLabel}:`, innerX, params.state.y + 3);
      }

      doc.setFont("Helvetica", options?.boldValue ? "Bold" : "Normal");
      doc.setFontSize(options?.isNote ? 8.5 : 9.5);
      doc.setTextColor(...(options?.color ?? DEFAULT_TYPOGRAPHY.textColor));
      doc.text(line, valueX, params.state.y + 3);
      params.state.y += LINE_HEIGHT;
    });

    params.state.y += BLOCK_GAP / 2;
  };

  for (const line of doc.splitTextToSize(`[ ${params.row.label.toUpperCase()} ]`, innerWidth)) {
    drawTagLine(line);
  }
  params.state.y += BLOCK_GAP / 2;

  drawLabeledField(params.row.leftLabel || "Shop", params.row.leftValue);
  drawLabeledField(params.row.rightLabel || "Carrier", params.row.rightValue);
  drawLabeledField("Delta", params.row.delta, { boldValue: true, color: [104, 64, 36] });
  drawLabeledField("Note", params.row.note, { color: [96, 100, 108], isNote: true });
}

function drawFooterBlock(
  doc: jsPDF,
  params: {
    x: number;
    y: number;
    width: number;
    footer: string[];
  }
): number {
  const lines = doc.splitTextToSize(params.footer.join(" "), params.width - 6);
  const blockHeight = Math.max(16, lines.length * LINE_HEIGHT + BLOCK_GAP);
  doc.setFillColor(248, 248, 249);
  doc.roundedRect(params.x, params.y, params.width, blockHeight, 2, 2, "F");
  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(8.5);
  doc.setTextColor(103, 107, 112);
  doc.text(lines, params.x + 3, params.y + 5);
  return params.y + blockHeight;
}

function drawPageNumber(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(8);
  doc.setTextColor(125, 129, 134);
  doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - 16, pageHeight - 4, {
    align: "right",
  });
}

function estimateFooterHeight(
  doc: Pick<jsPDF, "splitTextToSize">,
  width: number,
  footer: string[]
): number {
  const lines = doc.splitTextToSize(footer.join(" "), width - 6);
  return Math.max(16, lines.length * LINE_HEIGHT + BLOCK_GAP);
}

export const __testables = {
  createPdfPageLayout,
  resetPdfPageState,
  addPdfPage,
  ensurePdfSpace,
  estimateSectionHeight,
  estimateSectionKeepTogetherHeight,
  estimateComparisonRowHeight,
};

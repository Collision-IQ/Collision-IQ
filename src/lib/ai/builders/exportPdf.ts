import jsPDF from "jspdf";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";

export async function exportCarrierPDF(input: string | CarrierReportDocument) {
  if (typeof input === "string") {
    exportLegacyTextPdf(redactDownloadContent(input));
    return;
  }

  const redactedInput = redactCarrierReportDocument(input);

  const doc = new jsPDF({
    unit: "mm",
    format: "letter",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const contentWidth = pageWidth - marginX * 2;
  const topMargin = 18;
  const bottomMargin = 18;
  const contentBottomY = pageHeight - bottomMargin;
  const logoDataUrl = await loadLogoDataUrl(redactedInput.brand.logoPath).catch(() => null);

  let y = topMargin;

  const addPage = () => {
    doc.addPage();
    y = topMargin;
    drawPageFrame(doc, pageWidth, pageHeight);
  };

  const ensureSpace = (requiredHeight: number) => {
    if (y + requiredHeight <= contentBottomY) return;
    addPage();
  };

  drawPageFrame(doc, pageWidth, pageHeight);
  y = drawBrandedHeader(doc, {
    x: marginX,
    y,
    width: contentWidth,
    logoDataUrl,
    companyName: redactedInput.brand.companyName,
    reportLabel: redactedInput.brand.reportLabel,
    title: redactedInput.header.title,
    subtitle: redactedInput.header.subtitle,
    generatedLabel: redactedInput.header.generatedLabel,
  });
  y += 6;

  ensureSpace(estimateSummaryGridHeight(doc, contentWidth, redactedInput.summary));
  y = drawSummaryGrid(doc, {
    x: marginX,
    y,
    width: contentWidth,
    items: redactedInput.summary,
  });
  y += 9;

  for (const section of redactedInput.sections) {
    ensureSpace(16);
    y = drawSection(doc, {
      x: marginX,
      y,
      width: contentWidth,
      section,
      contentBottomY,
      topMargin,
      startNewPage: addPage,
    });
    y += 6;
  }

  const footerHeight = estimateFooterHeight(doc, contentWidth, redactedInput.footer);
  ensureSpace(footerHeight);
  y = drawFooterBlock(doc, {
    x: marginX,
    y,
    width: contentWidth,
    footer: redactedInput.footer,
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawPageNumber(doc, pageWidth, pageHeight);
  }

  doc.save(redactedInput.filename || "collision-academy-report.pdf");
}

function exportLegacyTextPdf(text: string) {
  const doc = new jsPDF();
  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(12);

  const marginX = 10;
  const topMargin = 12;
  const bottomMargin = 18;
  const lineHeight = 6.2;
  const maxWidth = 180;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomY = pageHeight - bottomMargin;
  const lines = doc.splitTextToSize(text, maxWidth);

  let y = topMargin;

  for (const line of lines) {
    if (y + lineHeight > bottomY) {
      doc.addPage();
      y = topMargin;
    }

    doc.text(line, marginX, y);
    y += lineHeight;
  }

  doc.save("collision-evaluation.pdf");
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
    })),
    footer: input.footer.map((line) => redactDownloadContent(line)),
  };
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
  const dividerY = titleY + 6 + subtitleLines.length * 4.4 + 3;
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
    const cellY = params.y + row * (22 + rowGap);
    const valueLines = doc.splitTextToSize(item.value, cellWidth - innerPaddingX * 2);
    const visibleLines = Math.max(1, Math.min(valueLines.length, 3));
    const cellHeight = topPadding + 4.5 + 2 + visibleLines * 4.3 + bottomPadding;

    doc.setFillColor(250, 250, 251);
    doc.setDrawColor(230, 232, 236);
    doc.roundedRect(cellX, cellY, cellWidth, cellHeight, 2, 2, "FD");

    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(8);
    doc.setTextColor(108, 112, 118);
    doc.text(item.label.toUpperCase(), cellX + innerPaddingX, cellY + topPadding + 1);

    doc.setFont("Helvetica", "Normal");
    doc.setFontSize(10);
    doc.setTextColor(35, 37, 40);
    doc.text(valueLines.slice(0, 3), cellX + innerPaddingX, cellY + topPadding + 7.2);
    maxY = Math.max(maxY, cellY + cellHeight);
  });

  return maxY;
}

function estimateSummaryGridHeight(
  doc: jsPDF,
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
    const visibleLines = Math.max(1, Math.min(valueLines.length, 3));
    const cellHeight = topPadding + 4.5 + 2 + visibleLines * 4.3 + bottomPadding;
    const row = Math.floor(index / 2);
    height = Math.max(height, row * (22 + rowGap) + cellHeight);
  });

  return height;
}

function drawSection(
  doc: jsPDF,
  params: {
    x: number;
    y: number;
    width: number;
    section: CarrierReportDocument["sections"][number];
    contentBottomY: number;
    topMargin: number;
    startNewPage: () => void;
  }
): number {
  let y = params.y;

  const drawHeading = (continued = false) => {
    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(11);
    doc.setTextColor(198, 90, 42);
    doc.text(
      continued ? `${params.section.title.toUpperCase()} (CONT.)` : params.section.title.toUpperCase(),
      params.x,
      y
    );

    doc.setDrawColor(226, 228, 233);
    doc.setLineWidth(0.25);
    doc.line(params.x, y + 1.5, params.x + params.width, y + 1.5);
    y += 9;
  };

  const ensureLineSpace = (requiredHeight: number, continued = true) => {
    if (y + requiredHeight <= params.contentBottomY) return;
    params.startNewPage();
    y = params.topMargin;
    drawHeading(continued);
  };

  drawHeading();

  if (params.section.body) {
    doc.setFont("Helvetica", "Normal");
    doc.setFontSize(10.5);
    doc.setTextColor(38, 40, 44);
    const bodyLines = doc.splitTextToSize(params.section.body, params.width);

    for (const line of bodyLines) {
      ensureLineSpace(4.9);
      doc.text(line, params.x, y);
      y += 4.9;
    }
    y += 3;
  }

  if (params.section.bullets?.length) {
    for (const bullet of params.section.bullets) {
      const bulletLines = doc.splitTextToSize(bullet, params.width - 8);
      doc.setFont("Helvetica", "Normal");
      doc.setFontSize(10);
      doc.setTextColor(38, 40, 44);

      bulletLines.forEach((line: string, index: number) => {
        ensureLineSpace(4.6);
        if (index === 0) {
          doc.setFillColor(198, 90, 42);
          doc.circle(params.x + 1.8, y - 1.2, 0.8, "F");
        }
        doc.text(line, params.x + 5, y);
        y += 4.6;
      });
      y += 2.8;
    }
  }

  return y;
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
  const blockHeight = Math.max(16, lines.length * 4.2 + 6);
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

function estimateFooterHeight(doc: jsPDF, width: number, footer: string[]): number {
  const lines = doc.splitTextToSize(footer.join(" "), width - 6);
  return Math.max(16, lines.length * 4.2 + 6);
}

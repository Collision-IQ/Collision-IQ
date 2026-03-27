import jsPDF from "jspdf";
import type { CarrierReportDocument } from "./carrierPdfBuilder";

export async function exportCarrierPDF(input: string | CarrierReportDocument) {
  if (typeof input === "string") {
    exportLegacyTextPdf(input);
    return;
  }

  const doc = new jsPDF({
    unit: "mm",
    format: "letter",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const contentWidth = pageWidth - marginX * 2;
  const footerY = pageHeight - 10;
  const logoDataUrl = await loadLogoDataUrl(input.brand.logoPath).catch(() => null);

  let y = 18;

  const ensureSpace = (requiredHeight: number) => {
    if (y + requiredHeight <= footerY - 8) return;
    doc.addPage();
    y = 18;
    drawPageFrame(doc, pageWidth, pageHeight);
    drawPageNumber(doc, pageWidth, pageHeight);
  };

  drawPageFrame(doc, pageWidth, pageHeight);
  y = drawBrandedHeader(doc, {
    x: marginX,
    y,
    width: contentWidth,
    logoDataUrl,
    companyName: input.brand.companyName,
    reportLabel: input.brand.reportLabel,
    title: input.header.title,
    subtitle: input.header.subtitle,
    generatedLabel: input.header.generatedLabel,
  });
  y += 6;

  y = drawSummaryGrid(doc, {
    x: marginX,
    y,
    width: contentWidth,
    items: input.summary,
  });
  y += 9;

  for (const section of input.sections) {
    const estimatedHeight = estimateSectionHeight(doc, contentWidth, section);
    ensureSpace(Math.max(22, estimatedHeight));
    y = drawSection(doc, {
      x: marginX,
      y,
      width: contentWidth,
      section,
    });
    y += 6;
  }

  ensureSpace(18);
  y = drawFooterBlock(doc, {
    x: marginX,
    y,
    width: contentWidth,
    footer: input.footer,
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawPageNumber(doc, pageWidth, pageHeight);
  }

  doc.save(input.filename || "collision-academy-report.pdf");
}

function exportLegacyTextPdf(text: string) {
  const doc = new jsPDF();
  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(12);

  const marginX = 10;
  const marginY = 10;
  const lineHeight = 12 * 1.5 * 0.3528;
  const maxWidth = 180;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomY = pageHeight - marginY;
  const lines = doc.splitTextToSize(text, maxWidth);

  let y = marginY;

  for (const line of lines) {
    if (y + lineHeight > bottomY) {
      doc.addPage();
      y = marginY;
    }

    doc.text(line, marginX, y);
    y += lineHeight;
  }

  doc.save("collision-evaluation.pdf");
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
  doc.setFillColor(248, 246, 242);
  doc.roundedRect(params.x, params.y, params.width, topBandHeight, 2, 2, "F");

  if (params.logoDataUrl) {
    doc.addImage(params.logoDataUrl, "PNG", params.x + 4, params.y + 4, 34, 8.5);
  }

  doc.setTextColor(62, 65, 70);
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(9);
  doc.text(params.companyName.toUpperCase(), params.x + 42, params.y + 6.5);

  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(8.5);
  doc.text(params.reportLabel, params.x + 42, params.y + 11.5);

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

function drawSection(
  doc: jsPDF,
  params: {
    x: number;
    y: number;
    width: number;
    section: CarrierReportDocument["sections"][number];
  }
): number {
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(11);
  doc.setTextColor(198, 90, 42);
  doc.text(params.section.title.toUpperCase(), params.x, params.y);

  doc.setDrawColor(226, 228, 233);
  doc.setLineWidth(0.25);
  doc.line(params.x, params.y + 1.5, params.x + params.width, params.y + 1.5);

  let y = params.y + 9;

  if (params.section.body) {
    doc.setFont("Helvetica", "Normal");
    doc.setFontSize(10.5);
    doc.setTextColor(38, 40, 44);
    const bodyLines = doc.splitTextToSize(params.section.body, params.width);
    doc.text(bodyLines, params.x, y);
    y += bodyLines.length * 4.9 + 3;
  }

  if (params.section.bullets?.length) {
    for (const bullet of params.section.bullets) {
      const bulletLines = doc.splitTextToSize(bullet, params.width - 8);
      doc.setFillColor(198, 90, 42);
      doc.circle(params.x + 1.8, y - 1.2, 0.8, "F");
      doc.setFont("Helvetica", "Normal");
      doc.setFontSize(10);
      doc.setTextColor(38, 40, 44);
      doc.text(bulletLines, params.x + 5, y);
      y += bulletLines.length * 4.6 + 2.8;
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
  doc.setFillColor(248, 248, 249);
  doc.roundedRect(params.x, params.y, params.width, 16, 2, 2, "F");
  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(8.5);
  doc.setTextColor(103, 107, 112);
  const lines = doc.splitTextToSize(params.footer.join(" "), params.width - 6);
  doc.text(lines, params.x + 3, params.y + 5);
  return params.y + Math.max(16, lines.length * 4.2 + 6);
}

function drawPageNumber(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(8);
  doc.setTextColor(125, 129, 134);
  doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - 16, pageHeight - 4, {
    align: "right",
  });
}

function estimateSectionHeight(
  doc: jsPDF,
  width: number,
  section: CarrierReportDocument["sections"][number]
): number {
  let height = 12;

  if (section.body) {
    height += doc.splitTextToSize(section.body, width).length * 4.9 + 4;
  }

  if (section.bullets?.length) {
    for (const bullet of section.bullets) {
      height += doc.splitTextToSize(bullet, width - 8).length * 4.6 + 2.8;
    }
  }

  return height;
}

/**
 * Rekey sheet / verification PDF.
 *
 * A keying sheet is worked at a keyboard, so the page is laid out for reading
 * down a column and ticking off rows: monospaced body, one row per line, group
 * headings that repeat nothing, and a rule under each group footer. It renders
 * the same text the report history stores, so the printed sheet and the saved
 * report can never drift apart.
 */

import jsPDF from "jspdf";
import { withWinAnsiText } from "@/lib/pdf/winAnsiText";

const MARGIN_X = 12;
const TOP_Y = 16;
const BOTTOM_Y = 282;
const LINE_HEIGHT = 4.2;
const BODY_SIZE = 8;

export function buildRekeyPdfBlob(params: {
  title: string;
  sheetText: string;
  verificationText?: string | null;
}): Blob {
  const doc = withWinAnsiText(new jsPDF({ unit: "mm", format: "a4" }));
  const contentWidth = doc.internal.pageSize.getWidth() - MARGIN_X * 2;
  let y = TOP_Y;

  const newPage = () => {
    doc.addPage();
    y = TOP_Y;
  };

  const writeLine = (text: string, options?: { bold?: boolean; size?: number; gapBefore?: number }) => {
    const size = options?.size ?? BODY_SIZE;
    if (options?.gapBefore) y += options.gapBefore;
    doc.setFont("courier", options?.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, contentWidth) as string[];
    for (const segment of wrapped) {
      if (y > BOTTOM_Y) newPage();
      doc.text(segment, MARGIN_X, y);
      y += LINE_HEIGHT;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(params.title, MARGIN_X, y);
  y += 7;

  for (const line of params.sheetText.split("\n")) {
    // A heading is a non-indented, upper-case line; everything else is a row.
    const isHeading = line.trim().length > 0 && !line.startsWith(" ") && line === line.toUpperCase();
    writeLine(line || " ", { bold: isHeading });
  }

  if (params.verificationText) {
    newPage();
    for (const line of params.verificationText.split("\n")) {
      const isHeading = line.trim().length > 0 && !line.startsWith(" ") && line === line.toUpperCase();
      writeLine(line || " ", { bold: isHeading });
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Collision iQ · page ${page} of ${pageCount}`, MARGIN_X, 289);
  }

  return doc.output("blob");
}

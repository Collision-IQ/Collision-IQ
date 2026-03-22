import jsPDF from "jspdf";

export function exportCarrierPDF(text: string) {
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

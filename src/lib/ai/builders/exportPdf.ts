import jsPDF from "jspdf";

export function exportCarrierPDF(text: string) {
  const doc = new jsPDF();
  const lines = doc.splitTextToSize(text, 180);
  doc.text(lines, 10, 10);
  doc.save("collision-evaluation.pdf");
}

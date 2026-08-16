// Client-side jsPDF renderers for the two house-format DV documents:
//
//   1. Market Value Report (ACV) — the worksheet: general information, three
//      dealer comps with $0.07/mile adjustments, tax, Recommended ACV, and a
//      Diminished Value calculation page with the 17c cross-check.
//   2. Diminished Value demand letter — Collision Academy letterhead, claim
//      block, the demand math spelled out, appraisal fee as an additional
//      indirect loss, 15-day terms, signed by the claimant themselves.
//
// Every figure comes verbatim from the stored DvResult — these renderers
// format, they never calculate. Projected values are labeled as projected.

import jsPDF from "jspdf";
import { isNative, saveAndShareBlob } from "@/lib/native";
import type { DvReportData } from "@/lib/dv/types";

const PAGE = { width: 215.9, height: 279.4, marginX: 16, top: 14, bottom: 16 };
const CONTENT_WIDTH = PAGE.width - PAGE.marginX * 2;

const BRAND = {
  companyName: "Collision Academy",
  // Stacked badge mark — the documents carry the brand, never an individual's
  // name, license, or contact details.
  logoPath: "/brand/logos/badge.png",
};

// Personal/claim data provenance — printed on every generated document.
const DISCLAIMER =
  "Owner, claim, and vehicle identifying information appearing in this document was supplied by the " +
  "requesting party and is reproduced solely for that party's own use in presenting their claim; " +
  "Collision Academy has not independently verified owner-supplied information and makes no " +
  "representation regarding it. Market values are drawn from the retail listings cited herein as of " +
  "the date of access; each listing remains subject to change or removal by its publisher.";

const INK: [number, number, number] = [40, 42, 46];
const MUTED: [number, number, number] = [110, 114, 120];
const ACCENT: [number, number, number] = [196, 90, 36];
const RULE: [number, number, number] = [180, 183, 188];

function usd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function num(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

function signed(value: number): string {
  const formatted = usd(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

/**
 * Every report link routes through the outbound listing page, whose
 * "Open listing in a new tab" button is honored by every browser — a plain
 * URI link's target behavior is the PDF viewer's choice, and Chrome's viewer
 * navigates the report tab away. The printed URL text remains the raw
 * listing address for transparency; only the click destination changes.
 */
function listingHref(url: string): string {
  return `https://www.collision-iq.ai/listing?u=${encodeURIComponent(url)}`;
}

/** jsPDF's built-in fonts are WinAnsi — U+2212/en/em dashes and curly quotes
 *  fall back to garbage glyphs and break line metrics. Normalize to ASCII. */
function pdfSafe(text: string): string {
  return text
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

async function loadLogoDataUrl(path: string): Promise<string | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function drawLogo(
  doc: jsPDF,
  logo: string | null,
  x: number,
  y: number,
  width = 22
): number {
  if (!logo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...ACCENT);
    doc.text(BRAND.companyName.toUpperCase(), x, y + 6);
    doc.setTextColor(...INK);
    return y + 10;
  }
  try {
    const props = doc.getImageProperties(logo);
    const height = (props.height / props.width) * width;
    doc.addImage(logo, "PNG", x, y, width, height);
    return y + height + 2;
  } catch {
    return y + 10;
  }
}

function drawDisclaimer(doc: jsPDF, y: number): number {
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(PAGE.marginX, y, PAGE.width - PAGE.marginX, y);
  y += 3.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  doc.setTextColor(...MUTED);
  const lines = doc.splitTextToSize(pdfSafe(DISCLAIMER), CONTENT_WIDTH);
  doc.text(lines, PAGE.marginX, y);
  return y + lines.length * 3.1 + 2;
}

function sectionRule(doc: jsPDF, y: number): number {
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.line(PAGE.marginX, y, PAGE.width - PAGE.marginX, y);
  return y + 4;
}

function sectionHeading(doc: jsPDF, label: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(label, PAGE.marginX, y);
  return sectionRule(doc, y + 1.6);
}

function labeledValue(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  labelWidth: number
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  doc.text(value || "—", x + labelWidth, y);
}

function paragraph(
  doc: jsPDF,
  text: string,
  y: number,
  options?: { bold?: boolean; size?: number; color?: [number, number, number] }
): number {
  doc.setFont("helvetica", options?.bold ? "bold" : "normal");
  doc.setFontSize(options?.size ?? 10.5);
  doc.setTextColor(...(options?.color ?? INK));
  const lines = doc.splitTextToSize(pdfSafe(text), CONTENT_WIDTH);
  doc.text(lines, PAGE.marginX, y);
  return y + lines.length * ((options?.size ?? 10.5) * 0.42) + 3;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE.height - PAGE.bottom) return y;
  doc.addPage();
  return PAGE.top + 6;
}

/**
 * Best-effort "open in a new window/tab" for the document's link annotations.
 * The PDF NewWindow flag is honored by compliant desktop viewers; in-browser
 * viewers decide tab behavior themselves (Ctrl+click always forces a new
 * tab). pdf-lib loads on demand so the page bundle stays light, and any
 * failure returns the original document — the flag is never worth blocking
 * delivery over.
 */
async function markLinksOpenInNewWindow(blob: Blob): Promise<Blob> {
  try {
    const { PDFDocument, PDFName, PDFDict, PDFBool } = await import("pdf-lib");
    const pdf = await PDFDocument.load(await blob.arrayBuffer());
    for (const page of pdf.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i += 1) {
        const annot = annots.lookupMaybe(i, PDFDict);
        const action = annot?.lookupMaybe(PDFName.of("A"), PDFDict);
        if (action?.has(PDFName.of("URI"))) {
          action.set(PDFName.of("NewWindow"), PDFBool.True);
        }
      }
    }
    const bytes = await pdf.save();
    return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  } catch {
    return blob;
  }
}

// ── Market Value Report (ACV) ────────────────────────────────────────────────

export async function buildMarketValueReportBlob(data: DvReportData): Promise<Blob> {
  const { extraction, intake, result } = data;
  const calc = result.calculation;
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const logo = await loadLogoDataUrl(BRAND.logoPath);

  let y = PAGE.top;
  const logoBottom = drawLogo(doc, logo, PAGE.marginX, y);
  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text("Market Value Report (ACV)", PAGE.width / 2 + 18, y + 8, { align: "center" });
  // The first rule must clear whichever is taller: the logo or the title band.
  y = Math.max(logoBottom + 4, y + 20);

  // General information
  y = sectionHeading(doc, "General Information:", y);
  const col2 = PAGE.marginX + CONTENT_WIDTH / 2;
  labeledValue(doc, "Claim #:", intake.claimNumber ?? extraction.claimNumber ?? "—", PAGE.marginX, y, 26);
  labeledValue(doc, "Vehicle Owner:", intake.ownerName ?? extraction.ownerName ?? "—", col2, y, 30);
  y += 6;
  labeledValue(doc, "Assignment:", "Diminished Value", PAGE.marginX, y, 26);
  labeledValue(doc, "Insurance:", intake.insurer ?? extraction.insurer ?? "—", col2, y, 30);
  y += 6;
  labeledValue(doc, "Vehicle:", extraction.vehicle.label ?? "—", PAGE.marginX, y, 26);
  labeledValue(
    doc,
    "Mileage:",
    `${num(calc.subjectMileage)} (from estimate)`,
    col2,
    y,
    30
  );
  y += 6;
  labeledValue(doc, "VIN #:", extraction.vehicle.vin ?? "—", PAGE.marginX, y, 26);
  labeledValue(doc, "Date of Loss:", intake.lossDate || "—", col2, y, 30);
  y += 6;
  labeledValue(doc, "RO #:", extraction.roNumber ?? "—", PAGE.marginX, y, 26);
  labeledValue(doc, "Report Date:", result.generatedAt.slice(0, 10), col2, y, 30);
  y += 9;

  // Dealer comps
  y = sectionHeading(doc, "Dealer Comps:", y);
  const compColWidth = CONTENT_WIDTH / 3;
  const comps = calc.adjustments;
  const boxHeight = 62;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  for (let i = 0; i < 3; i += 1) {
    const x = PAGE.marginX + i * compColWidth;
    doc.rect(x, y, compColWidth, boxHeight);
    const entry = comps[i];
    let cy = y + 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(`Comp #${i + 1}`, x + 2.5, cy);
    cy += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    if (!entry) {
      doc.setTextColor(...MUTED);
      doc.text("Not available", x + 2.5, cy);
      continue;
    }
    const comp = entry.comp;
    const headerLines = doc.splitTextToSize(
      comp.dealer ?? comp.source,
      compColWidth - 5
    );
    doc.text(headerLines.slice(0, 2), x + 2.5, cy);
    cy += headerLines.slice(0, 2).length * 3.4;
    if (comp.phone) {
      doc.text(comp.phone, x + 2.5, cy);
      cy += 3.6;
    }
    const titleLines = doc.splitTextToSize(comp.title, compColWidth - 5);
    doc.setTextColor(...MUTED);
    doc.text(titleLines.slice(0, 2), x + 2.5, cy);
    cy += titleLines.slice(0, 2).length * 3.4 + 1.2;
    doc.setTextColor(...INK);
    doc.text(`Asking: ${usd(comp.askingPrice)}`, x + 2.5, cy);
    cy += 3.8;
    doc.text(`Mileage: ${num(comp.mileage)}`, x + 2.5, cy);
    cy += 3.8;
    doc.text(
      `Mi diff: ${entry.mileageDifference !== undefined ? num(entry.mileageDifference) : "—"} = ${signed(entry.adjustment)}`,
      x + 2.5,
      cy
    );
    cy += 3.8;
    doc.setFont("helvetica", "bold");
    doc.text(`Adjusted: ${usd(entry.adjustedValue)}`, x + 2.5, cy);
    cy += 3.8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    if (comp.vin) {
      doc.setTextColor(...INK);
      doc.text(`VIN: ${comp.vin}`, x + 2.5, cy);
      cy += 3.4;
    }
    doc.setTextColor(...MUTED);
    doc.text(
      `${comp.source} · ${comp.dateAccessed}${comp.trimMatch !== "exact" ? " · adjacent trim" : ""}`,
      x + 2.5,
      cy
    );
    cy += 3.6;
    if (comp.url) {
      doc.setTextColor(60, 90, 170);
      doc.textWithLink("View listing online", x + 2.5, cy, { url: listingHref(comp.url) });
    }
  }
  y += boxHeight + 6;

  // Totals column
  const totalsX = PAGE.width - PAGE.marginX - 62;
  const totalRow = (label: string, value: string, bold = false, red = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...(red ? ACCENT : INK));
    doc.text(label, totalsX, y);
    doc.text(value, PAGE.width - PAGE.marginX, y, { align: "right" });
    y += 5.2;
  };
  totalRow("Mileage adjustment rate", `$${calc.perMileRate.toFixed(2)}/mile`);
  totalRow("Average of adjusted comps", usd(calc.averageAdjusted));
  totalRow(`Sales tax (${calc.taxRatePct}%)`, usd(calc.taxAmount));
  totalRow("Recommended ACV", usd(calc.preLossAcv), true, true);
  y += 3;

  // Remarks
  y = sectionHeading(doc, "Inspection Remarks:", y);
  const remarks: string[] = [
    `Mileage utilized from the repair estimate (date of loss basis). Average comp ad value is ${usd(calc.averageAdjusted)} + ${calc.taxRatePct}% sales tax = ${usd(calc.preLossAcv)}.`,
  ];
  for (const note of result.compResearch.notes) remarks.push(note);
  y = paragraph(doc, remarks.join(" "), y, { size: 9 });

  // ── Page 2: Diminished Value calculation ──
  doc.addPage();
  y = PAGE.top;
  const page2LogoBottom = drawLogo(doc, logo, PAGE.marginX, y);
  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text("Diminished Value Calculation", PAGE.width / 2 + 18, y + 8, { align: "center" });
  y = Math.max(page2LogoBottom + 4, y + 20);

  y = sectionHeading(doc, "Valuation Summary:", y);
  const dvRow = (label: string, value: string, bold = false, red = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...(red ? ACCENT : INK));
    doc.text(label, PAGE.marginX, y);
    doc.text(value, PAGE.width - PAGE.marginX, y, { align: "right" });
    y += 6;
  };
  dvRow("Pre-loss Actual Cash Value", usd(calc.preLossAcv));
  dvRow(
    `Post-loss value${calc.postLoss.projected ? " (PROJECTED)" : ""}`,
    usd(calc.postLoss.value)
  );
  dvRow("Diminished value", usd(calc.diminishedValue), true);
  dvRow("Appraisal fee (additional indirect loss)", usd(calc.appraisalFee));
  dvRow("Total demand", usd(calc.totalDemand), true, true);
  y += 2;

  y = paragraph(doc, `Post-loss method: ${calc.postLoss.rationale}`, y, { size: 9 });
  y = paragraph(
    doc,
    `Repair severity: ${usd(intake.repairTotal ?? extraction.repairTotal)} of repairs equals ` +
      `${calc.severityRatioPct.toFixed(1)}% of the pre-loss ACV.` +
      `${extraction.severity.structural ? " Structural operations documented." : " Non-structural repair."}` +
      `${extraction.severity.adasCalibration ? " ADAS calibration required." : ""}`,
    y,
    { size: 9 }
  );

  y = ensureSpace(doc, y + 2, 40);
  y = sectionHeading(doc, "Insurer 17c Framework Cross-Check:", y);
  y = paragraph(
    doc,
    `${usd(calc.preLossAcv)} × ${calc.crossCheck17c.baseCapPct}% cap × ${calc.crossCheck17c.damageMultiplier.toFixed(2)} ` +
      `(${calc.crossCheck17c.damageClass.replace(/_/g, " ")}) × ${calc.crossCheck17c.mileageMultiplier.toFixed(2)} mileage ` +
      `= ${usd(calc.crossCheck17c.value)}. The 17c formula is the insurer's own framework, shown here solely as a ` +
      `reasonableness cross-check of the market-based figure — it is not the basis of this appraisal.`,
    y,
    { size: 9 }
  );

  if (result.compResearch.tier === 3 && result.compResearch.sweep.length) {
    y = ensureSpace(doc, y + 2, 40);
    y = sectionHeading(doc, "Loss-History Market Sweep (Scarcity Evidence):", y);
    y = paragraph(
      doc,
      "A documented search for retail listings of this vehicle with a reported loss record returned fewer than " +
        "three confirmed units. The sweep below evidences that the retail market largely declines to stock " +
        "loss-history examples of this vehicle, which supports the market stigma applied above.",
      y,
      { size: 9 }
    );
    for (const record of result.compResearch.sweep) {
      y = ensureSpace(doc, y, 10);
      y = paragraph(
        doc,
        `• [${record.scope === "nationwide" ? "US-wide" : "100-mile radius"}] "${record.query}" — ${record.resultCount} result(s). ${record.note ?? ""}`,
        y,
        { size: 8.2, color: MUTED }
      );
    }
  }

  // Every comp cited must be independently reviewable: full clickable links.
  const linkedComps = [...result.compResearch.clean, ...result.compResearch.oneLoss].filter(
    (comp) => comp.url
  );
  if (linkedComps.length) {
    y = ensureSpace(doc, y + 2, 16 + linkedComps.length * 8);
    y = sectionHeading(doc, "Comparable Listing Links (for independent review):", y);
    for (const [index, comp] of linkedComps.entries()) {
      y = ensureSpace(doc, y, 10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.2);
      doc.setTextColor(...INK);
      doc.text(
        pdfSafe(
          `Comp ${index + 1} — ${comp.source} · ${usd(comp.askingPrice)}${comp.vin ? ` · VIN ${comp.vin}` : ""}${comp.tier === "one_loss" ? " · loss-history comp" : ""}`
        ),
        PAGE.marginX,
        y
      );
      y += 3.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.4);
      doc.setTextColor(60, 90, 170);
      const displayUrl = comp.url!.length > 118 ? `${comp.url!.slice(0, 115)}...` : comp.url!;
      doc.textWithLink(displayUrl, PAGE.marginX, y, { url: listingHref(comp.url!) });
      y += 4.6;
    }
  }

  y = ensureSpace(doc, y + 2, 42);
  y = sectionHeading(doc, "Open Items Before Submission:", y);
  for (const item of result.openItems) {
    y = ensureSpace(doc, y, 12);
    y = paragraph(doc, `• ${item}`, y, { size: 9 });
  }

  y = ensureSpace(doc, y + 4, 34);
  const preparedLineX = logo ? PAGE.marginX + 20 : PAGE.marginX;
  const closingBadgeBottom = logo ? drawLogo(doc, logo, PAGE.marginX, y, 16) : y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    pdfSafe(
      `Prepared through Collision iQ, a ${BRAND.companyName} service, on ${result.generatedAt.slice(0, 10)}.`
    ),
    preparedLineX,
    y + 6
  );
  y = Math.max(closingBadgeBottom, y + 10) + 2;
  drawDisclaimer(doc, y);

  return markLinksOpenInNewWindow(doc.output("blob"));
}

// ── Demand letter ────────────────────────────────────────────────────────────

export async function buildDemandLetterBlob(data: DvReportData): Promise<Blob> {
  const { extraction, intake, result } = data;
  const calc = result.calculation;
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const logo = await loadLogoDataUrl(BRAND.logoPath);

  const vehicleLabel = extraction.vehicle.label ?? "the insured vehicle";
  const insurer = intake.insurer ?? extraction.insurer ?? "Insurance Carrier";
  const claimant = intake.ownerName ?? extraction.ownerName ?? "Vehicle Owner";
  const claimNumber = intake.claimNumber ?? extraction.claimNumber ?? "—";

  let y = PAGE.top + 4;
  if (logo) {
    try {
      const props = doc.getImageProperties(logo);
      const width = 22;
      const height = (props.height / props.width) * width;
      doc.addImage(logo, "PNG", PAGE.width - PAGE.marginX - width, y, width, height);
      y = Math.max(y + height + 4, y + 24);
    } catch {
      y += 24;
    }
  } else {
    y += 24;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text("Enclosure:  Diminished value appraisal", PAGE.marginX, y);
  y += 5.4;
  doc.text(insurer, PAGE.marginX, y);
  y += 5.4;
  doc.text(vehicleLabel, PAGE.marginX, y);
  y += 10;

  const blockX = PAGE.marginX + 24;
  doc.setFont("times", "normal");
  doc.text("Claim #:", blockX, y);
  doc.setFont("helvetica", "normal");
  doc.text(claimNumber, blockX + 30, y);
  y += 5.6;
  doc.text("Loss Date:", blockX, y);
  doc.text(intake.lossDate || "—", blockX + 30, y);
  y += 5.6;
  doc.text("Claimant:", blockX, y);
  doc.text(claimant, blockX + 30, y);
  y += 11;

  y = paragraph(doc, "To whom it may concern;", y);
  y += 1;

  // The letter is written and signed by the vehicle owner, so it speaks in
  // the owner's first person throughout.
  const atFaultParty =
    intake.claimPosture === "third_party" ? "your insured" : "the at-fault party";

  y = paragraph(
    doc,
    `On ${intake.lossDate || "the date of loss"} my ${vehicleLabel} was damaged in an automobile collision. ` +
      `The evidence clearly shows there was direct and proximate cause of damage to my vehicle.`,
    y
  );

  y = paragraph(
    doc,
    "Due to the accident, my vehicle now has a lower resale value because of the loss record carried on its VIN. " +
      `Enclosed please find a diminished value appraisal prepared through ${BRAND.companyName}'s Collision iQ ` +
      "valuation service, indicating the vehicle has decreased in value.",
    y
  );

  const projectedNote = calc.postLoss.projected
    ? " The post-loss figure is a documented market projection pending the CarFax History-Based Value for this VIN; a revised appraisal will follow once the loss record posts."
    : "";
  y = paragraph(
    doc,
    `I hereby request reimbursement for my vehicle's diminished value in the amount of ${usd(calc.totalDemand)} ` +
      `(ACV amount ${usd(calc.preLossAcv)} − post-loss value ${usd(calc.postLoss.value)} = ${usd(calc.diminishedValue)} ` +
      `+ ${usd(calc.appraisalFee)} appraisal fee = ${usd(calc.totalDemand)}; the appraisal fee is included as it is an ` +
      `additional indirect loss I had to endure due to the actions of ${atFaultParty}).` +
      projectedNote,
    y,
    { bold: true }
  );

  y = paragraph(
    doc,
    "As the vehicle owner, I am reasonable and want nothing more than to be made whole for my loss.",
    y
  );

  y = paragraph(
    doc,
    "Please send payment within 15 days of receipt of this notice. The claim should be easy to resolve, and I look " +
      "forward to a prompt resolution. If there is any delay in the processing of the settlement, please contact " +
      "me directly.",
    y
  );

  // The letter is issued in the claimant's own name — no individual appraiser
  // identity or contact details appear on generated documents.
  y += 4;
  y = paragraph(doc, "Sincerely,", y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(claimant, PAGE.marginX, y);
  y += 5.4;
  doc.setTextColor(...MUTED);
  doc.text("Vehicle Owner / Claimant", PAGE.marginX, y);

  drawDisclaimer(doc, PAGE.height - PAGE.bottom - 18);

  return doc.output("blob");
}

// ── Delivery ─────────────────────────────────────────────────────────────────

async function deliverBlob(blob: Blob, filename: string) {
  if (isNative()) {
    await saveAndShareBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function filenameStem(data: DvReportData): string {
  const label = data.extraction.vehicle.label ?? "vehicle";
  return label.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "vehicle";
}

export async function exportMarketValueReportPdf(data: DvReportData) {
  const blob = await buildMarketValueReportBlob(data);
  await deliverBlob(blob, `${filenameStem(data)}_Market_Value_Report_ACV.pdf`);
}

export async function exportDemandLetterPdf(data: DvReportData) {
  const blob = await buildDemandLetterBlob(data);
  await deliverBlob(blob, `${filenameStem(data)}_DV_Demand_Letter.pdf`);
}

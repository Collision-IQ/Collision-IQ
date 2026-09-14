/**
 * FORENSIC ESTIMATE REVIEW — single-estimate page renderer.
 *
 * Lays the engine's ForensicReport out on the same frame the two-estimate
 * Forensic Estimate Analysis uses (shared `Writer`), so the two documents read
 * as one family. Page order mirrors the hand-built review this engine was
 * proven against: identity → verdict → findings at a glance → reconciliation
 * → operations written correctly → detailed findings → exposure → revision
 * checklist → references. Every figure comes from the engine; this file
 * decides layout and wording, never arithmetic.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { maskVinForExport, redactDownloadContent } from "@/lib/privacy/redactDownloadContent";
import { Writer } from "../forensicReportRenderer";
import type { Finding, ForensicReport } from "./types";

const ACCENT = rgb(0.62, 0.24, 0.08);
const MUTED = rgb(0.42, 0.44, 0.48);

export type ForensicSingleAudience = "INTERNAL" | "CARRIER" | "OWNER";

export interface RenderForensicSingleOptions {
  audience?: ForensicSingleAudience;
  /** Default true: names, phones, addresses and insurer identity are scrubbed; VIN tail masked. */
  redactSensitive?: boolean;
  /** Filename of the reviewed estimate, shown in the identity block. */
  sourceFileName?: string | null;
}

const money = (value: number): string =>
  `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const hrs = (value: number): string => value.toFixed(1);

export async function renderForensicSingleReportPdf(
  report: ForensicReport,
  options: RenderForensicSingleOptions = {}
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const audience = options.audience ?? "INTERNAL";
  const scrub =
    options.redactSensitive === false
      ? (value: string): string => value
      : (value: string): string => redactDownloadContent(value);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const h = report.header;
  const v = h.vehicle;
  const vehicleLabel = [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle not identified on the document";
  const writer = new Writer(doc, font, bold, `Forensic Estimate Review  |  ${scrub(vehicleLabel)}  |  Collision IQ`);

  writer.titleBlock(
    "Forensic Estimate Review",
    `Single-estimate reconciliation and completeness audit  |  ${scrub(vehicleLabel)}  |  Prepared ${report.generatedAt.slice(0, 10)}`
  );

  const identity: Array<{ label: string; value: string }> = [];
  identity.push({
    label: "Review type",
    value:
      audience === "INTERNAL"
        ? "Internal quality-assurance audit of one estimate, performed before release. Scope: closure to printed totals, not-included operations, OEM repair position, restraint handling, tax treatment, header completeness."
        : "Independent review of one estimate: closure to its own printed totals, not-included operations, OEM repair position, restraint handling, tax treatment, header completeness.",
  });
  identity.push({
    label: "Estimate",
    value: scrub(
      [
        h.documentTitle,
        h.system !== "UNKNOWN" ? h.system : null,
        h.workfileId ? `Workfile ${h.workfileId}` : null,
        h.printedAt ? `printed ${h.printedAt}` : null,
        options.sourceFileName ?? null,
      ]
        .filter(Boolean)
        .join("  |  ") || "Estimate on file"
    ),
  });
  if (h.claimNo) identity.push({ label: "Claim", value: scrub(h.claimNo) });
  if (h.writer?.name) {
    identity.push({ label: "Writer", value: scrub([h.writer.name, h.writer.license ? `license ${h.writer.license}` : null].filter(Boolean).join(", ")) });
  }
  if (h.owner?.name) identity.push({ label: "Owner / insured", value: scrub([h.owner.name, h.owner.state].filter(Boolean).join(", ")) });
  identity.push({
    label: "Vehicle",
    value: scrub(
      [
        [v.year, v.make, v.model, v.trim && v.trim !== v.model ? v.trim : null].filter(Boolean).join(" "),
        v.vin ? `VIN ${maskVinForExport(v.vin)}` : null,
        v.odometer ? `${v.odometer.toLocaleString()} miles` : null,
        v.exteriorColor ?? null,
      ]
        .filter(Boolean)
        .join("  |  ")
    ),
  });
  identity.push({
    label: "Loss",
    value:
      [
        h.dateOfLoss ? `Date of loss ${h.dateOfLoss}` : null,
        h.pointOfImpact?.label ? `Point of impact ${h.pointOfImpact.code ? `${h.pointOfImpact.code} ` : ""}${h.pointOfImpact.label}` : null,
        h.priorDamageNote ? `Prior damage: ${h.priorDamageNote}` : null,
      ]
        .filter(Boolean)
        .join("  |  ") || "Loss details not printed on the document",
  });
  const t = report.printedTotals;
  identity.push({
    label: "Printed totals",
    value: [
      `Parts ${money(t.parts)}`,
      ...t.labor.map((l) => `${labelLabor(l.category)} ${hrs(l.hours)} hrs @ $${l.rate.toFixed(2)} = ${money(l.cost)}`),
      t.paintSupplies ? `Materials ${hrs(t.paintSupplies.hours)} hrs @ $${t.paintSupplies.rate.toFixed(2)} = ${money(t.paintSupplies.cost)}` : null,
      t.misc ? `Misc ${money(t.misc)}` : null,
      t.other ? `Other ${money(t.other)}` : null,
      `Subtotal ${money(t.subtotal)}`,
      t.salesTax ? `Tax ${t.salesTax.ratePct}% ${money(t.salesTax.amount)}` : "No sales tax printed",
      `Total ${money(t.grandTotal)}`,
      t.deductible != null ? `Deductible ${money(t.deductible)}` : null,
      t.netCost != null ? `Net ${money(t.netCost)}` : null,
    ]
      .filter(Boolean)
      .join("  |  "),
  });
  writer.identityRows(identity);

  /* Verdict */
  writer.heading("Verdict");
  writer.paragraph(report.verdict.headline);
  writer.paragraph(`Recommendation: ${report.verdict.recommendation}`, { color: ACCENT });

  /* Findings at a glance */
  writer.heading("Findings at a glance");
  if (report.findings.length === 0) {
    writer.paragraph("No findings. The estimate closes to its printed totals and every rule in the catalog was satisfied by the document as written.");
  } else {
    writer.table({
      columns: [
        { header: "ID", width: 0.08 },
        { header: "Severity", width: 0.12 },
        { header: "Finding", width: 0.62 },
        { header: "Est. ref.", width: 0.18 },
      ],
      rows: report.findings.map((f) => [f.id, severityLabel(f.severity), scrub(f.title), refLabel(f)]),
    });
  }

  /* Reconciliation */
  writer.heading("1. Reconciliation of printed totals");
  writer.paragraph(
    report.reconciliation.unexplained === 0
      ? "Every printed figure was rebuilt from the line items. The estimate reconciles to $0.00 unexplained."
      : `Every printed figure was rebuilt from the line items. ${money(report.reconciliation.unexplained)} could not be explained; see the rows with a non-zero variance and finding ${report.findings.find((f) => f.ruleId === "RC-001")?.id ?? "RC-001"}.`
  );
  writer.table({
    columns: [
      { header: "Category", width: 0.24 },
      { header: "Rebuilt from", width: 0.4 },
      { header: "Rebuilt", width: 0.12, align: "right" },
      { header: "Printed", width: 0.12, align: "right" },
      { header: "Variance", width: 0.12, align: "right" },
    ],
    rows: report.reconciliation.rows.map((row) => [
      row.category,
      row.rebuiltFrom,
      formatCategoryValue(row.category, row.rebuilt),
      formatCategoryValue(row.category, row.printed),
      formatCategoryValue(row.category, row.variance),
    ]),
  });
  for (const note of report.reconciliation.notes) writer.paragraph(note, { color: MUTED, size: 8.6 });
  if (report.reconciliation.clearCoatCheck?.length) {
    writer.paragraph(`Clear coat check: ${report.reconciliation.clearCoatCheck.join("  ")}`, { color: MUTED, size: 8.6 });
  }

  /* Operations written correctly */
  writer.heading("2. Operations written correctly");
  writer.paragraph(
    report.correctlyWritten.length
      ? `For balance, the following are present and properly formed and should be preserved in any revision: ${report.correctlyWritten.join("; ")}.`
      : "No positive-QA items were detected from the document's own lines."
  );

  /* Detailed findings */
  writer.heading("3. Detailed findings");
  for (const f of report.findings) {
    writer.subheading(`${f.id}  ${severityLabel(f.severity)}  ${scrub(f.title)}`);
    if (f.narrative) {
      writer.paragraph(`Observation. ${scrub(f.narrative.observation)}`);
      writer.paragraph(`Basis. ${scrub(f.narrative.basis)}`);
      writer.paragraph(`Action. ${scrub(f.narrative.action)}`);
      writer.paragraph(`Exposure. ${scrub(f.narrative.exposure)}`);
    } else {
      writer.paragraph(`Observation. ${f.facts.map(scrub).join(" ")}`);
      if (f.authorities.length) {
        writer.paragraph(
          `Basis. ${f.authorities
            .map((a) => `${a.label}${a.citation ? ` (${a.citation})` : ""}${a.verified === false ? " [verify]" : ""}`)
            .join("; ")}.`
        );
      }
      writer.paragraph(`Action. ${scrub(f.action)}`);
      writer.paragraph(`Exposure. ${describeExposure(f)}`);
    }
  }

  /* Exposure */
  writer.heading("4. Quantified exposure");
  writer.paragraph(
    report.exposure.quantifiedLow === report.exposure.quantifiedHigh
      ? `Quantifiable at the estimate's own rates: ${money(report.exposure.quantifiedLow)}.`
      : `Quantifiable at the estimate's own rates: ${money(report.exposure.quantifiedLow)} to ${money(report.exposure.quantifiedHigh)}, depending on which defensible basis applies.`
  );
  if (report.exposure.openItems.length) {
    writer.paragraph("Open items that need a dealer quote, vendor invoice or database lookup before they carry a number:");
    for (const item of report.exposure.openItems) writer.bullet(scrub(item));
  }

  /* Checklist */
  writer.heading("5. Revision checklist");
  for (const item of report.checklist) writer.bullet(`${item.n}. ${scrub(item.action)} (${item.ref})`);

  /* References */
  if (report.references.length) {
    writer.heading("References");
    for (const ref of report.references) writer.bullet(ref);
    writer.paragraph(
      "Authorities are the standards each rule expects to apply. Any authority marked [verify] was not matched to a retrieved document and must be confirmed before external use.",
      { color: MUTED, size: 8.6 }
    );
  }

  writer.paragraph(
    audience === "INTERNAL"
      ? "Collision IQ internal QA work product. Prepared for the writing appraiser; not for distribution to carrier, owner or repairer."
      : "Prepared by Collision IQ from the estimate's own printed lines and totals. Observed facts, inferences and open verification items are labelled as such.",
    { color: MUTED, size: 8 }
  );

  writer.finish();
  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount() };
}

function labelLabor(category: string): string {
  switch (category) {
    case "BODY": return "Body";
    case "REFINISH": return "Refinish";
    case "MECH": return "Mechanical";
    case "STRUCT": return "Structural";
    case "FRAME": return "Frame";
    case "ELEC": return "Electrical";
    case "GLASS": return "Glass";
    case "DIAG": return "Diagnostic";
    default: return category.charAt(0) + category.slice(1).toLowerCase();
  }
}

function severityLabel(severity: Finding["severity"]): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

function refLabel(f: Finding): string {
  if (f.lineRefs.length === 0) return f.cls === "HEADER" ? "Header" : f.cls === "TAX" || f.cls === "RECONCILIATION" ? "Totals" : "Absent";
  return `Line ${f.lineRefs.join(", ")}`;
}

function formatCategoryValue(category: string, value: number): string {
  return /\(hrs\)/.test(category) ? hrs(value) : money(value);
}

function describeExposure(f: Finding): string {
  const parts: string[] = [];
  if (f.exposure.quantified !== 0 || f.exposure.quantifiedAlt != null) {
    const alt = f.exposure.quantifiedAlt;
    parts.push(
      alt != null && alt !== f.exposure.quantified
        ? `${money(Math.min(f.exposure.quantified, alt))} to ${money(Math.max(f.exposure.quantified, alt))} at the estimate's own rates`
        : `${money(f.exposure.quantified)} at the estimate's own rates`
    );
  }
  if (f.exposure.open) parts.push(f.exposure.open);
  if (!parts.length) parts.push("Not quantifiable from the document alone.");
  return `${parts.join(". ")}${parts[parts.length - 1].endsWith(".") ? "" : "."}`;
}

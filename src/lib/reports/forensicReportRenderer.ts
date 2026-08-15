/**
 * FORENSIC ESTIMATE ANALYSIS — page renderer.
 *
 * The second of the two documents the Citation Density Report produces. It
 * replaces the old Delta findings report, the OEM findings report and the OEM
 * annotated estimate: one narrative reconciliation of the two appraisals
 * instead of three overlapping card dumps.
 *
 * Written to be read by a claims professional AND by the vehicle owner, which
 * is why the plain-language summary comes before the technical findings rather
 * than after them. Every dollar shown here comes from the reconciliation model,
 * which is built from the two documents' own printed totals — this file decides
 * layout and wording, never arithmetic.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";
import {
  describeReconciliation,
  type ForensicReconciliation,
} from "./forensicEstimateAnalysis";
import { classifyAuthorities } from "./authorityTier";

const MARGIN = 54;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const BODY_SIZE = 9.5;
const LINE_GAP = 3.2;

const INK = rgb(0.11, 0.12, 0.14);
const MUTED = rgb(0.42, 0.44, 0.48);
const RULE = rgb(0.82, 0.84, 0.87);
const ACCENT = rgb(0.62, 0.24, 0.08);

const money = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const hours = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${Math.round(value * 10) / 10} hrs`;

type Cursor = { page: PDFPage; y: number; pageNumber: number };

class Writer {
  private readonly doc: PDFDocument;
  readonly font: PDFFont;
  readonly bold: PDFFont;
  private cursor: Cursor;
  private readonly footer: string;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, footer: string) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.footer = footer;
    this.cursor = this.newPage();
  }

  private newPage(): Cursor {
    const page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const pageNumber = this.doc.getPageCount();
    return { page, y: PAGE_HEIGHT - MARGIN, pageNumber };
  }

  /** Reserve vertical space, breaking the page when the block will not fit. */
  private reserve(height: number) {
    if (this.cursor.y - height < MARGIN + 26) {
      this.stampFooter();
      this.cursor = this.newPage();
    }
  }

  private stampFooter() {
    this.cursor.page.drawText(`${this.footer}    Page ${this.cursor.pageNumber}`, {
      x: MARGIN,
      y: MARGIN - 14,
      size: 7.2,
      font: this.font,
      color: MUTED,
    });
  }

  finish() {
    this.stampFooter();
  }

  get width() {
    return PAGE_WIDTH - MARGIN * 2;
  }

  /** Greedy wrap on word boundaries; never splits a word mid-token. */
  wrap(text: string, size: number, font: PDFFont, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [""];
  }

  heading(text: string) {
    this.reserve(30);
    this.cursor.y -= 12;
    this.cursor.page.drawText(text, {
      x: MARGIN,
      y: this.cursor.y,
      size: 11.5,
      font: this.bold,
      color: ACCENT,
    });
    this.cursor.y -= 6;
    this.cursor.page.drawLine({
      start: { x: MARGIN, y: this.cursor.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.cursor.y },
      thickness: 0.7,
      color: RULE,
    });
    this.cursor.y -= 10;
  }

  subheading(text: string) {
    this.reserve(20);
    this.cursor.y -= 5;
    for (const line of this.wrap(text, 9.8, this.bold, this.width)) {
      this.cursor.page.drawText(line, { x: MARGIN, y: this.cursor.y, size: 9.8, font: this.bold, color: INK });
      this.cursor.y -= 9.8 + LINE_GAP;
    }
    this.cursor.y -= 1;
  }

  paragraph(text: string, options?: { indent?: number; color?: ReturnType<typeof rgb>; size?: number }) {
    const size = options?.size ?? BODY_SIZE;
    const indent = options?.indent ?? 0;
    const lines = this.wrap(text, size, this.font, this.width - indent);
    for (const line of lines) {
      this.reserve(size + LINE_GAP);
      this.cursor.page.drawText(line, {
        x: MARGIN + indent,
        y: this.cursor.y,
        size,
        font: this.font,
        color: options?.color ?? INK,
      });
      this.cursor.y -= size + LINE_GAP;
    }
    this.cursor.y -= 3;
  }

  bullet(text: string) {
    const indent = 12;
    const lines = this.wrap(text, BODY_SIZE, this.font, this.width - indent);
    lines.forEach((line, index) => {
      this.reserve(BODY_SIZE + LINE_GAP);
      if (index === 0) {
        this.cursor.page.drawText("•", { x: MARGIN + 2, y: this.cursor.y, size: BODY_SIZE, font: this.font, color: MUTED });
      }
      this.cursor.page.drawText(line, { x: MARGIN + indent, y: this.cursor.y, size: BODY_SIZE, font: this.font, color: INK });
      this.cursor.y -= BODY_SIZE + LINE_GAP;
    });
    this.cursor.y -= 2;
  }

  /**
   * Column table. Widths are fractions of the content width so a long category
   * label wraps inside its own cell instead of running into the next column —
   * the failure mode that made earlier table renders unreadable.
   */
  table(params: {
    columns: Array<{ header: string; width: number; align?: "left" | "right" }>;
    rows: string[][];
    emphasizeLastRow?: boolean;
  }) {
    const size = 8.6;
    const widths = params.columns.map((column) => column.width * this.width);
    const xs = widths.reduce<number[]>((acc, width, index) => {
      acc.push(index === 0 ? MARGIN : acc[index - 1] + widths[index - 1]);
      return acc;
    }, []);

    const drawRow = (cells: string[], font: PDFFont, color = INK) => {
      const wrapped = cells.map((cell, index) =>
        this.wrap(cell, size, font, widths[index] - 6)
      );
      const rowHeight = Math.max(...wrapped.map((lines) => lines.length)) * (size + 2) + 3;
      this.reserve(rowHeight);
      const top = this.cursor.y;
      wrapped.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => {
          const align = params.columns[index].align ?? "left";
          const textWidth = font.widthOfTextAtSize(line, size);
          const x =
            align === "right" ? xs[index] + widths[index] - 6 - textWidth : xs[index];
          this.cursor.page.drawText(line, {
            x,
            y: top - lineIndex * (size + 2),
            size,
            font,
            color,
          });
        });
      });
      this.cursor.y = top - rowHeight;
    };

    drawRow(params.columns.map((column) => column.header), this.bold, MUTED);
    this.cursor.page.drawLine({
      start: { x: MARGIN, y: this.cursor.y + 4 },
      end: { x: PAGE_WIDTH - MARGIN, y: this.cursor.y + 4 },
      thickness: 0.6,
      color: RULE,
    });
    this.cursor.y -= 3;
    params.rows.forEach((row, index) => {
      const isLast = index === params.rows.length - 1;
      drawRow(row, params.emphasizeLastRow && isLast ? this.bold : this.font);
    });
    this.cursor.y -= 4;
  }

  /**
   * Claim identity under the title: label column, value column. Values arrive
   * already redacted — the caller owns the policy because it owns the raw
   * identifiers; this method must never see an unredacted VIN or claim number.
   */
  identityRows(rows: Array<{ label: string; value: string }>) {
    const size = 9;
    const labelWidth = 112;
    for (const row of rows) {
      const lines = this.wrap(row.value, size, this.font, this.width - labelWidth);
      lines.forEach((line, index) => {
        this.reserve(size + LINE_GAP);
        if (index === 0) {
          this.cursor.page.drawText(row.label, {
            x: MARGIN,
            y: this.cursor.y,
            size,
            font: this.bold,
            color: MUTED,
          });
        }
        this.cursor.page.drawText(line, {
          x: MARGIN + labelWidth,
          y: this.cursor.y,
          size,
          font: this.font,
          color: INK,
        });
        this.cursor.y -= size + LINE_GAP;
      });
    }
    this.cursor.y -= 6;
  }

  titleBlock(title: string, subtitle: string) {
    this.cursor.page.drawText(title, {
      x: MARGIN,
      y: this.cursor.y,
      size: 17,
      font: this.bold,
      color: INK,
    });
    this.cursor.y -= 18;
    for (const line of this.wrap(subtitle, 9.5, this.font, this.width)) {
      this.cursor.page.drawText(line, { x: MARGIN, y: this.cursor.y, size: 9.5, font: this.font, color: MUTED });
      this.cursor.y -= 12;
    }
    this.cursor.y -= 4;
    this.cursor.page.drawLine({
      start: { x: MARGIN, y: this.cursor.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.cursor.y },
      thickness: 1.4,
      color: ACCENT,
    });
    this.cursor.y -= 14;
  }
}

/** Domain grouping for the findings sections, by the finding's own category. */
const DOMAINS: Array<{ title: string; match: (finding: CitationDensityFinding) => boolean }> = [
  {
    title: "Findings — structural repair",
    match: (finding) =>
      // A refinish operation ON a structural part is a refinish finding. The
      // label reads "Missing from comparison estimate: Roof rail" — the CCC
      // operation token ("Blnd") appears only in the evidence prose, so testing
      // the label alone still filed a blend-hours difference under structural
      // repair, where a reader looking for weld and sectioning issues will not
      // expect it. Test the row text the finding actually cites.
      finding.category !== "refinish" &&
      !/\b(?:blnd|blend|refinish|clear ?coat|tint)\b/i.test(
        `${finding.operationLabel} ${finding.currentSupportSummary ?? ""}`
      ) &&
      (finding.category === "structural_or_fit_verification" ||
        /\brail|floor pan|frame|structural|sectioning|apron|crossmember\b/i.test(finding.operationLabel)),
  },
  {
    title: "Findings — advanced driver assistance systems",
    match: (finding) =>
      finding.category === "adas_calibration" ||
      finding.category === "scan_diagnostic" ||
      /\bcalibrat|adas|blind spot|radar|camera|park sensor|scan\b/i.test(finding.operationLabel),
  },
  {
    title: "Findings — parts type and one-time-use components",
    match: (finding) =>
      finding.category === "parts_downgrade" ||
      finding.category === "one_time_use_parts" ||
      finding.category === "hardware_fasteners" ||
      /\baftermarket|a\/m|lkq|recycled|one[- ]time|1x ?use\b/i.test(finding.operationLabel),
  },
  {
    title: "Findings — refinish and materials",
    match: (finding) =>
      finding.category === "refinish" ||
      /\brefinish|blend|clear ?coat|tint|paint|seam sealer|corrosion|cavity wax\b/i.test(finding.operationLabel),
  },
];

export type ForensicReportInput = {
  reconciliation: ForensicReconciliation;
  findings: CitationDensityFinding[];
  /** Higher-cost (annotated) document name, as uploaded. */
  higherDocumentName: string;
  /** Comparison document name, as uploaded. */
  lowerDocumentName: string;
  higherLineCount: number | null;
  lowerLineCount: number | null;
  /** Lines the higher estimate carries that have no counterpart at all. */
  noCounterpartRows: Array<{ line: number | null; description: string; amount: number | null }>;
  vehicleLabel: string | null;
  /**
   * Claim identity rows for the header block (owner, VIN, RO, insurer…).
   * The caller redacts these before passing them in — same policy as every
   * export: claim numbers scrubbed, VIN last eight masked.
   */
  identity?: Array<{ label: string; value: string }>;
  /** Document-level caveats already resolved upstream (OCR, coverage, PII). */
  limitations: string[];
  /** Authorities that actually reached a finding, for Section 11. */
  authorities: Array<{ title: string; relevance: string; where: string }>;
  /** Everything retrieved for this claim (RIR research pass + OEM lane), before
   *  tiering. Classified here so the report states its own evidence quality. */
  retrievedSources: Array<{ title: string; url?: string; locator?: string; uploadedEvidence?: boolean }>;
  generatedAt: string;
  /** Apply the export redaction policy to prose and document names (Test 99
   *  item 6 — the annotated PDF redacts the insurer while this report's prose
   *  named USAA and printed carrier-bearing filenames verbatim). Defaults on. */
  redactSensitive?: boolean;
};

/**
 * Render the forensic report into a standalone PDF.
 *
 * Sections deliberately mirror the reference document's order: purpose, then
 * what was examined, then the plain-language summary, then the money, then the
 * technical findings, then what the owner should do. A reader who stops after
 * two pages still has the answer.
 */
export async function buildForensicReportPdf(input: ForensicReportInput): Promise<{
  bytes: Uint8Array;
  pageCount: number;
}> {
  // Item 6: one redaction policy for BOTH deliverables of a run. The raster
  // pass blacks the insurer out of the annotated PDF; this report must not
  // reintroduce it through prose or carrier-bearing filenames. Names and
  // finding prose pass through the same export policy the identity rows use.
  const scrub =
    input.redactSensitive !== false
      ? (value: string): string => redactDownloadContent(value)
      : (value: string): string => value;

  // R05 (Test 99 item 3): a finding card with NO line anchor, NO dollar
  // figure, and NO hour figure is unresolved template output, not evidence —
  // "Hidden Mounting Geometry Teardown Growth" shipped exactly that shape on
  // two unrelated claims. Such cards are dropped before render; a finding
  // that cannot say where, how much, or how long has nothing to assert.
  input = {
    ...input,
    higherDocumentName: scrub(input.higherDocumentName),
    lowerDocumentName: scrub(input.lowerDocumentName),
    limitations: input.limitations.map(scrub),
    findings: input.findings
      .filter((finding) => {
        const hasAnchor = Boolean(
          finding.shopEvidence?.lineNumber ||
            finding.carrierEvidence?.lineNumber ||
            finding.shopAnchor ||
            finding.carrierAnchor ||
            finding.sourcePageLine
        );
        const hasDollar =
          typeof finding.impact?.dollarImpact === "number" ||
          typeof finding.shopEvidence?.amount === "number" ||
          typeof finding.carrierEvidence?.amount === "number";
        const hasHours =
          typeof finding.impact?.laborHoursImpact === "number" ||
          typeof finding.shopEvidence?.laborHours === "number" ||
          typeof finding.carrierEvidence?.laborHours === "number";
        return hasAnchor || hasDollar || hasHours;
      })
      .map((finding) => ({
        ...finding,
        operationLabel: scrub(finding.operationLabel),
        currentSupportSummary: finding.currentSupportSummary
          ? scrub(finding.currentSupportSummary)
          : finding.currentSupportSummary,
        counterpartSummary: finding.counterpartSummary
          ? scrub(finding.counterpartSummary)
          : finding.counterpartSummary,
      })),
  };
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const described = describeReconciliation(input.reconciliation);
  const vehicle = input.vehicleLabel?.trim() || "Vehicle not identified on the documents";
  const writer = new Writer(
    doc,
    font,
    bold,
    `Forensic Estimate Analysis  |  ${vehicle}`
  );

  writer.titleBlock(
    "Forensic Estimate Analysis & Repair Cost Gap Report",
    `Independent line-level reconciliation of two appraisals of the same loss  |  ${vehicle}  |  Prepared ${new Date(
      input.generatedAt
    ).toISOString().slice(0, 10)}`
  );

  if (input.identity?.length) {
    writer.identityRows(input.identity);
  }

  // 1
  writer.heading("1. Purpose and scope");
  writer.paragraph(
    "Two appraisals exist for this loss and they do not agree. This report compares them line by line, " +
      "identifies each point of difference, quantifies it in dollars, and states the technical basis for the " +
      "difference where one exists. Section 3 is the plain-language summary; the sections after it carry the " +
      "technical detail; the appendix lists every affected line."
  );
  writer.paragraph(
    "This is a documentation and appraisal analysis. It is not legal advice, and it does not allege intent or " +
      "bad faith on the part of any party. Several findings are ordinary appraisal disagreements that reasonable " +
      "professionals resolve routinely."
  );

  // 2
  writer.heading("2. Documents examined");
  writer.table({
    columns: [
      { header: "", width: 0.28 },
      { header: "Document A (higher)", width: 0.36 },
      { header: "Document B (comparison)", width: 0.36 },
    ],
    rows: [
      ["Title", input.higherDocumentName, input.lowerDocumentName],
      [
        "Line count",
        input.higherLineCount === null ? "—" : `${input.higherLineCount} operations`,
        input.lowerLineCount === null ? "—" : `${input.lowerLineCount} operations`,
      ],
      [
        "Total cost of repairs",
        money(input.reconciliation.higherGrandTotal),
        money(input.reconciliation.lowerGrandTotal),
      ],
    ],
  });
  writer.paragraph(
    "Method. Both documents were parsed to structured line data and matched on part number first, then on " +
      "normalised description plus operation plus side qualifier. Line numbers do not correspond between " +
      "estimating platforms, so no weight was placed on sequence. Every dollar figure in this report traces to a " +
      "printed line on one of the two documents; none is inferred.",
    { size: 8.4, color: MUTED }
  );

  // 3
  writer.heading("3. Summary in plain language");
  if (described.gapStatement) {
    writer.paragraph(described.gapStatement);
  } else {
    writer.paragraph(
      "The two documents' totals blocks could not both be read, so no overall gap figure is stated here. " +
        "The line-level differences below still stand on their own."
    );
  }
  if (described.rateDisputeStatement) {
    writer.paragraph(described.rateDisputeStatement);
  }
  const missingCount = input.noCounterpartRows.length;
  if (missingCount > 0) {
    writer.paragraph(
      `${missingCount} operation${missingCount === 1 ? "" : "s"} or part${missingCount === 1 ? "" : "s"} ` +
        `appear on ${input.higherDocumentName} with no counterpart on ${input.lowerDocumentName}. ` +
        "They are listed in full in Appendix A."
    );
  }

  // 4
  writer.heading("4. Reconciliation of the difference");
  writer.table({
    columns: [
      { header: "Component", width: 0.3 },
      { header: "Document A", width: 0.24, align: "right" },
      { header: "Document B", width: 0.24, align: "right" },
      { header: "Difference", width: 0.22, align: "right" },
    ],
    rows: [
      ...input.reconciliation.rows.map((row) => [
        row.category,
        row.higherHours !== null ? `${hours(row.higherHours)} / ${money(row.higherCost)}` : money(row.higherCost),
        row.lowerHours !== null ? `${hours(row.lowerHours)} / ${money(row.lowerCost)}` : money(row.lowerCost),
        money(row.costDifference),
      ]),
      [
        "Subtotal",
        money(input.reconciliation.higherSubtotal),
        money(input.reconciliation.lowerSubtotal),
        input.reconciliation.higherSubtotal !== null && input.reconciliation.lowerSubtotal !== null
          ? money(input.reconciliation.lowerSubtotal - input.reconciliation.higherSubtotal)
          : "—",
      ],
      [
        "Tax",
        money(input.reconciliation.higherTax),
        money(input.reconciliation.lowerTax),
        input.reconciliation.higherTax !== null && input.reconciliation.lowerTax !== null
          ? money(input.reconciliation.lowerTax - input.reconciliation.higherTax)
          : "—",
      ],
      [
        "Total cost of repairs",
        money(input.reconciliation.higherGrandTotal),
        money(input.reconciliation.lowerGrandTotal),
        money(input.reconciliation.grandTotalDifference),
      ],
    ],
    emphasizeLastRow: true,
  });
  if (described.offsettingMovementStatement) {
    writer.subheading("The totals are close; the estimates are not");
    writer.paragraph(described.offsettingMovementStatement);
  }
  if (described.rateDisputeStatement) {
    writer.subheading("Note on rates");
    writer.paragraph(described.rateDisputeStatement);
  } else if (described.rateDifferences.length > 0) {
    writer.subheading("Note on rates");
    writer.paragraph(
      "The two documents do not use the same rate in every category. A rate difference applies across every " +
        "hour in that category, so it compounds independently of any disagreement about hours:"
    );
    for (const difference of described.rateDifferences) writer.bullet(difference);
  }
  if (described.comparisonAllowsMore.length > 0) {
    writer.subheading("Where the comparison estimate allows more");
    writer.paragraph(
      "These are credited to the comparison estimate and are already netted into the totals above."
    );
    for (const line of described.comparisonAllowsMore) writer.bullet(line);
  }
  for (const lane of input.reconciliation.unmatchedTaxLanes) {
    writer.paragraph(
      `Tax lane "${lane.label}" (${money(lane.amount)}) appears on ${
        lane.onlyOn === "higher" ? "Document A" : "Document B"
      } only.`,
      { size: 8.4, color: MUTED }
    );
  }

  // 5+ findings by domain
  const used = new Set<string>();
  for (const domain of DOMAINS) {
    const group = input.findings.filter(
      (finding) => !used.has(finding.id) && domain.match(finding)
    );
    if (group.length === 0) continue;
    group.forEach((finding) => used.add(finding.id));
    writer.heading(domain.title);
    for (const finding of group) {
      writer.subheading(finding.operationLabel);
      if (finding.currentSupportSummary) writer.paragraph(finding.currentSupportSummary);
      if (finding.missingProofSummary) {
        writer.paragraph(`What would prove it: ${finding.missingProofSummary}`, { size: 8.8 });
      }
      if (finding.recommendedNextAction) {
        writer.paragraph(`Next step: ${finding.recommendedNextAction}`, { size: 8.8, color: MUTED });
      }
      const authority = finding.bestAvailableAuthority;
      if (authority?.title) {
        writer.paragraph(
          `Support: ${authority.title}${authority.status === "verified" ? "" : " (support needed — not retrieved)"}`,
          { size: 8.4, color: MUTED }
        );
      }
    }
  }

  const remaining = input.findings.filter((finding) => !used.has(finding.id));
  if (remaining.length > 0) {
    writer.heading("Findings — other differences");
    for (const finding of remaining) {
      writer.subheading(finding.operationLabel);
      if (finding.currentSupportSummary) writer.paragraph(finding.currentSupportSummary);
      if (finding.recommendedNextAction) {
        writer.paragraph(`Next step: ${finding.recommendedNextAction}`, { size: 8.8, color: MUTED });
      }
    }
  }

  // Owner guidance
  writer.heading("What the vehicle owner should know");
  writer.bullet("You choose the repair facility. Neither carrier nor shop can require you to use a particular one.");
  writer.bullet(
    "A supplement is a stage in a claim, not a verdict. Much of what is disputed here becomes visible once the " +
      "damaged panels come off."
  );
  writer.bullet(
    "If the two sides cannot agree on the amount, your policy contains an appraisal clause. It applies to disputes " +
      "about the amount of loss, not about whether something is covered. Read your policy for the exact procedure " +
      "and any time limits before invoking it."
  );
  writer.bullet(
    "Ask in writing that any electronic safety systems disturbed by the repair be calibrated afterwards, and that " +
      "you receive the post-repair scan report."
  );
  writer.bullet("Keep every document: both estimates, all supplements, scan reports and parts invoices.");

  writer.heading("Recommended path to resolution");
  writer.bullet(
    "Reinspection with both appraisers present, with the damaged assemblies removed. The largest items are best " +
      "settled at the vehicle rather than on paper."
  );
  writer.bullet(
    "Correct any internal inconsistencies on either document first — a part purchased with no labour to install " +
      "it, or an operation denied alongside another that requires it. These narrow the dispute before the harder " +
      "items are reached."
  );
  writer.bullet("Attach the OEM repair procedure for the disputed operations to support labour class and hours.");
  writer.bullet(
    "Address parts type separately from labour. Bundling a small parts-type question with a large labour question " +
      "tends to stall both."
  );

  // Authorities
  writer.heading("Authorities relied upon");
  if (input.authorities.length === 0) {
    writer.paragraph(
      "No retrieved authority is attached to a specific finding above. Every finding therefore rests on the two " +
        "estimates themselves. Where a finding needs external support to be relied upon in a formal proceeding, " +
        "that support must be obtained and attached before it is used.",
      { color: MUTED }
    );
  } else {
    writer.table({
      columns: [
        { header: "Source", width: 0.36 },
        { header: "Attached to", width: 0.34 },
        { header: "Where to obtain", width: 0.3 },
      ],
      rows: input.authorities.map((authority) => [authority.title, authority.relevance, authority.where]),
    });
  }

  // Everything retrieved for the claim, ranked. Separate from the table above
  // because "retrieved" and "relied upon" are different claims, and conflating
  // them is how a report ends up appearing to cite support it never used.
  const { accepted: tiered, rejected: refusedSources } = classifyAuthorities(input.retrievedSources);
  if (tiered.length > 0) {
    writer.subheading("Retrieved for this claim, by authority tier");
    writer.paragraph(
      "Tier 1 is the OEM or the case file itself; tier 2 licensed estimating data; tier 3 statute, regulation or " +
        "regulator; tier 4 an industry technical body; tier 5 other published technical sources. Lower-tier " +
        "material does not override a higher tier.",
      { size: 8.4, color: MUTED }
    );
    writer.table({
      columns: [
        { header: "Tier", width: 0.08, align: "right" },
        { header: "Source", width: 0.5 },
        { header: "Basis", width: 0.42 },
      ],
      rows: tiered.map((authority) => [String(authority.tier), authority.title, authority.tierBasis]),
    });
  }
  if (refusedSources.length > 0) {
    // Stated, not silently dropped: a reader comparing this against a raw
    // search result list should be able to see what was excluded and why.
    writer.subheading("Retrieved but not cited");
    writer.paragraph(
      `${refusedSources.length} retrieved result${refusedSources.length === 1 ? " was" : "s were"} excluded as ` +
        "not constituting repair authority:",
      { size: 8.8 }
    );
    for (const refused of refusedSources.slice(0, 12)) {
      writer.bullet(`${refused.title} — ${refused.reason}`);
    }
  }
  writer.paragraph(
    "The two estimates themselves are the source of every dollar figure, part number, hour and printed note in " +
      "this report. Statutory and regulatory text should be verified as current before being relied upon in any " +
      "formal proceeding.",
    { size: 8.4, color: MUTED }
  );

  // Limitations — including any reconciliation imbalance
  writer.heading("Limitations");
  const allLimitations = [...described.balanceWarnings, ...input.limitations];
  if (allLimitations.length === 0) {
    writer.paragraph(
      "Both documents reconciled against their own printed totals. Neither appraisal was prepared by the author " +
        "of this report and the vehicle was not physically inspected; hidden damage may alter both estimates."
    );
  } else {
    for (const limitation of allLimitations) writer.bullet(limitation);
    writer.paragraph(
      "Neither appraisal was prepared by the author of this report and the vehicle was not physically inspected; " +
        "hidden damage may alter both estimates. Certain differences are legitimate professional judgement — " +
        "repair-versus-replace calls, blend allowances and overlap deductions among them. This report quantifies " +
        "them without asserting that one appraiser is necessarily correct."
    );
  }

  // Appendix A
  if (input.noCounterpartRows.length > 0) {
    writer.heading(`Appendix A — operations and parts with no counterpart on ${input.lowerDocumentName}`);
    writer.paragraph(
      `${input.noCounterpartRows.length} line items. Amounts are as printed on ${input.higherDocumentName}.`,
      { size: 8.4, color: MUTED }
    );
    writer.table({
      columns: [
        { header: "Ln", width: 0.08, align: "right" },
        { header: "Operation / part", width: 0.72 },
        { header: "Amount", width: 0.2, align: "right" },
      ],
      rows: input.noCounterpartRows.map((row) => [
        row.line === null ? "—" : String(row.line),
        row.description,
        money(row.amount),
      ]),
    });
  }

  writer.finish();
  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount() };
}

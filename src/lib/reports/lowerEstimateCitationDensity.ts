/**
 * DELTA CITATION DENSITY — the LOWER estimate, marked up.
 *
 * The citation copy is the carrier's own estimate with our figures on it:
 * every value we wrote differently is highlighted and our value is stamped to
 * its left, each carrier line worth raising carries a numbered badge in the
 * left margin, and a findings index is appended. It is the document a
 * supplement answers, which is why the lower estimate is the one marked up.
 *
 * The analysis is NOT re-run here. The findings come from the Appraisal
 * Dispute Report's model (appraisalSummary/lowerEstimateFindings.ts), built
 * with our estimate as the higher side, so the two documents cannot disagree.
 *
 * Delta Annotation Rule. Every mark sits on a box MEASURED from this PDF's own
 * word layer: a highlight on the typed cell the row parser measured, a stamp
 * in whitespace verified empty against every word on the page, a badge in the
 * verified-empty margin left of the row. A column position is taken from the
 * same page's other rows when the row prints nothing in that column. A mark
 * that cannot be placed is never nudged onto text; it is listed in the index
 * instead. Pages are redacted and rasterized first, exactly as the higher-
 * estimate copy is, and the run refuses rather than ship unredacted pages.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { toWinAnsiPdfText } from "@/lib/pdf/winAnsiText";
import { redactAndRasterizePdf, type RasterRedactionScope } from "@/lib/privacy/rasterRedactPdf";
import { findCollidingWords, rectsIntersect, type PlacementRect, type PlacementWord } from "./annotationPlacementEngine";
import { parseEstimateRows, parseTotalsFromWords, type CellBox, type EstimateRow, type Word } from "./deltaEngine/rowCluster";
import type { PdfWord } from "./citationDensityRowAnchors";
import { labelCat } from "./appraisalSummary/estimateFromDeltaRows";
import { LABOR_FAMILY } from "./appraisalSummary/gapLedger";
import type { LowerEntry, LowerFinding, LowerFindingSet, StampField } from "./appraisalSummary/lowerEstimateFindings";
import type { PlainSummaryModel } from "./plainLanguageSummary";

const STAMP_SIZE = 6.5;
const BADGE_SIZE = 6.5;
const NOTE_SIZE = 7;
const RED = rgb(0.78, 0.08, 0.08);
const YELLOW = rgb(1, 0.93, 0.25);

export interface LowerEstimateCitationParams {
  /** The lower estimate's ORIGINAL bytes (redaction runs here). */
  lowerPdfBytes: Uint8Array;
  /** Its measured word layer, from the original bytes. */
  words: PdfWord[];
  set: LowerFindingSet;
  model: PlainSummaryModel;
  lowerName: string;
  higherName: string;
  redactionScope: RasterRedactionScope;
  /** Tests only: skip rasterized redaction. Production always redacts. */
  redact?: boolean;
}

export interface LowerEstimateCitationResult {
  bytes: Uint8Array;
  pageCount: number;
  badges: number;
  stamps: number;
  highlights: number;
  /** Our category figures stamped on the totals page. */
  totalsStamps: number;
  /** Marks that could not be placed on a measured, collision-free box; each is listed in the index. */
  unplaced: string[];
  /** Every placed mark, top-left origin: the record the placement audit checks. */
  placements: Array<{ kind: PlannedMark["kind"]; rect: PlacementRect }>;
}

type PlannedMark =
  | { kind: "highlight"; rect: PlacementRect }
  | { kind: "stamp"; rect: PlacementRect; text: string }
  | { kind: "badge"; rect: PlacementRect; text: string }
  | { kind: "note"; rect: PlacementRect; text: string };

export async function buildLowerEstimateCitationPdf(params: LowerEstimateCitationParams): Promise<LowerEstimateCitationResult> {
  const { set, model } = params;
  const wordsByPage = new Map<number, Word[]>();
  for (const w of params.words) {
    const list = wordsByPage.get(w.pageNumber) ?? [];
    list.push({ text: w.text, x0: w.x, x1: w.x + w.width, top: w.y, bottom: w.y + w.height });
    wordsByPage.set(w.pageNumber, list);
  }
  const placementWords: PlacementWord[] = params.words.map((w) => ({
    pageNumber: w.pageNumber,
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
    text: w.text,
  }));

  const rows = firstPassRows(parseEstimateRows(wordsByPage));
  const rowByLine = new Map(rows.map((row) => [row.line, row]));

  // Redact first; a copy of the carrier's estimate carries the owner's identity.
  const baseBytes =
    params.redact === false
      ? params.lowerPdfBytes
      : new Uint8Array((await redactAndRasterizePdf(params.lowerPdfBytes, { scope: params.redactionScope })).bytes);
  const doc = await PDFDocument.load(baseBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageSize = (page: number) => doc.getPage(page - 1).getSize();

  const marks: PlannedMark[] = [];
  const unplaced: string[] = [];
  const unplacedByFinding = new Map<LowerFinding, string[]>();
  const free = (rect: PlacementRect, exclude: PlacementRect[] = []) => {
    const { width, height } = pageSize(rect.pageNumber);
    if (rect.x < 1 || rect.y < 1 || rect.x + rect.width > width - 1 || rect.y + rect.height > height - 1) return false;
    if (findCollidingWords(rect, placementWords, exclude).length) return false;
    return !marks.some((mark) => mark.kind !== "highlight" && rectsIntersect(mark.rect, rect, 0.5));
  };
  const lost = (finding: LowerFinding, what: string) => {
    unplaced.push(`Ln ${finding.carrierLine}: ${what}`);
    unplacedByFinding.set(finding, [...(unplacedByFinding.get(finding) ?? []), what]);
  };

  for (const finding of set.findings) {
    const row = rowByLine.get(finding.carrierLine);
    if (!row) {
      lost(finding, "line not found on the page");
      continue;
    }
    for (const stamp of finding.stamps) {
      const cell = row.cells[stamp.field] ?? columnCell(rows, row, stamp.field);
      if (!cell) {
        lost(finding, `our ${stamp.field} ${stamp.value}`);
        continue;
      }
      const cellRect = toRect(row.page, cell);
      const text = toWinAnsiPdfText(stamp.value);
      const width = font.widthOfTextAtSize(text, STAMP_SIZE);
      const stampRect: PlacementRect = {
        pageNumber: row.page,
        x: cell.x0 - 3 - width,
        y: cell.top + (cell.bottom - cell.top - STAMP_SIZE) / 2,
        width,
        height: STAMP_SIZE,
      };
      if (!free(stampRect)) {
        lost(finding, `our ${stamp.field} ${stamp.value}`);
        continue;
      }
      if (row.cells[stamp.field]) marks.push({ kind: "highlight", rect: pad(cellRect, 1) });
      marks.push({ kind: "stamp", rect: stampRect, text });
    }
    if (finding.number > 0) {
      const box = row.box ?? unionCells(row);
      if (!box) {
        lost(finding, `badge D${finding.number}`);
        continue;
      }
      const text = `D${finding.number}`;
      const width = bold.widthOfTextAtSize(text, BADGE_SIZE) + 5;
      const height = BADGE_SIZE + 3;
      const rect: PlacementRect = {
        pageNumber: row.page,
        x: box.x0 - 3 - width,
        y: box.top + (box.bottom - box.top - height) / 2,
        width,
        height,
      };
      if (free(rect)) marks.push({ kind: "badge", rect, text });
      else lost(finding, `badge D${finding.number}`);
    }
  }

  // Our totals beside theirs on the totals page, where the page has room.
  const higherLabor = model.shop.totals.labor;
  let totalsStamps = 0;
  for (const total of parseTotalsFromWords(wordsByPage)) {
    const anchor = total.hoursBox ?? total.rateBox;
    if (!anchor) continue;
    const isSupplies = /paint\s*(supplies|materials)/i.test(total.category);
    const ours = isSupplies
      ? model.shop.totals.paintSupplies.hours
        ? { hours: model.shop.totals.paintSupplies.hours, rate: model.shop.totals.paintSupplies.rate }
        : null
      : higherLabor.find((l) => LABOR_FAMILY[l.cat] === LABOR_FAMILY[labelCat(total.category)]);
    if (!ours || (ours.hours === total.hours && ours.rate === total.rate)) continue;
    // Name our category when it is not theirs ("Aluminum Or Steel Repair" beside their "Frame Labor").
    const ourLabel = !isSupplies && "label" in ours && labelCat(ours.label) !== labelCat(total.category) ? `${ours.label} ` : "";
    const text = toWinAnsiPdfText(`ours ${ourLabel}${ours.hours.toFixed(1)} hrs @ $${ours.rate}`);
    const width = font.widthOfTextAtSize(text, STAMP_SIZE);
    const rect: PlacementRect = {
      pageNumber: total.page,
      x: anchor.x0 - 6 - width,
      y: anchor.top + (anchor.bottom - anchor.top - STAMP_SIZE) / 2,
      width,
      height: STAMP_SIZE,
    };
    if (free(rect)) {
      marks.push({ kind: "stamp", rect, text });
      totalsStamps += 1;
    } else {
      unplaced.push(`${total.category}: ${text}`);
    }
  }

  // One line per page naming its badges, in verified-empty space.
  const badgedByPage = new Map<number, number[]>();
  for (const finding of set.findings) {
    const row = rowByLine.get(finding.carrierLine);
    if (row && finding.number > 0) badgedByPage.set(row.page, [...(badgedByPage.get(row.page) ?? []), finding.number]);
  }
  for (const [page, numbers] of badgedByPage) {
    const text = toWinAnsiPdfText(
      `Findings D${Math.min(...numbers)}${numbers.length > 1 ? `-D${Math.max(...numbers)}` : ""} on this page: our values are stamped in red beside theirs; see the findings index at the end.`
    );
    const rect = pageNoteRect(page, font.widthOfTextAtSize(text, NOTE_SIZE), pageSize(page), free);
    if (rect) marks.push({ kind: "note", rect, text });
  }

  // Draw — every rect was checked above; nothing is placed that was not.
  for (const mark of marks) {
    const page = doc.getPage(mark.rect.pageNumber - 1);
    const H = page.getHeight();
    const y = H - mark.rect.y - mark.rect.height;
    if (mark.kind === "highlight") {
      page.drawRectangle({ x: mark.rect.x, y, width: mark.rect.width, height: mark.rect.height, color: YELLOW, opacity: 0.4 });
    } else if (mark.kind === "stamp") {
      page.drawText(mark.text, { x: mark.rect.x, y: y + 1, size: STAMP_SIZE, font, color: RED });
    } else if (mark.kind === "badge") {
      page.drawRectangle({ x: mark.rect.x, y, width: mark.rect.width, height: mark.rect.height, color: RED });
      page.drawText(mark.text, { x: mark.rect.x + 2.5, y: y + 2, size: BADGE_SIZE, font: bold, color: rgb(1, 1, 1) });
    } else {
      page.drawText(mark.text, { x: mark.rect.x, y: y + 1, size: NOTE_SIZE, font: bold, color: RED });
    }
  }

  appendIndex(doc, font, bold, params, unplacedByFinding);

  return {
    bytes: await doc.save(),
    pageCount: doc.getPageCount(),
    badges: marks.filter((m) => m.kind === "badge").length,
    stamps: marks.filter((m) => m.kind === "stamp").length,
    highlights: marks.filter((m) => m.kind === "highlight").length,
    totalsStamps,
    unplaced,
    placements: marks.map((mark) => ({ kind: mark.kind, rect: mark.rect })),
  };
}

/** Rows of the estimate proper: first occurrence of each line, stopping where
 *  the numbering restarts (a Supplement Summary repeats earlier lines). */
function firstPassRows(rows: EstimateRow[]): EstimateRow[] {
  const ordered = [...rows].sort((a, b) => a.page - b.page || (a.box?.top ?? 0) - (b.box?.top ?? 0));
  const out: EstimateRow[] = [];
  let highest = 0;
  for (const row of ordered) {
    if (row.line <= highest) continue;
    highest = row.line;
    out.push(row);
  }
  return out;
}

/** The column's measured x-range from other rows on the same page, at this row's height. */
function columnCell(rows: EstimateRow[], row: EstimateRow, field: StampField): CellBox | null {
  const cells = rows.filter((r) => r.page === row.page && r.cells[field]).map((r) => r.cells[field]!);
  const box = row.box;
  if (cells.length < 3 || !box) return null;
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const x1 = median(cells.map((c) => c.x1));
  const width = median(cells.map((c) => c.x1 - c.x0));
  // The row prints nothing there; the "cell" is only a position for the stamp.
  return { x0: x1 - width, x1, top: box.top, bottom: box.bottom };
}

function unionCells(row: EstimateRow): CellBox | null {
  const cells = Object.values(row.cells).filter((c): c is CellBox => Boolean(c));
  if (!cells.length) return null;
  return {
    x0: Math.min(...cells.map((c) => c.x0)),
    x1: Math.max(...cells.map((c) => c.x1)),
    top: Math.min(...cells.map((c) => c.top)),
    bottom: Math.max(...cells.map((c) => c.bottom)),
  };
}

const toRect = (pageNumber: number, cell: CellBox): PlacementRect => ({
  pageNumber,
  x: cell.x0,
  y: cell.top,
  width: cell.x1 - cell.x0,
  height: cell.bottom - cell.top,
});
const pad = (rect: PlacementRect, by: number): PlacementRect => ({
  ...rect,
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + by * 2,
  height: rect.height + by * 2,
});

/** A band near the bottom (then the top) of the page with no words in it. */
function pageNoteRect(
  pageNumber: number,
  width: number,
  size: { width: number; height: number },
  free: (rect: PlacementRect) => boolean
): PlacementRect | null {
  const x = Math.max(24, (size.width - width) / 2);
  for (let y = size.height - 16; y > size.height - 90; y -= 2) {
    const rect = { pageNumber, x, y, width, height: NOTE_SIZE + 1 };
    if (free(rect)) return rect;
  }
  for (let y = 6; y < 60; y += 2) {
    const rect = { pageNumber, x, y, width, height: NOTE_SIZE + 1 };
    if (free(rect)) return rect;
  }
  return null;
}

function appendIndex(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  params: LowerEstimateCitationParams,
  unplacedByFinding: Map<LowerFinding, string[]>
) {
  const { model, set } = params;
  const L = model.ledger;
  const { width: W, height: H } = doc.getPage(0).getSize();
  const margin = 40;
  const maxWidth = W - margin * 2;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - margin;
  const money = (n: number) =>
    (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const write = (raw: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 8;
    const f = opts.font ?? font;
    const indent = opts.indent ?? 0;
    const words = toWinAnsiPdfText(raw).split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > maxWidth - indent && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    for (const text of lines) {
      if (y < margin + size) {
        page = doc.addPage([W, H]);
        y = H - margin;
      }
      page.drawText(text, { x: margin + indent, y, size, font: f, color: opts.color ?? rgb(0.1, 0.1, 0.12) });
      y -= size + 3;
    }
    y -= opts.gap ?? 2;
  };

  const ro = model.header.roNumber ? ` | RO ${model.header.roNumber}` : "";
  write("COLLISION iQ", { size: 9, font: bold, color: RED, gap: 4 });
  write(`Delta Citation Density | ${params.lowerName} marked against ${params.higherName}${ro} | ${model.header.vehicle} | ${model.header.preparedDate}`, {
    size: 8,
    gap: 8,
  });
  write("Findings index", { size: 14, font: bold, gap: 6 });
  write(
    `Each badge in the left margin of ${params.lowerName} matches an entry below. A yellow highlight is a value we wrote differently; our value is stamped in red to its left. "Ln" is a line on ${params.lowerName}; "L" in an entry is a line on ${params.higherName}. Every figure comes from the two printed estimates.`,
    { gap: 8 }
  );

  write("Where the difference comes from", { size: 10, font: bold, gap: 3 });
  write(`Our estimate ${money(L.shopTotal)}; this estimate ${money(L.carrierTotal)}; difference ${money(L.gap)}.`);
  write(
    `Labor hours: ours ${L.laborHours.shop.toFixed(1)} vs this estimate ${L.laborHours.carrier.toFixed(1)} = ${L.laborHours.diff.toFixed(1)} hr, ${money(L.laborHours.dollars)} at our rates${
      L.rate.settledByAdjustment ? ` (the rates are settled by this estimate's ${money(L.rate.adjustmentAmount)} rate adjustment)` : ""
    }.`
  );
  if (L.laborRate !== 0) write(`Labor rate still open: ${money(L.laborRate)}.`);
  write(`Paint materials: ${money(L.paintMaterials)}. Parts, sublet and supplies (net): ${money(L.nonLaborNet)}. Tax: ${money(L.tax)}.`);
  if (model.shortPay) {
    write(
      `Gross: this estimate short-pays ${money(model.shortPay.shortPaid)} of our lines and carries ${money(model.shortPay.carrierOver)} that ours does not or pays more on; with tax that is the ${money(L.gap)} difference.`
    );
  }
  y -= 6;

  const entryText = (e: LowerEntry) => (e.kind === "check" ? `CHECK: ${e.text}` : e.text);
  write("Numbered findings", { size: 10, font: bold, gap: 3 });
  for (const finding of set.findings.filter((f) => f.number > 0)) {
    write(`D${finding.number} (Ln ${finding.carrierLine})`, { font: bold, gap: 0 });
    for (const e of finding.entries) write(`- ${entryText(e)}`, { indent: 10, gap: 0 });
    for (const lost of unplacedByFinding.get(finding) ?? []) write(`- Not drawn on the page (no clear space measured): ${lost}.`, { indent: 10, gap: 0 });
    y -= 3;
  }

  const smaller = set.findings.filter((f) => f.number === 0);
  if (smaller.length) {
    y -= 4;
    write("Smaller differences (highlighted and stamped, no badge)", { size: 10, font: bold, gap: 3 });
    for (const finding of smaller) {
      write(`Ln ${finding.carrierLine}: ${finding.entries.map(entryText).join(" ")}`, { size: 7, gap: 0 });
    }
  }
  if (set.unanchored.length) {
    y -= 4;
    write("Not tied to one line", { size: 10, font: bold, gap: 3 });
    for (const e of set.unanchored) write(entryText(e), { gap: 0 });
  }
  y -= 8;
  write(
    "This index cites only the two estimates. Where an entry needs proof, the OEM procedure, P-page or invoice still has to be attached; nothing here stands in for them. The vehicle was not inspected for this document. Working document for the shop, not for the customer.",
    { size: 7, color: rgb(0.35, 0.35, 0.4) }
  );
}

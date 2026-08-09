/**
 * deltaValueAnnotationLayer — plans the on-page delta presentation for the
 * annotated estimate: cell-level highlights on differing values, red
 * underlines on matched prices, competing-value stamps in the ESTIMATE TOTALS
 * category gap, and merged keyed margin notes in verified whitespace.
 *
 * Implements the universal Delta Annotation Rule end-to-end:
 *   extract (typed cells w/ measured bboxes, deltaEngine/rowCluster)
 *   -> classify (deltaEngine/deltaPair, canonical keys, typed cells)
 *   -> place (only on measured bboxes; notes only in whitespace verified empty)
 *   -> audit/repair (annotationPlacementEngine, zero-failure gate).
 *
 * The layer is document-agnostic: no carrier names, RO numbers, column
 * positions, or page counts are encoded. The competing-document label is
 * supplied by the caller from document data.
 */
import { formatBasis, notWrittenOn } from "./deltaWording";
import { canonicalOperationKey } from "./operationAliases";
import {
  findCollidingWords,
  planVerifiedKeyedNotes,
  type KeyedNoteRequest,
  type MeasureText,
  type PlacementPageGeometry,
  type PlacementRect,
  type PlacementWord,
  type PlannedKeyedNote,
} from "./annotationPlacementEngine";
import { canonKey, canonTotalsCategory, stripNote } from "./deltaEngine/estimateNormalize";
import {
  parseEstimateRows,
  parseTotalsFromWords,
  type CellBox,
  type EstimateRow,
  type Word,
} from "./deltaEngine/rowCluster";
import {
  compareTotals,
  pairAndCompare,
  type CellField,
  type Finding,
  type TotalsDelta,
  type TotalsRow,
} from "./deltaEngine/deltaPair";

export interface DeltaValueLayerParams {
  /** Word boxes of the annotated (subject) PDF, top-left origin. */
  subjectWords: PlacementWord[];
  pages: PlacementPageGeometry[];
  /** Competing estimate rows (from words or adapted from parsed text). */
  competingRows: EstimateRow[];
  competingTotals: TotalsRow[];
  /** Short label for the competing document, derived from document data (never hardcoded). */
  competingLabel: string;
  measureText: MeasureText;
  /**
   * Footprints of images and other non-text marks on the subject PDF. The note
   * band is placed in whitespace, and whitespace measured from the text layer
   * alone does not know a payment QR code or a logo is sitting there.
   */
  occupiedRegions?: PlacementRect[];
}

export interface PlannedStamp {
  rect: PlacementRect;
  text: string;
  fontSize: number;
}

export interface DeltaValueLayerPlan {
  underlines: PlacementRect[];
  highlights: PlacementRect[];
  stamps: PlannedStamp[];
  notes: PlannedKeyedNote[];
  unplacedNotes: KeyedNoteRequest[];
  findings: Finding[];
  competingOnly: EstimateRow[];
  totalsDeltas: TotalsDelta[];
}

const NOTE_FONT_SIZE = 8;
const STAMP_FONT_SIZE = 8;
const CELL_PAD = 1.5;

function cellRect(pageNumber: number, box: CellBox): PlacementRect {
  return {
    pageNumber,
    x: box.x0 - CELL_PAD,
    y: box.top - CELL_PAD,
    width: box.x1 - box.x0 + CELL_PAD * 2,
    height: box.bottom - box.top + CELL_PAD * 2,
  };
}

function fmtMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function fmtHours(value: number): string {
  return value.toFixed(1);
}

function fmtCell(field: CellField, value: number): string {
  return field === "price" ? fmtMoney(value) : fmtHours(value);
}

function shortDesc(row: EstimateRow): string {
  const desc = row.rawDesc.replace(/^[#*\s]+/, "").replace(/\s+/g, " ").trim();
  if (desc.length <= 34) return desc;
  // truncate at a word boundary — never mid-word ("Cavity Wax Plus-3M 08852-Pe…")
  const cut = desc.slice(0, 34);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 12 ? lastSpace : 34)}…`;
}

function toEngineWords(words: PlacementWord[]): Map<number, Word[]> {
  const byPage = new Map<number, Word[]>();
  for (const word of words) {
    const list = byPage.get(word.pageNumber) ?? [];
    if (list.length === 0) byPage.set(word.pageNumber, list);
    list.push({
      text: word.text ?? "",
      x0: word.x,
      x1: word.x + word.width,
      top: word.y,
      bottom: word.y + word.height,
    });
  }
  return byPage;
}

/** Pack note pieces for one page into lines that fit the page's note band width. */
function packNoteLines(
  pieces: string[],
  maxWidth: number,
  measureText: MeasureText
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current} | ${piece}` : piece;
    if (current && measureText(candidate, NOTE_FONT_SIZE) > maxWidth) {
      lines.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Attempt a stamp in the horizontal gap LEFT of a measured cell (the ESTIMATE
 * TOTALS category gap). Returns null when the stamp would leave the page or
 * cover any measured word — the caller then carries the value in a note.
 */
function resolveLeftStamp(
  box: CellBox,
  pageNumber: number,
  words: PlacementWord[],
  text: string,
  measureText: MeasureText
): PlacementRect | null {
  const width = measureText(text, STAMP_FONT_SIZE) + CELL_PAD * 2;
  const x = box.x0 - 8 - width;
  if (x < 8) return null;
  const rect: PlacementRect = {
    pageNumber,
    x,
    y: box.top - CELL_PAD,
    width,
    height: box.bottom - box.top + CELL_PAD * 2,
  };
  return findCollidingWords(rect, words).length === 0 ? rect : null;
}

export function planDeltaValueAnnotations(params: DeltaValueLayerParams): DeltaValueLayerPlan {
  const wordsByPage = toEngineWords(params.subjectWords);
  const subjectRows = parseEstimateRows(wordsByPage);
  const subjectTotals = parseTotalsFromWords(wordsByPage);
  const { findings, competingOnly } = pairAndCompare(subjectRows, params.competingRows);
  const label = params.competingLabel;

  const underlines: PlacementRect[] = [];
  const highlights: PlacementRect[] = [];
  const stamps: PlannedStamp[] = [];
  const notePieces = new Map<number, string[]>();
  const addPiece = (pageNumber: number, text: string) => {
    const list = notePieces.get(pageNumber) ?? [];
    if (list.length === 0) notePieces.set(pageNumber, list);
    list.push(text);
  };

  // Matched prices -> red underline on the subject's price cell. A paired row
  // with an equal price is underlined even when other cells differ (the price
  // agreement itself is evidence). MISSED rows and aggregated-group rows are
  // excluded — those get highlights + notes instead.
  const excludedFromUnderline = new Set<EstimateRow>();
  for (const finding of findings) {
    if (finding.deltas.some((delta) => delta.field === "price")) excludedFromUnderline.add(finding.subject);
    if (finding.kind === "MISSED") excludedFromUnderline.add(finding.subject);
    if (finding.kind === "QTY_SHORTFALL") for (const row of finding.subjects ?? [finding.subject]) excludedFromUnderline.add(row);
  }
  for (const row of subjectRows) {
    if (!row.cells.price || row.price === null || row.price === 0) continue;
    if (excludedFromUnderline.has(row)) continue;
    underlines.push(cellRect(row.page, row.cells.price));
  }

  // Merge equal-delta findings (e.g. RT/LT pairs) into one note piece.
  const mergedValueDeltas = new Map<string, { lines: number[]; finding: Finding }>();
  for (const finding of findings) {
    if (finding.kind === "VALUE_DELTA") {
      const signature =
        finding.subject.key +
        "::" +
        finding.deltas
          .map((delta) => `${delta.field}:${String(delta.subject)}->${String(delta.competing)}`)
          .join(",");
      const entry = mergedValueDeltas.get(signature);
      if (entry) entry.lines.push(finding.subject.line);
      else mergedValueDeltas.set(signature, { lines: [finding.subject.line], finding });
    }
    // Cell highlights for every measured differing/flagged cell.
    if (finding.kind === "VALUE_DELTA" || finding.kind === "MISSED" || finding.kind === "QTY_SHORTFALL") {
      for (const subject of finding.subjects ?? [finding.subject]) {
        const fields: CellField[] =
          finding.kind === "VALUE_DELTA"
            ? (finding.deltas.filter((delta) => delta.field !== "part#").map((delta) => delta.field) as CellField[])
            : (["price", "labor", "paint"] as CellField[]).filter((field) => (subject[field] ?? 0) > 0);
        for (const field of fields) {
          const box = subject.cells[field];
          if (box) highlights.push(cellRect(subject.page, box));
        }
      }
    }
  }

  for (const { lines, finding } of mergedValueDeltas.values()) {
    const lineLabel = `Ln ${lines.join("/")}`;
    const parts = finding.deltas.map((delta) =>
      delta.field === "part#"
        ? `part # ${String(delta.subject)} vs ${label} ${String(delta.competing)}`
        : `${delta.field} ${fmtCell(delta.field as CellField, delta.subject as number)} vs ${label} ${fmtCell(
            delta.field as CellField,
            delta.competing as number
          )}`
    );
    addPiece(finding.subject.page, `${lineLabel} ${shortDesc(finding.subject)}: ${parts.join(", ")}`);
  }

  // NEVER CLAIM AN OPERATION IS ABSENT WHEN THE OTHER DOCUMENT CARRIES IT.
  //
  // The text lane already detects this class and withdraws the claim, but it
  // withdraws only its OWN findings; this layer runs its own pairAndCompare and
  // never learned. On RO 22116 that shipped a direct contradiction: the matcher
  // logged "withdrew self-contradictory claims for one operation
  // (URETHANE_ADHESIVE: BetaSeal Express Urethane / A/M Urethane Kit)" while the
  // annotated PDF printed "Ln 112 BetaSeal Express Urethane ($37.00): not
  // written on AMERICAN FAMILY" — a false omission claim on a structural
  // windshield bond.
  //
  // Checking the competing rows here makes it a local invariant rather than
  // state passed between lanes, so the two cannot drift apart again.
  // The OPERATION identity, not the row key: canonKey squashes a description
  // to its own letters, so "BetaSeal Express Urethane" and "A/M Urethane Kit"
  // never collide there. canonicalOperationKey resolves both to
  // URETHANE_ADHESIVE, which is the question being asked.
  const competingOperations = new Set(
    params.competingRows
      .map((row) => canonicalOperationKey(row.rawDesc))
      .filter((key): key is string => Boolean(key))
  );
  const missedByPage = new Map<number, Finding[]>();
  for (const finding of findings) {
    if (finding.kind !== "MISSED") continue;
    const subjectOperation = canonicalOperationKey(finding.subject.rawDesc);
    if (subjectOperation && competingOperations.has(subjectOperation)) continue;
    const list = missedByPage.get(finding.subject.page) ?? [];
    if (list.length === 0) missedByPage.set(finding.subject.page, list);
    list.push(finding);
  }
  for (const [pageNumber, missed] of missedByPage) {
    // one piece per item so the packer can split them across bounded lines
    for (const finding of missed) {
      const subject = finding.subject;
      const value =
        subject.price && subject.price > 0
          ? fmtMoney(subject.price)
          : subject.labor && subject.labor > 0
            ? `${fmtHours(subject.labor)} hr`
            : subject.paint && subject.paint > 0
              ? `${fmtHours(subject.paint)} hr P`
              : "";
      addPiece(
        pageNumber,
        `Ln ${subject.line} ${shortDesc(subject)}${value ? ` (${value})` : ""}: ${notWrittenOn(label)}`
      );
    }
  }

  for (const finding of findings) {
    if (finding.kind !== "QTY_SHORTFALL") continue;
    const parts = finding.deltas.map(
      (delta) =>
        `${delta.field} ${fmtCell(delta.field as CellField, delta.subject as number)} vs ${label} ${fmtCell(
          delta.field as CellField,
          delta.competing as number
        )}`
    );
    addPiece(
      finding.subject.page,
      `Ln ${finding.subject.line}+ ${shortDesc(finding.subject)} (${finding.category}): ${parts.join(", ")}`
    );
  }

  // ESTIMATE TOTALS: highlight the subject cell; stamp the competing value in
  // the measured category gap left of the cell, else carry it in the note.
  const totalsDeltas = compareTotals(subjectTotals, params.competingTotals, canonTotalsCategory);
  const totalsPage = subjectTotals[0]?.page ?? null;
  const totalsByCategory = new Map<string, TotalsDelta[]>();
  for (const delta of totalsDeltas) {
    if (delta.field === "amount") continue; // amounts follow from hours/rate; avoid double-marking
    const key = canonTotalsCategory(delta.category);
    const list = totalsByCategory.get(key) ?? [];
    if (list.length === 0) totalsByCategory.set(key, list);
    list.push(delta);
  }
  for (const [key, deltas] of totalsByCategory) {
    const subjectRow = subjectTotals.find((row) => canonTotalsCategory(row.category) === key);
    if (!subjectRow) continue;
    const hoursDelta = deltas.find((delta) => delta.field === "hours");
    const rateDelta = deltas.find((delta) => delta.field === "rate");
    if (hoursDelta && subjectRow.hoursBox) highlights.push(cellRect(subjectRow.page, subjectRow.hoursBox));
    if (rateDelta && subjectRow.rateBox) highlights.push(cellRect(subjectRow.page, subjectRow.rateBox));
    // One combined stamp per category, anchored in the measured gap left of the
    // hours cell (the widest reliably-empty region on a totals table).
    // ABSENT IS NOT ZERO. A carrier that allows a flat amount prints no hours
    // and no rate; rendering that as "<carrier> 0.0 @ $0.00/hr" tells the shop
    // the carrier pays NOTHING for the category and points the negotiation at
    // the wrong line. RO 22116 stamped exactly that against a flat $650.00
    // paint-supplies allowance.
    const competingRow = params.competingTotals.find(
      (row) => canonTotalsCategory(row.category) === key
    );
    const competingHours = hoursDelta ? hoursDelta.competing : (competingRow?.hours ?? null);
    const competingRate = rateDelta ? rateDelta.competing : (competingRow?.rate ?? null);
    const basisIsAbsent = !competingHours && !competingRate;
    const stampText = basisIsAbsent
      ? competingRow?.amount != null
        ? formatBasis({
            label,
            hours: null,
            rate: null,
            amount: competingRow.amount,
          })
        : null
      : hoursDelta && rateDelta
        ? `${label} ${fmtHours(hoursDelta.competing)} @ ${fmtMoney(rateDelta.competing)}/hr`
        : hoursDelta
          ? `${label} ${fmtHours(hoursDelta.competing)}`
          : rateDelta
            ? `${label} ${fmtMoney(rateDelta.competing)}/hr`
            : null;
    const anchorBox = subjectRow.hoursBox ?? subjectRow.rateBox;
    const rect =
      stampText && anchorBox
        ? resolveLeftStamp(anchorBox, subjectRow.page, params.subjectWords, stampText, params.measureText)
        : null;
    if (stampText && rect) stamps.push({ rect, text: stampText, fontSize: STAMP_FONT_SIZE });
    else if (stampText)
      addPiece(
        subjectRow.page,
        `${subjectRow.category}: ${label} ${deltas
          .map((delta) => `${delta.field} ${delta.competing} (vs ${delta.subject})`)
          .join(", ")}`
      );
  }

  // Reverse pass: lines that exist only on the competing estimate are reported
  // on the totals page (or the last subject page) — never silently dropped.
  // Only report competing-only rows that carry a value — informational lines
  // (contact instructions, zero-value notes) aren't repair-scope evidence.
  const valuedCompetingOnly = competingOnly.filter(
    (row) => (row.price ?? 0) > 0 || (row.labor ?? 0) > 0 || (row.paint ?? 0) > 0
  );
  if (valuedCompetingOnly.length > 0) {
    const reportPage = totalsPage ?? Math.max(...subjectRows.map((row) => row.page), 1);
    const shown = valuedCompetingOnly.slice(0, 6).map((row) => {
      const value =
        row.price && row.price > 0
          ? ` ${fmtMoney(row.price)}`
          : row.labor && row.labor > 0
            ? ` ${fmtHours(row.labor)} hr`
            : row.paint && row.paint > 0
              ? ` ${fmtHours(row.paint)} hr P`
              : "";
      return `${shortDesc(row)}${value}`;
    });
    const overflow = valuedCompetingOnly.length - shown.length;
    addPiece(
      reportPage,
      `On ${label} only: ${shown.join("; ")}${overflow > 0 ? ` (+${overflow} more)` : ""}`
    );
  }

  // Pack pieces into width-bounded lines and place them in verified whitespace.
  const pageByNumber = new Map(params.pages.map((page) => [page.pageNumber, page]));
  const requests: KeyedNoteRequest[] = [];
  for (const [pageNumber, pieces] of [...notePieces.entries()].sort((a, b) => a[0] - b[0])) {
    const geometry = pageByNumber.get(pageNumber);
    const maxWidth = (geometry?.pageWidth ?? 612) - 48;
    // Read in the order the estimate is read. Pieces arrive grouped by finding
    // kind, so a callout band printed "184, 185, then 182, 183, then 180, 181"
    // and the reader had to scan back and forth against the page beside it.
    // Pieces with no line number (document-level roll-ups) sort last.
    const firstLine = (piece: string) => {
      const match = /^Ln\s+(\d+)/.exec(piece);
      return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    };
    const ordered = [...pieces].sort((a, b) => firstLine(a) - firstLine(b));
    packNoteLines(ordered, maxWidth, params.measureText).forEach((line, index) => {
      requests.push({ id: `delta-note-p${pageNumber}-${index}`, pageNumber, text: line });
    });
  }
  const notePlan = planVerifiedKeyedNotes({
    requests,
    words: params.subjectWords,
    pages: params.pages,
    measureText: params.measureText,
    fontSize: NOTE_FONT_SIZE,
    allowPageFallback: true,
    occupiedRegions: params.occupiedRegions,
  });

  return {
    underlines,
    highlights,
    stamps,
    notes: notePlan.placed,
    unplacedNotes: notePlan.unplaced,
    findings,
    competingOnly,
    totalsDeltas,
  };
}

/**
 * Adapt rows parsed from a competing estimate's TEXT (no coordinates) into
 * delta-engine rows. Cell bboxes stay empty — a text-adapted row can pair and
 * compare but can never be the target of an on-text mark, per the rule.
 */
export function estimateRowFromTextFields(fields: {
  lineNumber: number | null;
  description: string;
  section: string | null;
  partNumber: string | null;
  qty: number | null;
  price: number | null;
  labor: number | null;
  paint: number | null;
  laborType: string | null;
  page?: number | null;
}): EstimateRow | null {
  const cleaned = stripNote(fields.description ?? "");
  const ck = canonKey(cleaned);
  if (!ck.key) return null;
  return {
    page: fields.page ?? 0,
    line: fields.lineNumber ?? 0,
    section: fields.section ? canonKey(fields.section).key : "",
    qty: fields.qty,
    price: fields.price,
    labor: fields.labor,
    paint: fields.paint,
    laborClass: fields.laborType ?? "",
    part: fields.partNumber,
    rawDesc: cleaned,
    key: ck.key,
    side: ck.side,
    cells: {},
  };
}

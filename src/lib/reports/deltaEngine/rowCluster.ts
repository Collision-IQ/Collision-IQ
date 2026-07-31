/**
 * rowCluster — baseline-proximity row clustering + typed value cells with
 * MEASURED bboxes, per the universal Delta Annotation Rule.
 *
 * ROOT-CAUSE FIXES vs prior builds:
 *  (a) NEVER quantize tops onto a fixed grid (round(top/N) split a line number
 *      from its own description into different bands -> fused rows -> false
 *      part_added findings). Cluster by running proximity instead: new row when
 *      the gap from the row start exceeds ROW_TOL.
 *  (b) Values are typed by MEASURED column x-ranges from THIS page's header row —
 *      qty and price stay separate ("0" + "0.00" never fuse into "00.00"),
 *      and a paint-column number can never be reported as "body labor".
 *  (c) Every typed value cell records the word bbox it came from, so downstream
 *      marks are anchored to measured coordinates — a row whose cell bbox is
 *      missing is only eligible for margin notes, never for on-text marks.
 */
import { canonKey, stripNote, extractPart, repairTokens, type CanonKey } from "./estimateNormalize";

export interface Word {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

/** Measured bbox of a typed value cell, top-left origin PDF points. */
export interface CellBox {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface EstimateRow {
  page: number;
  line: number;
  section: string;
  qty: number | null;
  price: number | null;
  labor: number | null;
  paint: number | null;
  laborClass: string;
  part: string | null;
  rawDesc: string;
  key: string;
  side: CanonKey["side"];
  cells: { qty?: CellBox; price?: CellBox; labor?: CellBox; paint?: CellBox };
}

const ROW_TOL = 3.5; // pt — baseline proximity, per DELTA_ANNOTATION_RULE §1
const COL_PAD = { qty: [25, 8], price: [22, 16], labor: [24, 18], paint: [24, 18] } as const;

/**
 * Some extractors (pdfjs text items) return whole runs — "23.8 hrs @ $ 90.00 /hr"
 * as ONE word. Split composite words on whitespace, apportioning the measured
 * run bbox across tokens by character share. Each sub-token bbox stays inside
 * the measured run bbox, so downstream marks remain anchored to measurement.
 */
export function tokenizeWords(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const word of words) {
    const trimmed = word.text.trim();
    if (!/\s/.test(trimmed)) {
      if (trimmed) out.push(trimmed === word.text ? word : { ...word, text: trimmed });
      continue;
    }
    const totalChars = word.text.length;
    const unit = (word.x1 - word.x0) / Math.max(1, totalChars);
    const pattern = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(word.text)) !== null) {
      out.push({
        text: match[0],
        x0: word.x0 + match.index * unit,
        x1: word.x0 + (match.index + match[0].length) * unit,
        top: word.top,
        bottom: word.bottom,
      });
    }
  }
  return out;
}

export function clusterRows(words: Word[]): Word[][] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const rows: { top: number; ws: Word[] }[] = [];
  for (const word of sorted) {
    const last = rows[rows.length - 1];
    if (last && word.top - last.top <= ROW_TOL) last.ws.push(word);
    else rows.push({ top: word.top, ws: [word] });
  }
  return rows.map((row) => row.ws.sort((a, b) => a.x0 - b.x0));
}

export interface ColRanges {
  qty: [number, number];
  price: [number, number];
  labor: [number, number];
  paint: [number, number];
}

/** Measure column x-ranges from the header row of the given page's words. Null if absent. */
export function measureColumns(words: Word[]): ColRanges | null {
  const find = (text: string) => words.find((word) => word.text === text && word.top < 220);
  const qty = find("Qty");
  const extended = find("Extended");
  const labor = find("Labor");
  const paint = find("Paint");
  if (!qty || !extended || !labor || !paint) return null;
  return {
    qty: [qty.x0 - COL_PAD.qty[0], qty.x1 + COL_PAD.qty[1]],
    price: [extended.x0 - COL_PAD.price[0], extended.x1 + COL_PAD.price[1]],
    labor: [labor.x0 - COL_PAD.labor[0], labor.x1 + COL_PAD.labor[1]],
    paint: [paint.x0 - COL_PAD.paint[0], paint.x1 + COL_PAD.paint[1]],
  };
}

const NUM = /^-?[\d,]+\.?\d*$/;
const SUFFIX = new Set(["M", "T", "X", "INCL.", "INCL"]);

export function parsePage(
  words: Word[],
  pageNo: number,
  cols: ColRanges,
  state: { section: string; prev: EstimateRow | null }
): EstimateRow[] {
  const out: EstimateRow[] = [];
  for (const ws of clusterRows(words)) {
    const joined = repairTokens(ws.map((word) => word.text).join(" "));
    if (
      /^note\b/i.test(joined) ||
      joined.includes("SUBTOTALS") ||
      (joined.includes("Page") && joined.includes("/20"))
    ) {
      state.prev = null;
      continue;
    }
    const first = ws[0].text;
    const isLine = /^\d{1,3}$/.test(first) && ws.length > 1;
    const lineNo = isLine ? parseInt(first, 10) : NaN;
    if (isLine && state.prev && lineNo <= state.prev.line) {
      state.prev.rawDesc += " " + joined; // wrapped text starting with a number
      continue;
    }
    if (!isLine) {
      // section header: all-caps, no numeric cells (with or without a line number)
      if (joined === joined.toUpperCase() && !/\d/.test(joined) && joined.length < 40) {
        state.section = canonKey(joined).key;
        state.prev = null;
      } else if (state.prev) state.prev.rawDesc += " " + joined;
      continue;
    }
    const row: EstimateRow = {
      page: pageNo,
      line: lineNo,
      section: state.section,
      qty: null,
      price: null,
      labor: null,
      paint: null,
      laborClass: "",
      part: null,
      rawDesc: "",
      key: "",
      side: "",
      cells: {},
    };
    const desc: string[] = [];
    for (const word of ws.slice(1)) {
      const { part, trailing } = extractPart(word.text);
      if (part) {
        row.part = part;
        if (NUM.test(trailing) && parseFloat(trailing) < 10 && row.qty === null)
          row.qty = parseFloat(trailing); // glued qty digit after part number
        continue;
      }
      if (NUM.test(word.text)) {
        // A bare 1-4 after a filled labor cell is the user-defined labor CLASS
        // column, not a value — typing it into a column corrupts qty/paint.
        if (/^[1-4]$/.test(word.text) && row.labor !== null && !row.laborClass) {
          row.laborClass = word.text;
          continue;
        }
        const value = parseFloat(word.text.replace(/,/g, ""));
        const mid = (word.x0 + word.x1) / 2;
        const box: CellBox = { x0: word.x0, x1: word.x1, top: word.top, bottom: word.bottom };
        const inCol = (range: [number, number]) => mid >= range[0] && mid <= range[1];
        if (inCol(cols.qty)) {
          row.qty = value;
          row.cells.qty = box;
        } else if (inCol(cols.price)) {
          row.price = value;
          row.cells.price = box;
        } else if (inCol(cols.labor)) {
          row.labor = value;
          row.cells.labor = box;
        } else if (inCol(cols.paint)) {
          row.paint = value;
          row.cells.paint = box;
        } else desc.push(word.text);
      } else if (SUFFIX.has(word.text.toUpperCase())) {
        if (row.labor !== null && !row.laborClass && /^[MTX1-4]$/.test(word.text)) row.laborClass = word.text;
      } else desc.push(repairTokens(word.text));
    }
    row.rawDesc = stripNote(desc.join(" "));
    if (!row.rawDesc) continue;
    // numbered section header (e.g. "30 SIDE PANEL"): all caps, zero value cells
    if (
      row.qty === null &&
      row.price === null &&
      row.labor === null &&
      row.paint === null &&
      !row.part &&
      row.rawDesc === row.rawDesc.toUpperCase() &&
      !/[a-z]/.test(row.rawDesc)
    ) {
      state.section = canonKey(row.rawDesc).key;
      state.prev = null;
      continue;
    }
    const ck = canonKey(row.rawDesc);
    row.key = ck.key;
    row.side = ck.side;
    if (!row.key) continue;
    out.push(row);
    state.prev = row;
  }
  return out;
}

/** Parse a whole document's words (grouped per page) into rows, carrying the
 * measured column ranges forward across pages whose header row is absent. */
export function parseEstimateRows(wordsByPage: Map<number, Word[]>): EstimateRow[] {
  const rows: EstimateRow[] = [];
  const state = { section: "", prev: null as EstimateRow | null };
  let cols: ColRanges | null = null;
  const pages = [...wordsByPage.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    const words = tokenizeWords(wordsByPage.get(page)!);
    const measured = measureColumns(words);
    if (measured) cols = measured;
    if (!cols) continue;
    rows.push(...parsePage(words, page, cols, state));
  }
  return rows;
}

export interface TotalsRowWithBoxes {
  page: number;
  category: string;
  hours: number | null;
  hoursBox: CellBox | null;
  rate: number | null;
  rateBox: CellBox | null;
  amount: number;
  amountBox: CellBox | null;
}

/**
 * Parse the ESTIMATE TOTALS table from a page's words, recording the measured
 * bbox of every hours/rate/amount cell. Handles both spaced ("23.8 hrs") and
 * glued ("23.8hrs", "$90.00/hr") token layouts.
 */
export function parseTotalsFromWords(wordsByPage: Map<number, Word[]>): TotalsRowWithBoxes[] {
  const out: TotalsRowWithBoxes[] = [];
  const STOP = /^(SUBTOTAL|SALESTAX|GRANDTOTAL|TOTALCOST|DEDUCTIBLE|TOTALADJUSTMENTS|NETCOST|MISCELLANEOUS|PARTS)/;
  for (const [page, rawWords] of [...wordsByPage.entries()].sort((a, b) => a[0] - b[0])) {
    const words = tokenizeWords(rawWords);
    const heading = clusterRows(words).findIndex((ws) =>
      ws.map((w) => w.text).join("").replace(/\s/g, "").toUpperCase().includes("ESTIMATETOTALS")
    );
    if (heading < 0) continue;
    const rows = clusterRows(words);
    for (const ws of rows.slice(heading + 1)) {
      const categoryWords: string[] = [];
      let hours: number | null = null;
      let hoursBox: CellBox | null = null;
      let rate: number | null = null;
      let rateBox: CellBox | null = null;
      let amount: number | null = null;
      let amountBox: CellBox | null = null;
      let sawRateMarker = false;
      for (const word of ws) {
        const text = word.text;
        const box: CellBox = { x0: word.x0, x1: word.x1, top: word.top, bottom: word.bottom };
        const hrsMatch = /^([\d.,]+)hrs$/i.exec(text);
        if (hrsMatch) {
          hours = parseFloat(hrsMatch[1].replace(/,/g, ""));
          hoursBox = box;
          continue;
        }
        if (/^hrs$/i.test(text)) continue;
        const rateMatch = /^\$?([\d.,]+)\/hr$/i.exec(text);
        if (rateMatch) {
          rate = parseFloat(rateMatch[1].replace(/,/g, ""));
          rateBox = box;
          continue;
        }
        if (text === "@" || text === "$") {
          sawRateMarker = text === "$" || sawRateMarker;
          continue;
        }
        if (/^\/hr$/i.test(text)) continue;
        if (/^-?[\d,]+\.\d{2}$/.test(text)) {
          const value = parseFloat(text.replace(/,/g, ""));
          if (sawRateMarker && rate === null) {
            rate = value;
            rateBox = box;
            sawRateMarker = false;
          } else {
            amount = value;
            amountBox = box;
          }
          continue;
        }
        if (/^-?[\d,]+\.\d$/.test(text) && hours === null) {
          hours = parseFloat(text.replace(/,/g, ""));
          hoursBox = box;
          continue;
        }
        if (/[A-Za-z]/.test(text)) categoryWords.push(text);
      }
      const category = categoryWords.join(" ").trim();
      if (!category) continue;
      const squashed = category.replace(/\s/g, "").toUpperCase();
      if (STOP.test(squashed)) {
        if (/^(SUBTOTAL|GRANDTOTAL|TOTALCOST|NETCOST)/.test(squashed)) break;
        continue;
      }
      if (amount === null && hours === null && rate === null) continue;
      out.push({ page, category, hours, hoursBox, rate, rateBox, amount: amount ?? 0, amountBox });
    }
    if (out.length > 0) break;
  }
  return out;
}

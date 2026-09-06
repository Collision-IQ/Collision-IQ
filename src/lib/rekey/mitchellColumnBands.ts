/**
 * RS-3 — Number / Qty / Price read from measured column bands.
 *
 * The Mitchell print welds a part number and its quantity into ONE text item:
 * the producer emits "88723-06130 1" as a single show-text operation, so no
 * amount of string splitting can prove where the part number ends. The reader
 * that works from reflowed text has to guess, and says so on every such row
 * ("qty welded: verify").
 *
 * The geometry does not have to guess. The header row prints one label per
 * column, and every label's x position is measured from the document. A band
 * runs from one label's x to the next label's x, and an item's position says
 * which band it is in — including a welded item, whose START sits in the
 * Number band while its END reaches into the Qty band. A welded item that
 * crosses the boundary has its last whitespace-separated token in the next
 * column, and that is a measurement, not a reading of the string.
 *
 * Nothing here is specific to a carrier, a shop or a vehicle: the bands come
 * from whatever the header prints, and the column labels are matched by name.
 */

/** The minimum of a PDF word this reader needs. Callers map their extractor's
 *  word type onto it, so this module pulls in no PDF dependency. */
export interface MitchellPageWord {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/** What the bands say a printed line carries. Any field the bands could not
 *  read stays null and the text reader's value stands. */
export interface MitchellColumnRow {
  partNumber: string | null;
  qty: number | null;
  price: number | null;
  taxable: boolean | null;
  /** Labor and refinish hours, when the print gives each its own column.
   *  The Mitchell layout does not — it prints one units column — so these
   *  stay null there and the text reader's reading stands. */
  labor?: { hours: number | null; included: boolean } | null;
  paint?: { hours: number | null; included: boolean } | null;
  /** The letter a CCC print puts beside the hours to name their labor type
   *  ("m" for mechanical, "s" for structural). Null when it prints none,
   *  which on that layout means body. */
  laborMarker?: string | null;
  /** "T" or "X" — the CCC print's own mark that the amount on this line is a
   *  MISCELLANEOUS charge, taxed or not, rather than a part. Its abbreviation
   *  legend spells it out: T = taxed miscellaneous, X = non taxed
   *  miscellaneous. On the real estimate the amounts split by this mark come
   *  to $5,314.38 of parts and $1,791.21 of miscellaneous — both to the cent
   *  what its totals page prints. */
  miscMarker?: "T" | "X" | null;
}

export interface MitchellColumnReading {
  /** Which print's header the bands came from. The two layouts state
   *  different things on a line — Mitchell a per-line tax flag, CCC a mark
   *  that the amount is a charge rather than a part — so the caller has to
   *  know which it is holding. */
  layout: "mitchell" | "ccc";
  /** Keyed by the line number the source prints against the row. */
  rows: Map<number, MitchellColumnRow>;
  /** Column label to band, for the sheet to report what it measured. */
  bands: Array<{ label: string; from: number; to: number }>;
  pagesRead: number[];
}

const LINE_LABEL = /^line\s*#?$/i;
const DESCRIPTION_LABEL = /^description$/i;
const NUMBER_LABEL = /^number$/i;
/** The producer welds this pair into one header item on the prints seen so
 *  far; either half alone is also accepted. */
const QTY_PRICE_LABEL = /^(?:qty|quantity)(?:\s+total\s+price|\s+price)?$/i;
const TAX_LABEL = /^tax$/i;

const MONEY = /^\$?-?[\d,]+\.\d{2}\*?$/;
const INTEGER = /^\d{1,4}$/;
const PART_FRAGMENT = /^[A-Z0-9][A-Z0-9-]*$/i;

function money(value: string): number | null {
  const cleaned = value.replace(/[$,*]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The CCC print's own header. Its columns separate cleanly — every cell is
 * its own text item — so nothing here has to be split; the work is only
 * saying which band each item is in.
 *
 * The reflowed text of this layout is a different matter, and is why this
 * exists: the print gives no separator between a part number, its quantity
 * and its price, so "521190X948" + "1" + "461.44" arrives as
 * "521190X9481461.44" and the price reads as $1,461.44 — a thousand dollars
 * over, on every part line whose quantity is one. On a real estimate that
 * put the parts total at $15,346.23 against a printed $5,314.38, and the
 * sheet was refused rather than keyed.
 */
const CCC_LINE_LABEL = /^line$/i;
const CCC_OPER_LABEL = /^oper(?:ation)?$/i;
const CCC_PART_LABEL = /^part\s*(?:number|no\.?)$/i;
const CCC_QTY_LABEL = /^qty|^quantity$/i;
const CCC_PRICE_LABEL = /^(?:extended|ext\.?|price|amount)$/i;
const CCC_LABOR_LABEL = /^labor$/i;
const CCC_PAINT_LABEL = /^(?:paint|refinish)$/i;

const INCLUDED = /^incl\.?$/i;
const HOURS = /^\d{1,3}(?:\.\d)?$/;

/** Words grouped into printed lines, page by page, by their y position. */
function toLines(words: MitchellPageWord[]): Array<{ page: number; y: number; items: MitchellPageWord[] }> {
  const byPage = new Map<number, MitchellPageWord[]>();
  for (const word of words) {
    const list = byPage.get(word.page) ?? [];
    list.push(word);
    byPage.set(word.page, list);
  }
  const lines: Array<{ page: number; y: number; items: MitchellPageWord[] }> = [];
  for (const [page, pageWords] of byPage) {
    const rows: MitchellPageWord[][] = [];
    for (const word of [...pageWords].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find((candidate) => {
        const mid = candidate.reduce((total, item) => total + item.y, 0) / candidate.length;
        return Math.abs(mid - word.y) <= Math.max(3.5, word.height * 0.55);
      });
      if (row) row.push(word);
      else rows.push([word]);
    }
    for (const row of rows) {
      lines.push({ page, y: Math.min(...row.map((item) => item.y)), items: [...row].sort((a, b) => a.x - b.x) });
    }
  }
  return lines.sort((a, b) => a.page - b.page || a.y - b.y);
}

type Bands = {
  line: { from: number; to: number };
  number: { from: number; to: number };
  qtyPrice: { from: number; to: number };
  labels: Array<{ label: string; from: number; to: number }>;
};

/**
 * Bands for one header row: each label's x to the next label's x.
 *
 * Qty and Total Price arrive as one header item on these prints, so they are
 * carried as ONE band and separated inside it by shape — a money token is the
 * price, a bare integer is the quantity. Splitting a glued header label by
 * estimated character advance would put a boundary in the document that the
 * document never printed.
 */
function bandsFor(header: { items: MitchellPageWord[] }): Bands | null {
  const items = header.items;
  const at = (test: RegExp) => items.findIndex((item) => test.test(item.text.trim()));
  const lineIndex = at(LINE_LABEL);
  const numberIndex = at(NUMBER_LABEL);
  const qtyIndex = at(QTY_PRICE_LABEL);
  if (lineIndex < 0 || numberIndex < 0 || qtyIndex < 0 || at(DESCRIPTION_LABEL) < 0) return null;

  const edges = items.map((item) => item.x);
  const band = (index: number) => ({ from: edges[index], to: index + 1 < edges.length ? edges[index + 1] : Number.POSITIVE_INFINITY });
  const taxIndex = at(TAX_LABEL);
  return {
    line: band(lineIndex),
    number: band(numberIndex),
    qtyPrice: { from: edges[qtyIndex], to: taxIndex > qtyIndex ? edges[taxIndex] : Number.POSITIVE_INFINITY },
    labels: items.map((item, index) => ({ label: item.text.trim(), ...band(index) })),
  };
}

/** Tokens of an item, tagged with the band each one falls in. A welded item
 *  starts in one band and ends in the next; its last token is in the next. */
function splitAcrossBoundary(item: MitchellPageWord, boundary: number): { head: string; tail: string | null } {
  const text = item.text.trim();
  if (item.x + item.width <= boundary) return { head: text, tail: null };
  const cut = text.lastIndexOf(" ");
  if (cut <= 0) return { head: text, tail: null };
  return { head: text.slice(0, cut).trim(), tail: text.slice(cut + 1).trim() };
}

type CccBands = {
  line: { from: number; to: number };
  part: { from: number; to: number };
  qty: { from: number; to: number };
  price: { from: number; to: number };
  labor: { from: number; to: number };
  paint: { from: number; to: number };
  labels: Array<{ label: string; from: number; to: number }>;
};

/**
 * Bands for a CCC header row.
 *
 * Unlike the Mitchell print, this one centres a header over its column
 * rather than left-aligning it, so a header's x is NOT where its data
 * starts: the description sits at 143 under a "Description" label at 182.
 * That only matters left of the part number, and the description and
 * operation are read from the text, so the bands taken here are the five
 * the text cannot read — part number, quantity, price, labor, paint —
 * plus the line number that keys them. Each of those columns' data does
 * fall inside its own header-to-header span on this print.
 */
function cccBandsFor(header: { items: MitchellPageWord[] }): CccBands | null {
  const items = header.items;
  const at = (test: RegExp) => items.findIndex((item) => test.test(item.text.trim()));
  const line = at(CCC_LINE_LABEL);
  const oper = at(CCC_OPER_LABEL);
  const part = at(CCC_PART_LABEL);
  const qty = at(CCC_QTY_LABEL);
  const price = at(CCC_PRICE_LABEL);
  const labor = at(CCC_LABOR_LABEL);
  const paint = at(CCC_PAINT_LABEL);
  if ([line, oper, part, qty, price, labor, paint].some((index) => index < 0)) return null;

  const edges = items.map((item) => item.x);
  const band = (index: number) => ({
    from: edges[index],
    to: index + 1 < edges.length ? edges[index + 1] : Number.POSITIVE_INFINITY,
  });
  return {
    line: band(line),
    part: band(part),
    qty: band(qty),
    price: band(price),
    labor: band(labor),
    paint: { from: edges[paint], to: Number.POSITIVE_INFINITY },
    labels: items.map((item, index) => ({ label: item.text.trim(), ...band(index) })),
  };
}

/** Hours, or the print's word for hours already inside another line. */
function readHours(items: MitchellPageWord[]): { hours: number | null; included: boolean } | null {
  for (const item of items) {
    const text = item.text.trim();
    if (INCLUDED.test(text)) return { hours: 0, included: true };
    if (HOURS.test(text)) return { hours: Number(text), included: false };
  }
  return null;
}

/**
 * Read a CCC print's part, quantity, price, labor and refinish columns.
 *
 * Returns null when no page carries a header this reader recognizes.
 */
export function readCccColumns(words: MitchellPageWord[]): MitchellColumnReading | null {
  const lines = toLines(words);
  const rows = new Map<number, MitchellColumnRow>();
  const pagesRead: number[] = [];
  let labels: CccBands["labels"] = [];

  // This print heads its columns ONCE, on the first line-item page, and runs
  // the rest of the items under it across the following pages with no header
  // of their own. Bands therefore carry forward until another header replaces
  // them; reading each page independently found page 2 and dropped the other
  // three quarters of the estimate.
  let bands: CccBands | null = null;
  for (const page of [...new Set(lines.map((line) => line.page))]) {
    const pageLines = lines.filter((line) => line.page === page);
    const headerIndex = pageLines.findIndex((line) => cccBandsFor(line) !== null);
    if (headerIndex >= 0) bands = cccBandsFor(pageLines[headerIndex]);
    if (!bands) continue;
    if (labels.length === 0) labels = bands.labels;
    pagesRead.push(page);

    for (const line of pageLines.slice(headerIndex + 1)) {
      const inBand = (band: { from: number; to: number }) =>
        line.items.filter((item) => item.x >= band.from - 0.5 && item.x < band.to - 0.5);

      const lineNumberItem = inBand(bands.line).find((item) => INTEGER.test(item.text.trim()));
      if (!lineNumberItem) continue;

      const partItems = inBand(bands.part).filter((item) => PART_FRAGMENT.test(item.text.trim()));
      const qtyItem = inBand(bands.qty).find((item) => INTEGER.test(item.text.trim()));
      // The price band also carries the print's tax marker, which is not a
      // price; money is taken by shape rather than by being first in the band.
      const priceItems = inBand(bands.price);
      const priceItem = priceItems.find((item) => MONEY.test(item.text.trim()));
      // The same band carries the print's own markers: "T" that the line is
      // taxed, and a letter naming the labor type when it is not body. They
      // can arrive as one item ("T m").
      const markers = priceItems
        .flatMap((item) => item.text.trim().split(/\s+/))
        .filter((token) => /^[A-Za-z]$/.test(token));
      const miscMarker = (markers.find((token) => token === "T" || token === "X") as "T" | "X" | undefined) ?? null;
      const laborMarker = markers.find((token) => token !== "T" && token !== "X") ?? null;

      rows.set(Number(lineNumberItem.text.trim()), {
        partNumber: partItems.length > 0 ? partItems.map((item) => item.text.trim()).join("") : null,
        qty: qtyItem ? Number(qtyItem.text.trim()) : null,
        price: priceItem ? money(priceItem.text.trim()) : null,
        // A part line carries no tax mark on this print — parts are taxed
        // through the parts lane — so the only per-line tax this layout
        // states is on a miscellaneous charge.
        taxable: miscMarker === null ? null : miscMarker === "T",
        labor: readHours(inBand(bands.labor)),
        paint: readHours(inBand(bands.paint)),
        laborMarker,
        miscMarker,
      });
    }
  }

  if (pagesRead.length === 0) return null;
  return { layout: "ccc", rows, bands: labels, pagesRead };
}

/**
 * The column bands of whichever line-item print this document is, or null
 * when it is neither. One entry point so the caller does not have to know
 * the layout before it has read the header.
 */
export function readEstimateColumns(words: MitchellPageWord[]): MitchellColumnReading | null {
  return readMitchellColumns(words) ?? readCccColumns(words);
}

/**
 * Read every Mitchell line-item page's Number, Qty, Price and Tax columns.
 *
 * Returns null when no page carries a header this reader recognizes — the
 * caller then keeps whatever the text reader produced, rather than losing
 * columns to a layout the bands cannot describe.
 */
export function readMitchellColumns(words: MitchellPageWord[]): MitchellColumnReading | null {
  const lines = toLines(words);
  const rows = new Map<number, MitchellColumnRow>();
  const pagesRead: number[] = [];
  let labels: Bands["labels"] = [];

  const pages = [...new Set(lines.map((line) => line.page))];
  for (const page of pages) {
    const pageLines = lines.filter((line) => line.page === page);
    const headerIndex = pageLines.findIndex((line) => bandsFor(line) !== null);
    if (headerIndex < 0) continue;
    const bands = bandsFor(pageLines[headerIndex]) as Bands;
    if (labels.length === 0) labels = bands.labels;
    pagesRead.push(page);

    /** The row a wrapped part number belongs to, while its number is open. */
    let pendingWrap: MitchellColumnRow | null = null;

    for (const line of pageLines.slice(headerIndex + 1)) {
      const inBand = (band: { from: number; to: number }) =>
        line.items.filter((item) => item.x >= band.from - 0.5 && item.x < band.to - 0.5);

      const lineNumberItem = inBand(bands.line).find((item) => INTEGER.test(item.text.trim()));
      const numberItems = inBand(bands.number);

      if (!lineNumberItem) {
        // A part number that wrapped: the print breaks it after a hyphen and
        // sets the remainder on the next line, in the same column. Only a
        // pending number left open by a hyphen takes a continuation, so page
        // furniture printed in the same band is never joined to a part.
        if (pendingWrap?.partNumber?.endsWith("-")) {
          const fragment = numberItems.find((item) => PART_FRAGMENT.test(item.text.trim()));
          if (fragment) {
            pendingWrap.partNumber = `${pendingWrap.partNumber}${fragment.text.trim()}`;
            pendingWrap = null;
            continue;
          }
        }
        continue;
      }

      const lineNumber = Number(lineNumberItem.text.trim());
      const row: MitchellColumnRow = { partNumber: null, qty: null, price: null, taxable: null };

      // The Number band, with any token that reaches over the boundary handed
      // to the quantity column it is printed in.
      const qtyPriceTokens: string[] = [];
      for (const item of numberItems) {
        const { head, tail } = splitAcrossBoundary(item, bands.qtyPrice.from);
        if (head) row.partNumber = row.partNumber === null ? head : `${row.partNumber}${head}`;
        if (tail) qtyPriceTokens.push(tail);
      }
      for (const item of inBand(bands.qtyPrice)) qtyPriceTokens.push(...item.text.trim().split(/\s+/));

      for (const token of qtyPriceTokens) {
        if (MONEY.test(token)) row.price = money(token);
        else if (INTEGER.test(token) && row.qty === null) row.qty = Number(token);
      }

      const tax = line.items.find((item) => item.x >= bands.qtyPrice.to - 0.5);
      if (tax) row.taxable = /^yes$/i.test(tax.text.trim()) ? true : /^no$/i.test(tax.text.trim()) ? false : null;

      rows.set(lineNumber, row);
      pendingWrap = row;
    }
  }

  if (pagesRead.length === 0) return null;
  return { layout: "mitchell", rows, bands: labels, pagesRead };
}

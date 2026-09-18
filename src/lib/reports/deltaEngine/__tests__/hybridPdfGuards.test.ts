/**
 * RO 22084 — the hybrid-PDF failure class inside the delta engine.
 *
 * A full-page raster of the rule lines under a real, positioned text layer.
 * The header printed lower than the reference position and in capitals, so
 * no page's columns could be measured, the engine built zero rows, resolved
 * neither grand total, and R24 refused to ship a pair whose figures were
 * printed plainly on the page.
 *
 * Two guards, each with a same-form control so the reference print keeps
 * measuring exactly as it did.
 */
import { describe, expect, it } from "vitest";
import { measureColumns, parseEstimateRows, parseGrandTotalFromWords, type Word } from "../rowCluster";
import { compareEstimateTotals } from "../../estimateDeltaMatcher";

/** Lay words out on one baseline at the given x positions. */
function row(top: number, cells: Array<[string, number]>, width = 6): Word[] {
  return cells.map(([text, x0]) => ({ text, x0, x1: x0 + text.length * width, top, bottom: top + 9 }));
}

const REFERENCE_HEADER: Array<[string, number]> = [
  ["Line", 40], ["Oper", 70], ["Description", 110], ["Part", 300], ["Number", 330],
  ["Qty", 400], ["Extended", 440], ["Labor", 510], ["Paint", 560],
];

describe("column measurement finds the header wherever and however it prints", () => {
  it("the reference print measures as before (control)", () => {
    const cols = measureColumns(row(120, REFERENCE_HEADER));
    expect(cols).not.toBeNull();
    expect(cols!.qty[0]).toBeLessThan(400);
    expect(cols!.price[0]).toBeLessThan(440);
    expect(cols!.labor[0]).toBeLessThan(510);
    expect(cols!.paint[0]).toBeLessThan(560);
  });

  it("a capitalised header printed below the reference band still measures", () => {
    const header: Array<[string, number]> = [
      ["LINE", 40], ["OPER", 70], ["DESCRIPTION", 110], ["QTY", 400], ["EXTENDED", 440], ["LABOR", 510], ["PAINT", 560],
    ];
    const cols = measureColumns(row(310, header));
    expect(cols).not.toBeNull();
    expect(cols!.labor[0]).toBeLessThan(510);
    expect(cols!.labor[1]).toBeGreaterThan(510 + 5 * 6);
  });

  it("a glued 'ExtendedPrice$' header and a bare 'Price' header both measure", () => {
    const glued = measureColumns(row(120, [["Qty", 400], ["ExtendedPrice$", 440], ["Labor", 510], ["Paint", 560]]));
    expect(glued).not.toBeNull();
    const bare = measureColumns(row(120, [["Qty", 400], ["Price", 445], ["Labor", 510], ["Paint", 560]]));
    expect(bare).not.toBeNull();
    expect(bare!.price[0]).toBeLessThan(445);
  });

  it("prose that merely contains the four words, out of column order, is not a header", () => {
    const prose = row(200, [["Paint", 40], ["labor", 90], ["and", 140], ["qty", 170], ["price", 210]]);
    expect(measureColumns(prose)).toBeNull();
  });

  it("a page with no header measures nothing, as before", () => {
    expect(measureColumns(row(120, [["Qty", 400], ["Labor", 510], ["Paint", 560]]))).toBeNull();
    expect(measureColumns([])).toBeNull();
  });

  it("the reference position is preferred when a lower row also qualifies", () => {
    const words = [
      ...row(120, [["Qty", 400], ["Extended", 440], ["Labor", 510], ["Paint", 560]]),
      ...row(600, [["Qty", 380], ["Extended", 420], ["Labor", 490], ["Paint", 540]]),
    ];
    const cols = measureColumns(words)!;
    expect(cols.qty[0]).toBe(400 - 25);
  });

  it("rows type their cells against a header the engine could not see before", () => {
    const page = [
      ...row(310, [["LINE", 40], ["OPER", 70], ["DESCRIPTION", 110], ["QTY", 400], ["EXTENDED", 440], ["LABOR", 510], ["PAINT", 560]]),
      ...row(330, [["FRONT", 40], ["BUMPER", 80]]),
      ...row(345, [["1", 40], ["Repl", 70], ["Bumper", 110], ["cover", 150], ["1", 405], ["905.00", 445], ["2.3", 515], ["2.4", 565]]),
      ...row(360, [["2", 40], ["Blnd", 70], ["Fender", 110], ["1.0", 565]]),
    ];
    const rows = parseEstimateRows(new Map([[1, page]]));
    expect(rows.map((r) => r.line)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ qty: 1, price: 905, labor: 2.3, paint: 2.4 });
    expect(rows[1]).toMatchObject({ paint: 1.0, labor: null, price: null });
  });
});

describe("grand total resolved from the positioned word layer", () => {
  it("a CCC estimate: Grand Total on the totals page, net figure below it does not displace it", () => {
    const page = [
      ...row(500, [["ESTIMATE", 40], ["TOTALS", 100]]),
      ...row(520, [["Subtotal", 40], ["12,800.00", 500]]),
      ...row(535, [["Sales", 40], ["Tax", 75], ["1,044.81", 500]]),
      ...row(550, [["Grand", 40], ["Total", 75], ["13,844.81", 500]]),
      ...row(565, [["Deductible", 40], ["500.00", 500]]),
      ...row(580, [["Net", 40], ["Cost", 65], ["of", 95], ["Repairs", 115], ["13,344.81", 500]]),
    ];
    const total = parseGrandTotalFromWords(new Map([[7, page]]));
    expect(total).toMatchObject({ value: 13844.81, basis: "gross", page: 7, form: "ccc-estimate" });
    expect(total!.label).toBe("Grand Total");
  });

  it("a CCC supplement: the cumulative NET COST OF REPAIRS on the last page outranks a per-stage total earlier", () => {
    const stage = [
      ...row(400, [["Total", 40], ["Cost", 75], ["of", 105], ["Repairs", 125], ["9,000.00", 500]]),
      ...row(415, [["Total", 40], ["Supplement", 75], ["Amount", 150], ["2,500.00", 500]]),
    ];
    const summary = [
      ...row(300, [["NET", 40], ["COST", 70], ["OF", 105], ["REPAIRS", 125], ["11,618.63", 500]]),
    ];
    const total = parseGrandTotalFromWords(new Map([[6, stage], [8, summary]]));
    expect(total).toMatchObject({ value: 11618.63, basis: "net", page: 8, form: "ccc-supplement" });
    expect(total!.label).toBe("NET COST OF REPAIRS");
  });

  it("'Total Supplement Amount' is never the document total", () => {
    const page = row(415, [["Total", 40], ["Supplement", 75], ["Amount", 150], ["2,500.00", 500]]);
    expect(parseGrandTotalFromWords(new Map([[6, page]]))).toBeNull();
  });

  it("a Mitchell form: Gross Total outranks Net Total on the same page; 'Grand Total:' with its colon reads too", () => {
    const mitchell = [
      ...row(600, [["Net", 40], ["Total", 65], ["4,500.00", 500]]),
      ...row(580, [["Gross", 40], ["Total", 75], ["5,000.00", 500]]),
    ];
    expect(parseGrandTotalFromWords(new Map([[3, mitchell]]))).toMatchObject({ value: 5000, basis: "gross", form: "mitchell" });
    const colon = row(580, [["Grand", 40], ["Total:", 75], ["$5,000.00", 500]]);
    expect(parseGrandTotalFromWords(new Map([[3, colon]]))).toMatchObject({ value: 5000, label: "Grand Total:" });
  });

  it("only money to the right of the label on the same baseline counts; the rightmost token wins", () => {
    const leftOnly = row(580, [["1,234.56", 40], ["Grand", 300], ["Total", 335]]);
    expect(parseGrandTotalFromWords(new Map([[1, leftOnly]]))).toBeNull();
    const two = row(580, [["Grand", 40], ["Total", 75], ["13,000.00", 400], ["13,844.81", 500]]);
    expect(parseGrandTotalFromWords(new Map([[1, two]]))!.value).toBe(13844.81);
    const otherBaseline = [...row(580, [["Grand", 40], ["Total", 75]]), ...row(620, [["13,844.81", 500]])];
    expect(parseGrandTotalFromWords(new Map([[1, otherBaseline]]))).toBeNull();
  });

  it("a page with no total label resolves nothing", () => {
    const page = row(100, [["Subtotal", 40], ["12,800.00", 500]]);
    expect(parseGrandTotalFromWords(new Map([[1, page]]))).toBeNull();
    expect(parseGrandTotalFromWords(new Map())).toBeNull();
  });
});

describe("a totals block read for its grand total alone supports no category claim", () => {
  const higher = {
    categories: [
      { category: "Parts", hours: null, rate: null, cost: 6000 },
      { category: "Body Labor", hours: 40, rate: 75, cost: 3000 },
      { category: "Paint Supplies", hours: 20, rate: 40, cost: 800 },
    ],
    subtotal: 9800,
    salesTax: 600,
    grandTotal: 10400,
    taxLanes: [{ label: "Sales Tax", amount: 600 }],
  };
  const lowerUnread = { categories: [], subtotal: null, salesTax: null, grandTotal: 8100, taxLanes: [] };

  it("states only the difference between the two printed totals", () => {
    const deltas = compareEstimateTotals({ higher, lower: lowerUnread });
    expect(deltas.map((delta) => delta.kind)).toEqual(["total_difference"]);
    expect(deltas[0].amount).toBe(2300);
  });

  it("a fully read pair still compares category by category (control)", () => {
    const lower = {
      categories: [
        { category: "Parts", hours: null, rate: null, cost: 5000 },
        { category: "Body Labor", hours: 40, rate: 60, cost: 2400 },
        { category: "Paint Supplies", hours: 20, rate: 30, cost: 600 },
      ],
      subtotal: 8000,
      salesTax: 400,
      grandTotal: 8400,
      taxLanes: [{ label: "Sales Tax", amount: 400 }],
    };
    const kinds = compareEstimateTotals({ higher, lower }).map((delta) => delta.kind);
    expect(kinds).toContain("rate_difference");
    expect(kinds).toContain("total_difference");
    expect(kinds).not.toContain("category_missing_on_lower");
  });
});

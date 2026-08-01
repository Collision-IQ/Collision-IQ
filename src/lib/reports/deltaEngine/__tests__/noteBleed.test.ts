/**
 * RC-1 reproduction: NOTE fragments and orphan-row splits in the comparison
 * estimate must never terminate the open row, become rows themselves, or leak
 * stub rows to the matcher.
 *
 * Shapes reproduced from the RO 22047 USAA text layer (fixture data only —
 * no rule keys on any carrier/RO string):
 *  A) "43 R&I" stub + NOTE + "LT Outer bracket ..." continuation → one row.
 *  B) NOTE between a row and its wrapped description tail → tail attaches.
 */
import { describe, expect, it } from "vitest";
import {
  emptyRowParseDiagnostics,
  parseEstimateRows,
  type Word,
} from "../rowCluster";

// Column geometry mirroring a CCC print: Qty ~350, Extended ~424, Labor ~490, Paint ~545.
const HEADER: Word[] = [
  { text: "Line", x0: 40, x1: 60, top: 100, bottom: 108 },
  { text: "Oper", x0: 80, x1: 100, top: 100, bottom: 108 },
  { text: "Description", x0: 140, x1: 190, top: 100, bottom: 108 },
  { text: "Qty", x0: 348, x1: 362, top: 100, bottom: 108 },
  { text: "Extended", x0: 410, x1: 445, top: 100, bottom: 108 },
  { text: "Labor", x0: 480, x1: 505, top: 100, bottom: 108 },
  { text: "Paint", x0: 535, x1: 558, top: 100, bottom: 108 },
];

function row(top: number, cells: Array<[string, number, number]>): Word[] {
  return cells.map(([text, x0, x1]) => ({ text, x0, x1, top, bottom: top + 8 }));
}

describe("RC-1 note-bleed / orphan-row split", () => {
  it("shape A: oper-only stub + NOTE + continuation reconstitutes as ONE owned row", () => {
    const words: Word[] = [
      ...HEADER,
      ...row(120, [["42", 40, 50], ["R&I", 80, 98], ["RT", 140, 152], ["Outer", 156, 178], ["bracket", 182, 210], ["PT00009497J", 240, 300], ["0", 352, 358], ["0.00", 424, 440], ["0.3", 488, 500], ["0.0", 540, 552]]),
      ...row(134, [["43", 40, 50], ["R&I", 80, 98]]),
      ...row(148, [["NOTE:", 60, 85], ["LABOR:", 90, 120], ["Time", 124, 142], ["is", 146, 152], ["after", 156, 174], ["flare", 178, 196], ["is", 200, 206], ["removed.", 210, 245]]),
      ...row(162, [["LT", 140, 152], ["Outer", 156, 178], ["bracket", 182, 210], ["PT00009496K", 240, 300], ["0", 352, 358], ["0.00", 424, 440], ["0.3", 488, 500], ["0.0", 540, 552]]),
    ];
    const diag = emptyRowParseDiagnostics();
    const rows = parseEstimateRows(new Map([[1, words]]), diag);
    expect(rows.map((r) => r.line)).toEqual([42, 43]);
    const l43 = rows.find((r) => r.line === 43)!;
    expect(l43.key).toBe("OUTERBRACKET");
    expect(l43.side).toBe("LT");
    expect(l43.part).toBe("PT00009496K");
    expect(l43.labor).toBe(0.3);
    expect(diag.reconstitutedRows).toBe(1);
    expect(diag.rejectedStubRows).toEqual([]);
  });

  it("shape B: NOTE between a row and its wrapped tail does not sever the row", () => {
    const words: Word[] = [
      ...HEADER,
      ...row(120, [["20", 40, 50], ["R&I", 80, 98], ["RT", 140, 152], ["Roof", 156, 176], ["molding", 180, 212], ["PT00876030A", 240, 300], ["0", 352, 358], ["0.00", 424, 440], ["0.5", 488, 500], ["0.0", 540, 552]]),
      ...row(134, [["NOTE:", 60, 85], ["Lift", 90, 105], ["weatherstrip,", 109, 160], ["mask", 164, 184], ["for", 188, 200], ["prep", 204, 222]]),
      ...row(148, [["vs", 140, 150], ["OEM", 154, 174], ["1-time", 178, 202], ["use", 206, 220]]),
      ...row(162, [["21", 40, 50], ["R&I", 80, 98], ["LT", 140, 152], ["Roof", 156, 176], ["molding", 180, 212], ["PT00876020A", 240, 300], ["0", 352, 358], ["0.00", 424, 440], ["0.5", 488, 500], ["0.0", 540, 552]]),
    ];
    const rows = parseEstimateRows(new Map([[1, words]]));
    expect(rows.map((r) => r.line)).toEqual([20, 21]);
    const l20 = rows.find((r) => r.line === 20)!;
    // the NOTE is payload on the row, never identity, never a row of its own
    expect(l20.note).toMatch(/weatherstrip/);
    expect(l20.key).toBe("ROOFMOLDING");
    // the post-note tail attaches to line 20 without corrupting its key
    expect(rows.find((r) => r.line === 21)!.key).toBe("ROOFMOLDING");
  });

  it("an unreconstitutable stub is rejected loudly and never emitted", () => {
    const words: Word[] = [
      ...HEADER,
      ...row(120, [["50", 40, 50], ["R&I", 80, 98]]),
      ...row(134, [["51", 40, 50], ["Repl", 80, 98], ["Bumper", 140, 168], ["cover", 172, 194], ["1", 352, 358], ["720.49", 418, 440], ["0.1", 488, 500], ["0.0", 540, 552]]),
    ];
    const diag = emptyRowParseDiagnostics();
    const rows = parseEstimateRows(new Map([[1, words]]), diag);
    expect(rows.map((r) => r.line)).toEqual([51]);
    expect(diag.rejectedStubRows).toEqual([{ page: 1, line: 50, fragment: "R&I" }]);
  });
});

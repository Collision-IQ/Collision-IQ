/**
 * F5 (Test 99) — column-band assignment runs per PRINTED row.
 *
 * A wrapped CCC description continues on a second printed line with no line
 * number. Appending that line's raw text to the description put whatever
 * value cells it carried into the description; typing each printed row
 * against the same header-derived bands keeps the cells as cells.
 */
import { describe, it, expect } from "vitest";
import { parsePage, type Word, type ColRanges, type RowParseState } from "../rowCluster";

const COLS: ColRanges = { qty: [300, 340], price: [360, 420], labor: [440, 490], paint: [510, 560] };
const state = (): RowParseState => ({ section: "", prev: null, pendingStub: null, lastWasNote: false });

let y = 0;
function line(tokens: Array<[string, number]>): Word[] {
  y += 12;
  return tokens.map(([text, x]) => ({ text, x0: x, x1: x + text.length * 5, top: y, bottom: y + 9 }));
}

describe("wrapped-description continuation lines", () => {
  it("types a value cell printed on the continuation line by its column, not into the description", () => {
    const first = line([["61", 40], ["Finish", 60], ["sand", 95], ["&", 120], ["polish", 130], ["(0.5", 170], ["Refinish", 195], ["3", 310]]);
    const second = line([["per", 60], ["panel)", 80], ["1.5", 520]]);
    const rows = parsePage([...first, ...second], 1, COLS, state());
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(3);
    expect(rows[0].paint).toBe(1.5);
    expect(rows[0].rawDesc).toBe("Finish sand & polish (0.5 Refinish per panel)");
    expect(rows[0].rawDesc).not.toMatch(/\b3\b|1\.5/);
  });

  it("leaves a number in the description band on the continuation as prose", () => {
    const first = line([["12", 40], ["Repl", 60], ["Hood", 90], ["2,223.54", 370], ["2.1", 450]]);
    const second = line([["w/o", 60], ["2", 90], ["techs", 100]]);
    const rows = parsePage([...first, ...second], 1, COLS, state());
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(2223.54);
    expect(rows[0].labor).toBe(2.1);
    expect(rows[0].rawDesc).toBe("Repl Hood w/o 2 techs");
  });

  it("never overwrites a cell the first printed row already read", () => {
    const first = line([["7", 40], ["R&I", 60], ["Grille", 90], ["1", 310], ["671.23", 370], ["0.6", 450]]);
    const second = line([["with", 60], ["camera", 90], ["0.3", 450]]);
    const rows = parsePage([...first, ...second], 1, COLS, state());
    expect(rows[0].labor).toBe(0.6);
    expect(rows[0].qty).toBe(1);
    expect(rows[0].price).toBe(671.23);
  });
});

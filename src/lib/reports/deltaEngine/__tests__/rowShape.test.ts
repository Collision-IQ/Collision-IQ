/**
 * U-3 (Work Order R3) — a row is a non-operation by SHAPE, never by text:
 * no operation token, no part number, no value cell, no quantity. Banner and
 * marketing rows vary per carrier; their wording must never be tested.
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

describe("shape-based non-operation gate", () => {
  it("prose banner row with no values parses as nothing (text never tested)", () => {
    const words = line([["12", 40], ["Please", 60], ["visit", 100], ["our", 130], ["preferred", 150], ["network", 200]]);
    expect(parsePage(words, 1, COLS, state())).toHaveLength(0);
  });
  it("URL-only row is a non-operation by shape", () => {
    const words = line([["13", 40], ["https://carrier.example.com/supplements", 60]]);
    expect(parsePage(words, 1, COLS, state())).toHaveLength(0);
  });
  it("phone-only row is a non-operation by shape", () => {
    const words = line([["14", 40], ["(800)", 60], ["555-0123", 100]]);
    const rows = parsePage(words, 1, COLS, state());
    expect(rows.filter((row) => row.line === 14)).toHaveLength(0);
  });
  it("documentation row WITH a printed quantity survives", () => {
    const words = line([["4", 40], ["****Work", 60], ["Authorization", 110], ["Secured****", 170], ["1", 310]]);
    const rows = parsePage(words, 1, COLS, state());
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(1);
  });
  it("operation row with only an op token and description survives (Incl. rows)", () => {
    const words = line([["71", 40], ["R&I", 60], ["Light", 100], ["bar", 130]]);
    const rows = parsePage(words, 1, COLS, state());
    expect(rows).toHaveLength(1);
  });
});

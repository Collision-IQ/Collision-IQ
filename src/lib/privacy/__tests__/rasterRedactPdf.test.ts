/**
 * TRUE redaction of the source estimate pages.
 *
 * Drawing a filled rectangle over an identifier is a FALSE redaction — the
 * glyphs stay in the content stream, selectable and extractable. So each page
 * is rendered to pixels, the identifiers are painted out ON THE RASTER, and the
 * image replaces the page. The text layer is destroyed by construction.
 *
 * These cases cover the span arithmetic. The end-to-end proof lives in the
 * render pack: after this runs, `pdf-parse` extracts ZERO characters from the
 * source pages of an annotated estimate, and the export scanner reports clean.
 *
 * The misses that the first cut shipped, all now covered:
 *   "Insured:" / "Owner:" / "License:" — the label and its value are SEPARATE
 *   text items, so a rule that only looks inside one item left the name, the
 *   plate and the claim tail in the clear. Values are collected first, then
 *   swept wherever they reappear.
 */
import { describe, it, expect } from "vitest";
import { identifierSpans, isSweepableValue } from "../rasterRedactPdf";

const cover = (text: string) => {
  const spans = identifierSpans(text);
  return spans.map((span) => text.slice(span.start, span.end));
};

describe("the VIN keeps its first 9 characters and loses its last 8", () => {
  it("covers only the last 8, even when the VIN is welded to the next label", () => {
    const text = "VIN:5YJ3E1EA6PF691987Interior Color:WHITE";
    expect(cover(text)).toEqual(["PF691987"]);
  });

  it("leaves the readable prefix and the surrounding labels alone", () => {
    const text = "VIN:5YJ3E1EA6PF691987Interior Color:WHITE";
    const spans = identifierSpans(text);
    const surviving = text.slice(0, spans[0].start) + text.slice(spans[0].end);
    expect(surviving).toContain("5YJ3E1EA6");
    expect(surviving).toContain("Interior Color:WHITE");
  });

  it("does not treat a long claim number as a VIN", () => {
    expect(cover("Reference 012283486000000800001 filed")).toEqual([]);
  });
});

describe("identifiers inside one text item", () => {
  it("covers a claim value whole, including its revision suffix", () => {
    expect(cover("Claim #: 01009983776-1")).toEqual(["01009983776-1"]);
  });

  it("covers phone numbers and street addresses", () => {
    expect(cover("(267) 847-8051 Cell")).toEqual(["(267) 847-8051"]);
    expect(cover("510 Morris Ln")).toEqual(["510 Morris Ln"]);
  });

  it("covers a carrier name wherever it appears", () => {
    expect(cover("AMERICAN FAMILY INSURANCE")[0]).toMatch(/AMERICAN FAMILY/i);
    expect(cover("Paid by USAA today")).toEqual(["USAA"]);
  });

  it("covers a personal name that shares its item with the label", () => {
    expect(cover("Insured: YU, WENBAO")).toEqual(["YU, WENBAO"]);
  });

  it("leaves estimate content untouched", () => {
    expect(cover("2023 TESL Model 3 RWD 4D SED Electric- Electric GRAY")).toEqual([]);
    expect(cover("Repl RT Headlamp assy 156371400G 2,341.65")).toEqual([]);
    expect(cover("RO Number: 22116")).toEqual([]);
  });
});

describe("values swept across items are chosen carefully", () => {
  it("accepts a real identifier or name", () => {
    for (const value of ["YU, WENBAO", "01009983776-1", "MJS8933", "AMERICAN FAMILY INSURANCE"]) {
      expect(isSweepableValue(value)).toBe(true);
    }
  });

  it("refuses values too short or generic to sweep for", () => {
    // Sweeping these would black out the estimate itself.
    for (const value of ["PA", "0", "None", "N/A", "Cell", "Business", "Repair Facility"]) {
      expect(isSweepableValue(value)).toBe(false);
    }
  });
});

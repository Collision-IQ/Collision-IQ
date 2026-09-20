/**
 * F7 (Test 98 F5 / Test 99 F7) — the natural_person redaction scope.
 *
 * Under the full scope every identifier goes: insurer, claim number, every
 * phone and address, the writer's name. RO 22132's annotated pages lost the
 * shop's street, phone and fax, the writer's name, the insurer and the claim
 * number — the things a supplement is filed under. natural_person keeps
 * those legible and removes only a natural person's identity and the VIN
 * tail; contact-shaped text is painted only inside a MEASURED owner block.
 *
 * The full scope's behaviour is asserted alongside so the switch is a
 * choice, not a regression.
 */
import { describe, it, expect } from "vitest";
import { identifierSpans, itemInsideBlock, planStructuralRedactions, type MeasuredTextItem } from "../rasterRedactPdf";

const cover = (text: string, options?: Parameters<typeof identifierSpans>[2]) =>
  identifierSpans(text, undefined, options).map((span) => text.slice(span.start, span.end));

describe("natural_person scope", () => {
  it("keeps the insurer, claim number and RO legible", () => {
    expect(cover("Insurance Company: Progressive Specialty", { scope: "natural_person" })).toEqual([]);
    expect(cover("Claim #: 26-743005532-01", { scope: "natural_person" })).toEqual([]);
    expect(cover("RO Number: 22132", { scope: "natural_person" })).toEqual([]);
    expect(cover("Paid by USAA today", { scope: "natural_person" })).toEqual([]);
  });

  it("keeps the shop's contact details and the writer's name", () => {
    expect(cover("961 Lancaster Ave", { scope: "natural_person" })).toEqual([]);
    expect(cover("(610) 644-1000", { scope: "natural_person" })).toEqual([]);
    expect(cover("Written By: Oskar Keller", { scope: "natural_person" })).toEqual([]);
    expect(cover("max@conestogacollision.com", { scope: "natural_person" })).toEqual([]);
  });

  it("still removes the owner's name beside an owner-type label", () => {
    expect(cover("Owner: YU, WENBAO", { scope: "natural_person" })).toEqual(["YU, WENBAO"]);
    expect(cover("Insured: YU, WENBAO", { scope: "natural_person" })).toEqual(["YU, WENBAO"]);
  });

  it("still removes the VIN tail", () => {
    expect(cover("VIN:5YJ3E1EA6PF691987Interior Color:WHITE", { scope: "natural_person" })).toEqual(["PF691987"]);
  });

  it("removes contact details only inside the measured owner block", () => {
    const phone = "(215) 866-8390";
    expect(cover(phone, { scope: "natural_person", inNaturalPersonBlock: false })).toEqual([]);
    expect(cover(phone, { scope: "natural_person", inNaturalPersonBlock: true })).toEqual([phone]);
    const street = "741 FIRST AVE";
    expect(cover(street, { scope: "natural_person", inNaturalPersonBlock: true })).toEqual([street]);
  });
});

describe("full scope — every identifier on the page (RO 21336 review)", () => {
  it("covers the carrier, the claim value and a phone wherever they appear", () => {
    expect(cover("Paid by USAA today", { scope: "full" })).toEqual(["USAA"]);
    expect(cover("Claim #: 26-743005532-01", { scope: "full" })).toEqual(["26-743005532-01"]);
    expect(cover("Claim #: 0544822570101016-01", { scope: "full" })).toEqual(["0544822570101016-01"]);
    expect(cover("(610) 644-1000", { scope: "full" })).toEqual(["(610) 644-1000"]);
    expect(cover("Written By: Oskar Keller", { scope: "full" })).toEqual(["Oskar Keller"]);
    expect(cover("Written By: VINCENT MENICHETTI, 739698", { scope: "full" })).toEqual(["VINCENT MENICHETTI, 739698"]);
    expect(cover("Adjuster: CRACHA, FERNANDO, (267) 400-0761 Business", { scope: "full" })).toEqual([
      "CRACHA, FERNANDO, (267) 400-0761 Business",
    ]);
  });

  it("covers the document's own identifiers: RO, workfile ID, federal / tax ID", () => {
    expect(cover("RO Number: 21336", { scope: "full" })).toEqual(["21336"]);
    expect(cover("Workfile ID: 18380e2a", { scope: "full" })).toEqual(["18380e2a"]);
    expect(cover("Federal ID: 27-0822500", { scope: "full" })).toEqual(["27-0822500"]);
    expect(cover("Tax ID: 27-0822500", { scope: "full" })).toEqual(["27-0822500"]);
  });

  it("covers the plate and the shop's web domain", () => {
    expect(cover("License: LYK2804", { scope: "full" })).toEqual(["LYK2804"]);
    expect(cover("conestogacollision.com", { scope: "full" })).toEqual(["conestogacollision.com"]);
    expect(cover("Get live updates at www.carwise.com/e/574vTg", { scope: "full" })).toEqual(["www.carwise.com/e/574vTg"]);
    expect(cover("max@conestogacollision.com", { scope: "full" })).toEqual(["max@conestogacollision.com"]);
  });

  it("leaves the estimate's own content alone", () => {
    expect(cover("2025 CHEV Suburban LT 4WD 4D UTV 8-5.3L Gasoline Direct Injection WHITE", { scope: "full" })).toEqual([]);
    expect(cover("Repl RT Headlamp assy 156371400G 2,341.65", { scope: "full" })).toEqual([]);
    expect(cover("Date of Loss: 11/18/2025 8:50 AM", { scope: "full" })).toEqual([]);
  });

  it("is the default", () => {
    expect(cover("Paid by USAA today")).toEqual(["USAA"]);
  });
});

describe("full scope — measured structural regions", () => {
  const item = (text: string, x: number, y: number, width = 100, height = 10): MeasuredTextItem => ({ text, x, y, width, height });
  // pdf.js page space: y grows upward; the letterhead sits ABOVE the title.
  const page = { width: 612, height: 792 };
  const items = [
    item("conestogacollision.com", 200, 740),
    item("961 Lancaster Avenue, Berwyn, PA 19312", 190, 720),
    item("Workfile ID:", 430, 745),
    item("18380e2a", 520, 745),
    item("Federal ID:", 430, 733),
    item("27-0822500", 520, 733),
    item("Preliminary Estimate", 240, 690, 120, 12),
    item("RO Number:", 30, 660),
    item("21336", 100, 660),
    item("Owner:", 30, 560),
    item("DEVON, HARRIS", 30, 548),
    item("12 Main Street", 30, 536),
    item("Berwyn, PA 19312", 30, 524),
    item("(610) 291-8864 Cell", 30, 512),
    item("Inspection Location:", 210, 560),
    item("conestogacollision.com", 210, 548),
    item("Repair Facility", 210, 524),
    item("Insurance Company:", 400, 560),
    item("GEICO ADVANTAGE INSURANCE COMPANY", 400, 548),
    item("VEHICLE", 280, 440),
    item("2025 CHEV Suburban LT 4WD", 30, 420),
  ];
  const regions = planStructuralRedactions(items, page.width, page.height);

  it("paints the letterhead band above the document title, logo included, and nothing below it", () => {
    const band = regions.find((region) => region.reason === "letterhead_band")!;
    expect(band).toBeDefined();
    expect(band.x).toBe(0);
    expect(band.width).toBe(page.width);
    // From just above the title's top edge to the top of the page.
    expect(band.y).toBe(690 + 12 + 2);
    expect(band.y + band.height).toBe(page.height);
    // The title and everything beneath it survive the band.
    expect(itemInsideBlock(item("Preliminary Estimate", 240, 690, 120, 12), band)).toBe(false);
    expect(itemInsideBlock(item("RO Number:", 30, 660), band)).toBe(false);
    // The letterhead does not.
    expect(itemInsideBlock(item("conestogacollision.com", 200, 740), band)).toBe(true);
    expect(itemInsideBlock(item("27-0822500", 520, 733), band)).toBe(true);
  });

  it("measures a block beneath the owner, inspection-location and insurer labels", () => {
    const blocks = regions.filter((region) => region.reason === "label_block");
    expect(blocks).toHaveLength(3);
    const inside = (text: string) => blocks.some((block) => itemInsideBlock(items.find((candidate) => candidate.text === text)!, block));
    expect(inside("DEVON, HARRIS")).toBe(true);
    expect(inside("Repair Facility")).toBe(true);
    expect(inside("GEICO ADVANTAGE INSURANCE COMPANY")).toBe(true);
    // The vehicle block below is out of reach.
    expect(inside("VEHICLE")).toBe(false);
    expect(inside("2025 CHEV Suburban LT 4WD")).toBe(false);
  });

  it("paints no band on a page with no document title", () => {
    expect(planStructuralRedactions([item("Line Oper Description", 30, 700)], page.width, page.height)).toEqual([]);
  });
});

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
import { identifierSpans } from "../rasterRedactPdf";

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

describe("full scope is unchanged", () => {
  it("covers the carrier, the claim value and a phone wherever they appear", () => {
    expect(cover("Paid by USAA today", { scope: "full" })).toEqual(["USAA"]);
    expect(cover("Claim #: 26-743005532-01", { scope: "full" })).toEqual(["26-743005532-01"]);
    expect(cover("(610) 644-1000", { scope: "full" })).toEqual(["(610) 644-1000"]);
    expect(cover("Written By: Oskar Keller", { scope: "full" })).toEqual(["Oskar Keller"]);
  });

  it("is the default", () => {
    expect(cover("Paid by USAA today")).toEqual(["USAA"]);
  });
});

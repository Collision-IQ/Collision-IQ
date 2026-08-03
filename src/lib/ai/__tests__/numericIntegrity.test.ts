/**
 * P0-5 — the $100 fabrication.
 *
 * RO 22185's Customer Report stated the carrier-only inner bracket at
 * "$180.56", twice, and the chat repeated it. The Estimate of Record says
 * $80.56, and the findings report had it right. This is the check the review
 * called out as the one that would have caught it.
 */
import { describe, it, expect } from "vitest";
import {
  assertNoFabricatedCurrency,
  collectKnownCurrencyValues,
  extractCurrencyMentions,
  findFabricatedCurrency,
  isSupportedCurrencyValue,
  NumericHallucinationError,
} from "../numericIntegrity";

const FINDINGS = {
  totals: { shop: 8745.29, carrier: 3642.51, gap: 5102.78 },
  carrierOnly: [{ part: "51127420665", amount: 80.56 }],
  valueDeltas: [
    { line: 61, shop: 686.05, carrier: 619.71 },
    { line: 65, shop: 480.22, carrier: 433.81 },
  ],
  rateDeltas: [{ shop: 75.0, carrier: 62.0 }],
};

describe("the RO 22185 fabrication is caught", () => {
  it("flags $180.56 against a structured $80.56 and names the real figure", () => {
    const prose =
      "Erie also lists a left inner bracket at $180.56 that your shop's estimate does not include.";
    const fabricated = findFabricatedCurrency(prose, FINDINGS);
    expect(fabricated).toHaveLength(1);
    expect(fabricated[0].text).toBe("$180.56");
    expect(fabricated[0].nearest).toBe(80.56);
  });

  it("throws for the artifact, naming it", () => {
    expect(() =>
      assertNoFabricatedCurrency("Customer Report", "a bracket at $180.56", FINDINGS)
    ).toThrow(NumericHallucinationError);
  });

  it("passes the same sentence with the correct figure", () => {
    expect(
      findFabricatedCurrency("a left inner bracket at $80.56 is on Erie only", FINDINGS)
    ).toEqual([]);
  });
});

describe("figures the findings do support are left alone", () => {
  it("accepts every exact structured value", () => {
    const prose =
      "Your shop's estimate is $8,745.29 and Erie's is $3,642.51, a difference of $5,102.78. " +
      "The tail lamps are $686.05 vs $619.71 and $480.22 vs $433.81, at $75.00 vs $62.00 an hour.";
    expect(findFabricatedCurrency(prose, FINDINGS)).toEqual([]);
  });

  it("accepts honest rounding — 'roughly $5,100' of a known $5,102.78", () => {
    expect(findFabricatedCurrency("a gap of roughly $5,100", FINDINGS)).toEqual([]);
    expect(findFabricatedCurrency("a gap of about $5,000", FINDINGS)).toEqual([]);
  });

  it("does NOT accept invented precision — rounding never adds decimals", () => {
    // $5,102.79 is one cent off a real figure and is not a rounding of it.
    const fabricated = findFabricatedCurrency("a gap of $5,102.79", FINDINGS);
    expect(fabricated).toHaveLength(1);
  });

  it("does not accept a figure that merely looks plausible", () => {
    expect(findFabricatedCurrency("a supplement of $1,250.00", FINDINGS)).toHaveLength(1);
  });
});

describe("mechanics", () => {
  it("reads currency tokens in their written forms", () => {
    expect(extractCurrencyMentions("$8,745.29 and $80.56 and $ 62").map((m) => m.value)).toEqual([
      8745.29, 80.56, 62,
    ]);
  });

  it("harvests values from nested structured findings", () => {
    const known = collectKnownCurrencyValues(FINDINGS);
    expect(known.has(80.56)).toBe(true);
    expect(known.has(5102.78)).toBe(true);
    expect(known.has(619.71)).toBe(true);
    expect(known.has(180.56)).toBe(false);
  });

  it("also harvests figures written inside structured strings", () => {
    const known = collectKnownCurrencyValues({ summary: "priced at $1,234.56 on the carrier estimate" });
    expect(known.has(1234.56)).toBe(true);
  });

  it("is inert when there is nothing to check against", () => {
    expect(findFabricatedCurrency("$999.99", {})).toEqual([]);
    expect(findFabricatedCurrency("", FINDINGS)).toEqual([]);
  });

  it("supports an explicit known-value set", () => {
    expect(isSupportedCurrencyValue(80.56, new Set([80.56]))).toBe(true);
    expect(isSupportedCurrencyValue(180.56, new Set([80.56]))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { extractMarketPreviewState, selectOwnerOrInsuredZip } from "@/lib/ai/marketPreviewOwnerZip";

// Regression: RO 22047 (test session 2026-07-30). Both estimates repeat the
// repair order number "22047" throughout; 22047 falls inside the VA ZIP range,
// so the market preview stage extracted it as the owner ZIP and set state VA
// for a vehicle garaged in Devon, PA 19333. A bare 5-digit token must never be
// treated as a ZIP without address context.
const RO_22047_ESTIMATE = `
PRELIMINARY ESTIMATE
RO Number: 22047
Workfile ID: 22047
Claim #: 0587219406-01
Owner: MARGARET SULLIVAN
Address: 214 WATERLOO RD
DEVON, PA 19333
Insured: MARGARET SULLIVAN
2021 SUBARU Outback Limited
VIN: 4S4BTANC5M3181077
Mileage: 41,882

Repair Facility: MAIN LINE COLLISION CENTER
RO 22047 printed on each page footer
Page 2 of 9 - RO 22047
Page 3 of 9 - RO 22047
`;

describe("selectOwnerOrInsuredZip", () => {
  it("does not treat a plausible-ZIP RO number as the owner ZIP (RO 22047 regression)", () => {
    const zip = selectOwnerOrInsuredZip(RO_22047_ESTIMATE);
    expect(zip).toBe("19333");
    expect(zip).not.toBe("22047");
  });

  it("resolves the owner state from the address ZIP, not the RO number (PA, not VA)", () => {
    const zip = selectOwnerOrInsuredZip(RO_22047_ESTIMATE);
    expect(extractMarketPreviewState(RO_22047_ESTIMATE, zip)).toBe("PA");
  });

  it("returns undefined when the only 5-digit tokens are bare identifiers", () => {
    const text = `
ESTIMATE OF RECORD
RO Number: 22047
Claim: 44123
2019 HONDA ACCORD SPORT
Mileage: 38,102
`;
    expect(selectOwnerOrInsuredZip(text)).toBeUndefined();
  });

  it("accepts a ZIP adjacent to a state abbreviation without an address label", () => {
    const text = `
Owner: JOHN DOE
DEVON, PA 19333
`;
    expect(selectOwnerOrInsuredZip(text)).toBe("19333");
  });

  it("accepts a ZIP on a labeled address line", () => {
    const text = `
Owner: JANE ROE
Address: 88 LANCASTER AVE 19301
`;
    expect(selectOwnerOrInsuredZip(text)).toBe("19301");
  });

  it("rejects a bare 5-digit token with no address context even if it is a valid ZIP", () => {
    const text = `
Invoice 19333
Total labor units 22047
`;
    expect(selectOwnerOrInsuredZip(text)).toBeUndefined();
  });

  it("still accepts the RO-number value when it genuinely appears as a city/state/ZIP", () => {
    // If the same digits appear both as an RO number and directly after a
    // state abbreviation, the state-adjacent occurrence is real address
    // evidence and should win.
    const text = `
RO Number: 22047
Owner: SAM SMITH
ARLINGTON, VA 22047
`;
    expect(selectOwnerOrInsuredZip(text)).toBe("22047");
  });

  it("prefers the owner ZIP over the repair facility ZIP", () => {
    const text = `
Owner: ALEX MORGAN
DEVON, PA 19333
Repair Facility: TYSONS AUTO BODY
VIENNA, VA 22182
`;
    expect(selectOwnerOrInsuredZip(text)).toBe("19333");
  });
});

describe("extractMarketPreviewState", () => {
  it("falls back to a city/state/ZIP pattern when no ZIP was selected", () => {
    expect(extractMarketPreviewState("Devon, PA 19333", undefined)).toBe("PA");
  });

  it("returns undefined when there is no location evidence", () => {
    expect(extractMarketPreviewState("RO Number: 22047", undefined)).toBeUndefined();
  });
});

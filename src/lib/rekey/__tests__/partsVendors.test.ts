import { describe, expect, it } from "vitest";
import { harvestPartsVendors } from "../partsVendors";
import { buildRekeySheet } from "../rekeyLedger";
import { SOURCE_ESTIMATE_TEXT } from "./fixtures";

/** Layout A: a table whose vendor column follows the part number. */
const TABLE_LAYOUT = `PARTS VENDORS
Line Description Part No. Vendor
32 Grille FO1200600C EXAMPLE AFTERMARKET SUPPLY, NJ
79 Front Sensor FO1500900 EXAMPLE RECYCLERS, PA

ESTIMATE TOTALS
Parts 1,306.50
`;

/** Layout B: parts listed under a vendor heading. */
const GROUPED_LAYOUT = `PARTS VENDORS
EXAMPLE AFTERMARKET SUPPLY, NJ
Phone: 800-555-0100
32 Grille FO1200600C
EXAMPLE RECYCLERS, PA
Phone: 800-555-0199
79 Front Sensor FO1500900

ESTIMATE TOTALS
Parts 1,306.50
`;

describe("parts-vendors harvest", () => {
  it("reads a vendor from the column that follows the part number", () => {
    const index = harvestPartsVendors(TABLE_LAYOUT);
    expect(index.byPartNumber.get("FO1200600C")).toBe("EXAMPLE AFTERMARKET SUPPLY, NJ");
    expect(index.byPartNumber.get("FO1500900")).toBe("EXAMPLE RECYCLERS, PA");
  });

  it("reads a vendor from the heading a grouped list sits under", () => {
    const index = harvestPartsVendors(GROUPED_LAYOUT);
    expect(index.byPartNumber.get("FO1200600C")).toBe("EXAMPLE AFTERMARKET SUPPLY, NJ");
    expect(index.byPartNumber.get("FO1500900")).toBe("EXAMPLE RECYCLERS, PA");
  });

  it("never reads the column header row as a vendor", () => {
    const vendors = [...harvestPartsVendors(TABLE_LAYOUT).byPartNumber.values()];
    expect(vendors.some((vendor) => /description|part no/i.test(vendor))).toBe(false);
  });

  it("keeps the region verbatim so an attachment can be checked", () => {
    const index = harvestPartsVendors(TABLE_LAYOUT);
    expect(index.lines[0]).toBe("PARTS VENDORS");
    expect(index.lines.join("\n")).toContain("EXAMPLE RECYCLERS, PA");
    expect(index.lines.join("\n")).not.toContain("ESTIMATE TOTALS");
  });

  it("never attaches a vendor to a real estimate line caught inside the region", () => {
    // A vendors region whose end is not printed runs on into real line items.
    // Those lines bill hours and money; the last-seen supplier must not be
    // hung on them.
    const overrun = `PARTS VENDORS
EXAMPLE AFTERMARKET SUPPLY, NJ
32 Grille FO1200600C
QUARTER PANEL
40 Repl Quarter Panel FO1900800 1 1,240.00 6.5 3.2
`;
    const index = harvestPartsVendors(overrun);
    expect(index.byPartNumber.get("FO1200600C")).toBe("EXAMPLE AFTERMARKET SUPPLY, NJ");
    expect(index.byPartNumber.has("FO1900800")).toBe(false);
  });

  it("returns nothing at all for a document with no vendors page", () => {
    const index = harvestPartsVendors("HOOD\n1 Repl Hood FO1230344C 1 776.00 1.6\n");
    expect(index.lines).toEqual([]);
    expect(index.byPartNumber.size).toBe(0);
  });
});

describe("vendor attachment on the sheet", () => {
  const withVendors = SOURCE_ESTIMATE_TEXT.replace(
    "\nESTIMATE TOTALS",
    `\nPARTS VENDORS
Line Description Part No. Vendor
32 Grille FO1200600C EXAMPLE AFTERMARKET SUPPLY, NJ
79 Front Sensor FO1500900 EXAMPLE RECYCLERS, PA

ESTIMATE TOTALS`
  );

  it("attaches a vendor only on an exact part-number join", () => {
    const sheet = buildRekeySheet({ text: withVendors, sourceFile: "source.pdf" });
    const grille = sheet.rows.find((row) => row.partNumber === "FO1200600C");
    const hood = sheet.rows.find((row) => row.partNumber === "FO1230344C");
    expect(grille?.vendor).toBe("EXAMPLE AFTERMARKET SUPPLY, NJ");
    // The hood is not named on the vendors page, so it gets no vendor rather
    // than the nearest one.
    expect(hood?.vendor).toBeNull();
    expect(sheet.stats.vendorsAttached).toBe(2);
  });

  it("does not turn a vendors listing into a second keying row", () => {
    const sheet = buildRekeySheet({ text: withVendors, sourceFile: "source.pdf" });
    const grilleRows = sheet.rows.filter((row) => row.partNumber === "FO1200600C");
    const sensorRows = sheet.rows.filter((row) => row.partNumber === "FO1500900");
    expect(grilleRows).toHaveLength(1);
    expect(sensorRows).toHaveLength(1);
    // The surviving row is the priced estimate line, not the listing.
    expect(grilleRows[0].price).toBe(210.5);
    expect(grilleRows[0].supplementTag).toBe("S2");
  });

  it("reproduces the vendors page on the sheet", () => {
    const sheet = buildRekeySheet({ text: withVendors, sourceFile: "source.pdf" });
    expect(sheet.partsVendorsBlock.join("\n")).toContain("EXAMPLE RECYCLERS, PA");
  });

  it("says which non-OEM lines still need a vendor when the page names none", () => {
    const sheet = buildRekeySheet({ text: SOURCE_ESTIMATE_TEXT, sourceFile: "source.pdf" });
    expect(sheet.stats.vendorsAttached).toBe(0);
    expect(sheet.warnings.join(" ")).toMatch(/no parts-vendors page/i);
  });

  it("does not warn when every non-OEM line already carries a vendor", () => {
    const sheet = buildRekeySheet({ text: withVendors, sourceFile: "source.pdf" });
    expect(sheet.warnings.join(" ")).not.toMatch(/vendor/i);
  });
});

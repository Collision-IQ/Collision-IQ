import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assessRekeySheet, buildRekeySheet, isClearCoatAllowance } from "../rekeyLedger";
import {
  parseMitchellEstimateRows,
  parseMitchellEstimateTotals,
  readMitchellEstimate,
  readMitchellVehicle,
} from "../mitchellEstimateReader";
import {
  compareRekeyFields,
  explainDocumentIsNotVerification,
  keyedEstimateFromEms,
  verifyRekey,
  type KeyedEstimate,
  type KeyedLine,
} from "../rekeyVerification";
import { readEmsBundle } from "../emsReader";
import { buildRekeySheetText } from "../rekeyReportBuilder";
import { buildEmsExportFiles } from "./emsFixture";
import { SOURCE_ESTIMATE_TEXT } from "./fixtures";
import { readClaimIdentity } from "@/lib/reports/claimIdentityGate";
import type { RekeyLedgerRow } from "../rekeyTypes";

/**
 * Named regression rules from the RK-T2 accuracy review.
 *
 * The RK-T2 source PDF was not supplied with the review, so the fixture is
 * SYNTHETIC: it reproduces every shape the review's ledger proved the print
 * carries — a fourth labor type ("Glass"), OEM part numbers printed as
 * spaced groups, coded note rows, a section heading printed inside a note
 * block, a page footer whose profile name matches no furniture pattern, a
 * loss date ahead of the vehicle line, a sand-and-buff line that names the
 * clear coat, taxed and untaxed sublet-type lines, and an "Other Additional
 * Costs" line — with totals that close to the cent, so every rule below is
 * checked against arithmetic rather than against a reading.
 *
 * The real-document check is the F-RK2 fixture in rekeyRegressionRules.test.
 */
const TEXT = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk3-mitchell-shapes.txt"), "utf8");
const sheet = buildRekeySheet({ text: TEXT, sourceFile: "frk3.pdf" });
const row = (line: number) => sheet.rows.find((candidate) => candidate.sourceLine === line);

const hours = (type: string) =>
  Math.round(
    sheet.rows
      .flatMap((candidate) => candidate.labor)
      .filter((entry) => entry.type === type && !entry.included)
      .reduce((total, entry) => total + entry.hours, 0) * 10
  ) / 10;

describe("RK-01 — every labor type the print names, not a fixed three", () => {
  it("bills glass hours against the glass category", () => {
    // Windshield, back window and quarter glass were reaching the sheet with
    // no hours at all, and the "Glass Labor" totals row was never read — so
    // the two sides agreed with each other and both were short 3.8 h.
    expect(row(3)?.labor).toEqual([{ type: "LAG", hours: 1.5, included: false, judgment: true }]);
    expect(hours("LAG")).toBe(3.8);
    expect(hours("LAB")).toBe(19.7);
    expect(hours("LAR")).toBe(7.6);
    expect(hours("LAM")).toBe(0.8);
  });

  it("reads the glass category and its rate off the totals page", () => {
    const glass = sheet.expectedTotals?.categories.find((entry) => entry.category === "Glass Labor");
    expect(glass).toMatchObject({ hours: 3.8, rate: 61, cost: 231.8 });
    expect(sheet.profile.find((field) => /glass labor rate/i.test(field.field))?.value).toBe(61);
  });

  it("does not read the Total Labor row as a labor category", () => {
    expect(sheet.expectedTotals?.categories.some((entry) => /total/i.test(entry.category))).toBe(false);
  });
});

describe("RK-02 — the sheet's rows reproduce the printed totals", () => {
  it("closes every checked category", () => {
    expect(sheet.reconciliation.failures).toEqual([]);
    expect(sheet.reconciliation.closes).toBe(true);
    expect(sheet.reconciliation.rows.every((entry) => entry.closes)).toBe(true);
  });

  it("derives parts, labor sublet and other costs from the rows", () => {
    const find = (category: string) => sheet.reconciliation.rows.find((entry) => entry.category === category);
    expect(find("Parts")).toMatchObject({ printed: 2047.36, derived: 2047.36 });
    expect(find("Body Labor sublet / additional")).toMatchObject({ printed: 21, derived: 21 });
    expect(find("Other additional costs")).toMatchObject({ printed: 4, derived: 4 });
  });

  it("passes the quality gate", () => {
    expect(assessRekeySheet(sheet)).toEqual({ ok: true, reason: null });
  });

  it("reads a category label that wrapped ahead of its values", () => {
    const totals = parseMitchellEstimateTotals(TEXT);
    expect(totals?.categories.find((entry) => entry.category === "Other Additional Costs")?.cost).toBe(4);
    expect(totals?.categories.find((entry) => entry.category === "Body Labor")?.extra).toBe(21);
  });
});

describe("RK-03 — the Number / Qty / Price / Tax band", () => {
  it("reads a part number printed as spaced groups, and its price", () => {
    // Every part number AND every price on the RK-T2 sheet was lost against a
    // printed parts total of $2,047.36, because the reader required the
    // number to be one unbroken token and stopped at the first group.
    expect(row(8)).toMatchObject({ partNumber: "4K0809999A", partNumberSource: "4K0 809 999 A", qty: 1, price: 212.55 });
    expect(row(9)).toMatchObject({ partNumber: "4K0853855BGRU", qty: 1, price: 252 });
    expect(row(14)).toMatchObject({
      partNumber: "4K0807511AGRU",
      partNumberSource: "4K0 807 511 A GRU",
      qty: 1,
      price: 1570.81,
      taxable: true,
      partTypeCcc: "OEM",
    });
  });

  it("flags a quantity welded onto the number as a short flag, not a note", () => {
    expect(row(14)?.flags).toContain("qty welded: verify");
    expect(row(14)?.notes.join(" ")).not.toMatch(/printed together/);
  });

  it("does not print a $0.00 price on a scan line billed as hours", () => {
    expect(row(19)).toMatchObject({ price: null, misc: null });
    expect(row(19)?.labor).toEqual([{ type: "LAM", hours: 0.5, included: false, judgment: true }]);
  });
});

describe("RS-21 — taxed sublet dollars are parts", () => {
  it("keys a taxed sublet-type line as a Sublet part with the CIECA code", () => {
    expect(row(23)).toMatchObject({ partTypeCcc: "Sublet", partTypeEms: "PAS", price: 12, misc: null, taxable: true });
    expect(row(23)?.flags).toContain("sublet part");
  });

  it("books an untaxed sublet-type line to the labor category it bills", () => {
    expect(row(21)?.misc).toMatchObject({ amount: 15, sublet: true, taxable: null });
    expect(row(21)?.price).toBeNull();
    expect(row(21)?.labor[0]).toMatchObject({ type: "LAB", hours: 0.2 });
  });
});

describe("RK-05 — notes are never keyed", () => {
  it("attaches a coded note to the row above it and writes no row for it", () => {
    expect(row(4)).toBeUndefined();
    expect(row(20)).toBeUndefined();
    expect(row(3)?.notes).toEqual(["Mask for primer"]);
    expect(row(19)?.notes).toContain("Reconcile with invoice");
  });

  it("never reports a note row followed by the page footer as a lost line", () => {
    // A real estimate printed "47 900501 Mask for refinish" as the last row
    // of a page. The text scan joined the footer onto it and read "Mitchell
    // Estimating 25.2" as hours, so a note was reported as a lost line and
    // the sheet was refused in production.
    const withNote = buildRekeySheet({
      text: TEXT.replace("Glass0.8Existing\n LABOR  PART", "Glass0.8Existing\n25900501Mask for refinish\n LABOR  PART"),
      sourceFile: "frk3.pdf",
    });
    expect(withNote.reconciliation.unreadLines).toEqual([]);
    expect(withNote.reconciliation.closes).toBe(true);
    expect(withNote.rows.find((candidate) => candidate.sourceLine === 12)?.notes).toContain("Mask for refinish");
  });

  it("recovers a section heading printed inside a note block", () => {
    expect(row(21)?.sectionSource).toBe("Special / Manual Entry");
    expect(row(21)?.sectionCcc).toBe("MISCELLANEOUS OPERATIONS");
    expect(row(19)?.descriptionCcc).not.toMatch(/Special/);
  });
});

describe("RK-10 — the footer is cut before anchors and sections", () => {
  it("never reads the profile name as a section", () => {
    expect(sheet.rows.some((candidate) => /all part types/i.test(candidate.sectionSource ?? ""))).toBe(false);
    expect(row(13)?.sectionSource).toBe("Rear Bumper");
    expect(row(12)?.sectionSource).toBe("Quarter Glass");
  });
});

describe("RK-11 — the vehicle line comes from the header block", () => {
  it("takes the line above Exterior Color", () => {
    expect(readMitchellVehicle(TEXT)).toMatch(/^2016 Audi A6/);
    expect(sheet.identity.vehicle).toMatch(/^2016 Audi A6/);
  });

  it("never matches the year of a loss date in the shared identity reader", () => {
    const identity = readClaimIdentity(
      "Printed On\n7/1/2025\nLoss Date\n06/25/2025\nInspection Site\nSome Shop\n2016 Audi A6 Premium\nExterior Color\n"
    );
    expect(identity.vehicle).toMatch(/^2016 AUDI A6/);
  });
});

describe("RK-12 — clear-coat classifier", () => {
  it("excludes sand-and-buff lines that merely name the clear coat", () => {
    expect(isClearCoatAllowance("Buff and cut clear coat")).toBe(false);
    expect(isClearCoatAllowance("Sand and polish clear coat")).toBe(false);
    expect(isClearCoatAllowance("Clear Coat")).toBe(true);
    expect(isClearCoatAllowance("Add for Clear Coat")).toBe(true);
  });

  it("annotates the one aggregate allowance with the one-line wording", () => {
    expect(row(11)?.flags).not.toContain("manual refinish");
    expect(row(11)?.labor).toEqual([{ type: "LAR", hours: 1, included: false, judgment: true }]);
    expect(row(18)?.flags).toContain("manual refinish");
    expect(row(18)?.notes.join(" ")).toMatch(/key it as ONE line/);
    expect(row(18)?.notes.join(" ")).not.toMatch(/per panel/);
  });
});

describe("RS-19 — section vocabulary", () => {
  it("maps the sections the RK-T2 print used", () => {
    expect(row(7)?.sectionCcc).toBe("QUARTER PANEL");
    expect(row(12)?.sectionCcc).toBe("QUARTER PANEL");
    expect(row(6)?.sectionCcc).toBe("REAR BODY & FLOOR");
    expect(row(3)?.sectionCcc).toBe("GLASS");
    expect(row(1)?.sectionCcc).toBe("WHEELS");
    expect(sheet.stats.unmappedSections).toBe(0);
  });
});

describe("RK-09 — a lost line fails the sheet", () => {
  const broken = buildRekeySheet({
    text: TEXT.replace("24900500Mask JambsAdditional\nLabor\nBody*0.5*Existing", "24900500Mask JambsFrobnicate1$9.00Yes"),
    sourceFile: "frk3.pdf",
  });

  it("refuses the sheet when the lost line leaves a category open", () => {
    expect(broken.reconciliation.closes).toBe(false);
    expect(broken.reconciliation.totalsClose).toBe(false);
    expect(broken.reconciliation.unreadLines).toEqual([24]);
    expect(broken.reconciliation.failures.join(" ")).toMatch(/line 24/);
    const quality = assessRekeySheet(broken);
    expect(quality.ok).toBe(false);
    expect(quality.reason).toMatch(/Body Labor hours/);
  });

  it("headlines, rather than refuses, a lost line the totals do not miss", () => {
    // A zero-value line the reader cannot place leaves every total closed:
    // the rows are proven, the loss is not, so the sheet is delivered with
    // the lost line as its first line. A real CCC print was refused over
    // exactly this the day the gate shipped.
    const zero = buildRekeySheet({
      text: TEXT.replace("Special / Manual Entry\n", "Special / Manual Entry\n25900500Mystery lineFrobnicate1$0.00\n"),
      sourceFile: "frk3.pdf",
    });
    expect(zero.reconciliation.totalsClose).toBe(true);
    expect(zero.reconciliation.closes).toBe(false);
    expect(zero.reconciliation.unreadLines).toEqual([25]);
    expect(assessRekeySheet(zero).ok).toBe(true);
    expect(buildRekeySheetText(zero).split("\n").slice(0, 6).join("\n")).toMatch(/INCOMPLETE — 1 PRINTED LINE NOT READ \(LINE 25\)/);
  });
});

describe("RS-17 — a row with no known operation is anchored on its labor type", () => {
  const rows = parseMitchellEstimateRows(
    "Front Bumper\n1AUTOFrt Bumper CoverFrobnicateBody0.5Existing\nHood\n2AUTOHood PanelRepairBody1.0Existing\n"
  );

  it("keeps the row, its hours and the heading printed after it", () => {
    expect(rows.map((candidate) => candidate.lineNumber)).toEqual([1, 2]);
    expect(rows[0].labor).toBe(0.5);
    expect(rows[0].description).toMatch(/Frobnicate/);
    expect(rows[1].section).toBe("Hood");
  });

  it("reports a row it truly cannot read instead of dropping it silently", () => {
    const read = readMitchellEstimate("Hood\n1AUTOHood PanelFrobnicate1$9.00Yes\n2AUTOHood PanelRepairBody1.0Existing\n");
    expect(read.unreadable).toEqual([1]);
    expect(read.rows.map((candidate) => candidate.lineNumber)).toEqual([2]);
  });
});

describe("RV-10 — no findings where only one side made a claim", () => {
  const base: RekeyLedgerRow = {
    id: "row-1",
    sourceLine: 1,
    supplementTag: null,
    sectionSource: "Additional Operations",
    sectionCcc: "MISCELLANEOUS OPERATIONS",
    sectionMapped: true,
    descriptionSource: "Pre Repair Scan",
    descriptionCcc: "Pre Repair Scan",
    operationSource: "Additional Operation",
    operationCcc: "Manual",
    operationMapped: true,
    laborOpCode: "OP0",
    partTypeSource: null,
    partTypeCcc: "None",
    partTypeEms: null,
    partNumber: null,
    partNumberSource: null,
    vendor: null,
    qty: null,
    price: null,
    taxable: null,
    labor: [{ type: "LAM", hours: 0.5, included: false, judgment: false }],
    misc: null,
    notes: [],
    keyable: true,
    flags: [],
  };
  const keyed: KeyedLine = {
    id: "ems-1",
    lineNumber: 1,
    description: "Pre Repair Scan",
    partNumber: null,
    partType: null,
    qty: 1,
    price: null,
    labor: [{ type: "LAM", hours: 0.5, included: false }],
    misc: null,
    group: null,
    operation: "Subl",
  };

  it("treats a keyed quantity of 1 against an unprinted quantity as the platform default", () => {
    expect(compareRekeyFields(base, keyed).map((delta) => delta.field)).toEqual([]);
  });

  it("does not report the operation a manual source line was keyed under", () => {
    expect(compareRekeyFields(base, { ...keyed, operation: "Repl" }).some((delta) => delta.field === "operation")).toBe(false);
  });

  it("still reports a real quantity or operation difference", () => {
    expect(compareRekeyFields({ ...base, qty: 2 }, keyed).some((delta) => delta.field === "quantity")).toBe(true);
    expect(
      compareRekeyFields({ ...base, operationCcc: "Rpr" }, { ...keyed, operation: "Repl" }).some(
        (delta) => delta.field === "operation"
      )
    ).toBe(true);
  });
});

describe("RV-9 — the claim number is compared, or its absence is stated", () => {
  // The shared fixture's claim has too few digits to qualify as a claim
  // number under the identity gate's shape rule; give the source one that does.
  const source = buildRekeySheet({
    text: SOURCE_ESTIMATE_TEXT.replace("Claim #: TESTCLAIM0001", "Claim #: 25-000000000-01"),
    sourceFile: "source.pdf",
  });
  expect(source.identity.claimNumber).toBe("25-000000000-01");
  const keyedWith = (claimNumber: string | null): KeyedEstimate => ({
    origin: "ems",
    sourceFile: "export.zip",
    estimatingSystem: "C",
    vin: source.identity.vin,
    claimNumber,
    lines: [],
    totals: { categories: [], tax: null, grandTotal: null },
    profile: null,
    notes: [],
  });

  it("says when the keyed side prints no claim number", () => {
    const verification = verifyRekey({ sheet: source, keyed: keyedWith(null) });
    expect(verification.identity.verdict).toBe("match");
    expect(verification.identity.detail).toMatch(/prints no claim number/);
  });

  it("flags a claim disagreement the VIN would otherwise hide", () => {
    const verification = verifyRekey({ sheet: source, keyed: keyedWith("99-999999999-01") });
    expect(verification.identity.verdict).toBe("match");
    expect(verification.notes.join(" ")).toMatch(/claim numbers differ/);
  });

  it("confirms an agreeing claim", () => {
    const verification = verifyRekey({ sheet: source, keyed: keyedWith("25-000000000-01") });
    expect(verification.identity.detail).toMatch(/agrees/);
  });
});

describe("RV-7 — verification takes an EMS export of a CCC workfile, nothing else", () => {
  it("explains why a second estimate document is not run through verification", () => {
    expect(explainDocumentIsNotVerification({ keyedText: SOURCE_ESTIMATE_TEXT })).toMatch(/Estimate Delta/);
    expect(explainDocumentIsNotVerification({ keyedText: TEXT })).toMatch(/Mitchell estimate/);
  });

  it("refuses an export written by another estimating system", () => {
    const keyed = keyedEstimateFromEms(readEmsBundle(buildEmsExportFiles({ estimatingSystem: "M" })), "export.zip");
    expect(keyed.ok).toBe(false);
    if (!keyed.ok) expect(keyed.reason).toMatch(/not CCC ONE/);
  });

  it("accepts the code a real CCC export writes", () => {
    const keyed = keyedEstimateFromEms(readEmsBundle(buildEmsExportFiles()), "export.zip");
    expect(keyed.ok).toBe(true);
  });
});

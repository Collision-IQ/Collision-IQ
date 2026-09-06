import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { normalizeEmsEstimate, readEmsBundle } from "../emsReader";
import { keyedEstimateFromEms, totalsCategoryCode, verifyRekey } from "../rekeyVerification";

/**
 * Which EMS subtotal answers for a printed totals category.
 *
 * "Parts Adjustments" reached the parts code by PREFIX — it starts with the
 * word "Parts" — so one keyed figure answered two source rows: the source's
 * parts total AND its markup were both reported against the export's
 * $11,926.97, and neither comparison meant anything.
 *
 * The export's own arithmetic is the evidence for the rest. In both real
 * exports in this repository, PAT = PAN + PAO + PAS, LAT = LAB + LAR, and
 * MAT = MAPA + MA2S + MABL — so those three codes are roll-ups of figures
 * the table already compares one by one.
 */
describe("a category is mapped by its own name, not by the word it starts with", () => {
  it("does not send a parts markup to the parts total", () => {
    expect(totalsCategoryCode("Parts Adjustments")).toMatchObject({ code: "PARTS ADJUSTMENTS", comparable: false });
    expect(totalsCategoryCode("Parts")).toMatchObject({ code: "PAT", comparable: true });
    expect(totalsCategoryCode("Taxable Parts")).toMatchObject({ code: "PAT" });
  });

  it("keeps a name it does not know rather than guessing from its first word", () => {
    // There is no prefix fallback any more: an unknown name is a stated gap,
    // not a comparison against whatever category it happens to begin with.
    expect(totalsCategoryCode("Parts Handling Charge")).toMatchObject({
      code: "PARTS HANDLING CHARGE",
      label: "Parts Handling Charge",
    });
    expect(totalsCategoryCode("Body Supplies Surcharge").code).toBe("BODY SUPPLIES SURCHARGE");
  });

  it("says why the markup has nothing to compare against", () => {
    expect(totalsCategoryCode("Parts Adjustments").note).toMatch(/markup per line rather than as a subtotal/);
  });

  it("keeps every other category mapping it had", () => {
    expect(totalsCategoryCode("Body Labor")).toMatchObject({ code: "LAB", unit: "hours" });
    expect(totalsCategoryCode("Refinish Labor")).toMatchObject({ code: "LAR", unit: "hours" });
    expect(totalsCategoryCode("Paint Materials")).toMatchObject({ code: "MAPA", unit: "amount" });
    expect(totalsCategoryCode("Sublet")).toMatchObject({ code: "PAS", unit: "amount" });
  });
});

describe("the export's roll-ups are named as roll-ups", () => {
  const estimate = normalizeEmsEstimate(
    readEmsBundle(
      fs
        .readdirSync(path.join(process.cwd(), "tests/fixtures/ems-rk1a"))
        .map((name) => ({
          filename: name,
          bytes: new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ems-rk1a", name))),
        }))
    )
  );
  const amount = (code: string) => estimate.subtotals.find((entry) => entry.code === code)?.amount ?? null;

  it("is arithmetic, not an assumption: PAT is the sum of its parts", () => {
    expect(amount("PAT")).toBe(11926.97);
    expect((amount("PAN") ?? 0) + (amount("PAO") ?? 0) + (amount("PAS") ?? 0)).toBeCloseTo(amount("PAT") ?? 0, 2);
    expect((amount("LAB") ?? 0) + (amount("LAR") ?? 0)).toBeCloseTo(amount("LAT") ?? 0, 2);
    expect((amount("MAPA") ?? 0) + (amount("MA2S") ?? 0) + (amount("MABL") ?? 0)).toBeCloseTo(amount("MAT") ?? 0, 2);
  });
});

describe("the totals table on the real pair", () => {
  const sheet = buildRekeySheet({
    text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk1b-mitchell-text.txt"), "utf8"),
    sourceFile: "frk1b.pdf",
  });
  const dir = path.join(process.cwd(), "tests/fixtures/ems-rk1a");
  const keyed = keyedEstimateFromEms(
    readEmsBundle(
      fs.readdirSync(dir).map((name) => ({ filename: name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }))
    ),
    "ab7f6e93.zip"
  );
  if (!keyed.ok) throw new Error(keyed.reason);
  const verification = verifyRekey({ sheet, keyed: keyed.estimate });
  const row = (code: string) => verification.totals.find((entry) => entry.code === code);

  it("no longer answers two source rows with one keyed figure", () => {
    expect(verification.totals.filter((entry) => entry.code === "PAT")).toHaveLength(1);
    expect(row("PAT")).toMatchObject({ source: 6594.49, keyed: 11926.97 });
    expect(row("PARTS ADJUSTMENTS")).toMatchObject({ source: 0, keyed: null, comparable: false });
  });

  it("warns that the parts total it compares against includes sublet", () => {
    // The sublet row reports those same dollars, so a reader adding the two
    // differences together would count them twice without this.
    expect(row("PAT")?.note).toMatch(/rolls up new, other and SUBLET parts/);
    expect(row("PAS")?.comparable).toBe(true);
  });

  it("names the export's roll-ups instead of printing bare codes", () => {
    expect(row("LAT")).toMatchObject({ label: "Labor total", comparable: false });
    expect(row("MAT")).toMatchObject({ label: "Materials total", comparable: false });
    expect(row("PAN")?.label).toBe("New parts");
    expect(row("LAT")?.note).toMatch(/roll-up of LAB, LAR, LAM/);
  });
});

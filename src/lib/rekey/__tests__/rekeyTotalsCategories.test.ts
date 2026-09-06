import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { normalizeEmsEstimate, readEmsBundle } from "../emsReader";
import { keyedEstimateFromEms, totalsCategoryCode, verifyRekey } from "../rekeyVerification";
import VOCABULARY from "../data/rekeyVocabulary.json";

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
    expect(totalsCategoryCode("Paint Materials")).toMatchObject({ code: "MAT", unit: "amount" });
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

describe("EMS subtotal codes are named from evidence, or not named", () => {
  it("names MASH from the reference implementation, which spells it out", () => {
    // docs/reference/wo-rk1/ems.py writes the materials profile as
    // ("MASH", "Shop", ...) beside ("MAPA", "Paint", ...) — the packet's own
    // naming, not an expansion of the letters.
    expect(totalsCategoryCode("Shop Materials")).toMatchObject({ code: "MASH", label: "Shop materials" });
    expect(totalsCategoryCode("Shop Supplies").code).toBe("MASH");
  });

  it("names the cost codes the reference packet writes by name", () => {
    // ems.py writes TTL_TYPE "OTAC" with the estimate's other costs, and the
    // profile table declares TX_TOW_TY "OTTW" and TX_STOR_TY "OTST".
    expect(totalsCategoryCode("Other Additional Costs").code).toBe("OTAC");
    expect(totalsCategoryCode("Storage").code).toBe("OTST");
    expect(totalsCategoryCode("Towing").code).toBe("OTTW");
  });

  it("says on the row where a code's expansion is read rather than documented", () => {
    const source = (VOCABULARY.totalsCategories as Array<{ ems: string; note?: string }>).find(
      (entry) => entry.ems === "MA2S"
    );
    expect(source?.note).toMatch(/read from the code family/);
  });

  it("does not name UPD, because nothing here says what it is", () => {
    const source = (VOCABULARY.totalsCategories as Array<{ ems: string; label: string; note?: string }>).find(
      (entry) => entry.ems === "UPD"
    );
    expect(source?.label).toBe("UPD");
    expect(source?.note).toMatch(/no evidence for what it means/);
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

  it("compares the shop-materials line both sides carry", () => {
    // The source prints "Shop Materials $0.00" and the export carries MASH at
    // $0.00 over 2.8 units. They were never connected, because the vocabulary
    // carried a "SHOP" code that no export writes.
    expect(row("MASH")).toMatchObject({ source: 0, keyed: 0, comparable: true, matches: true });
    expect(verification.totals.some((entry) => entry.code === "SHOP")).toBe(false);
  });

  it("counts the shop-materials line in the materials roll-up", () => {
    // MAT hours are 24.5 = 17.6 MAPA + 2.8 MASH + 2.0 MA2S + 2.1 MABL, and the
    // second export agrees: 19.1 = 12.6 + 1.8 + 1.1 + 3.6. Leaving MASH out
    // named the roll-up as the sum of three of its four parts. The printed
    // materials line answers to that total, so the shop-materials stage the
    // page states on its own line is netted out of the comparison rather than
    // counted on two rows.
    expect(row("MAT")).toMatchObject({ label: "Paint Materials", source: 701.4, keyed: 1302 });
    expect(row("MAT")?.note).toMatch(/less MASH, which this page states on lines of their own/);
    expect(row("MASH")).toMatchObject({ source: 0, keyed: 0, matches: true });
  });

  it("names the export's roll-ups instead of printing bare codes", () => {
    expect(row("LAT")).toMatchObject({ label: "Labor total", comparable: false });
    expect(row("MAPA")).toMatchObject({ label: "Paint materials", source: null, comparable: false });
    expect(row("PAN")?.label).toBe("New parts");
    expect(row("LAT")?.note).toMatch(/roll-up of LAB, LAR, LAM/);
  });
});

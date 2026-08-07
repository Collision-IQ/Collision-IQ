/**
 * THE HEADER BLOCK IS NOT SCOPE, AND A PHONE NUMBER IS NOT MONEY.
 *
 * CCC numbers its preamble — "For Supplements Use CCC", "Estimate Share -
 * Questions", "Non CCC Users Contact", "APPRAISER: <email> / <phone>" — in the
 * same sequence as line items. Both lanes parsed them as rows and reported
 * them as work one estimate carried and the other omitted. Worse, the column
 * parser found decimals inside a telephone number:
 *
 *   raw     "4#Call CCC   800.637.851110.000.00.0"
 *   parsed  description "Call CCC 800.63 7.85", price $110.00
 *
 * A fabricated dollar amount, presented as a line the shop failed to write, in
 * a report whose entire claim is evidence integrity.
 *
 * WHAT THE CORPUS REJECTED. The obvious rule — "priced, no operation code, no
 * time, therefore not real" — matches 73 rows across the eight corpus
 * documents, and most are genuine: BetaSeal urethane at $37, hazardous waste
 * at $5, "Additional paint and material" at $928.30. Those are exactly the
 * materials omissions this report exists to surface. So the rule is confined
 * to the preamble, above the first operation-coded row, where the corpus
 * contains no real line of that shape.
 *
 * The second rejected rule was "drop everything above the first operation
 * row": RO 22059 writes L9 "Rpl information labels", a real replace whose op
 * code the vocabulary spells "Repl". Requiring zero labor AND zero paint time
 * keeps it — boilerplate bills no hours.
 */
import { describe, it, expect } from "vitest";
import {
  isContactInformationRow,
  startsWithRepairOperation,
} from "../deltaEngine/estimateNormalize";
import { parseCccEstimateRows } from "../estimateDeltaMatcher";

/**
 * A DISCARD RULE MUST NOT MISS AN OPERATION.
 *
 * The first version of the preamble rule kept a row only if it billed time,
 * and that deleted "Rpl Emblem Incl." — a genuine replace billing no hours
 * because it is included in an adjacent operation, spelled "Rpl" rather than
 * the "Repl" the strict OP_CODES list carries. Both halves read as boilerplate
 * to a rule that only knows hours, so real scope vanished silently. Every
 * corpus document carries such zero-value "Incl." operations (53 in total);
 * none sat in the preamble region, so the corpus never caught it.
 *
 * The operation test is therefore deliberately LENIENT, and separate from the
 * matching vocabulary: it errs toward keeping, because the cost of a miss is a
 * deleted finding.
 */
describe("the operation test used by discard rules is lenient", () => {
  it("accepts the spellings and glue this corpus actually prints", () => {
    for (const line of [
      "2 Rpl Emblem Incl.", // "Rpl", not "Repl"
      "12 ReplRT Fender", // glued position marker — 54 occurrences
      "7 R&IRT headlamp assy", // 79 occurrences
      "3 Repl Bumper cover 1,308.00 2.6",
      "4 REPL FENDER", // ALL-CAPS extraction
      "18 Subl 4 Wheel Alignment",
    ]) {
      expect(startsWithRepairOperation(line)).toBe(true);
    }
  });

  it("still rejects prose that merely starts like an operation", () => {
    // A lowercase continuation is not an op code.
    for (const line of [
      "5 Repair shop notes follow",
      "9 Additional charges apply",
      "1#Non CCC Users Contact",
      "6 Estimate Share - Questions",
    ]) {
      expect(startsWithRepairOperation(line)).toBe(false);
    }
  });
});

describe("contact information is never a repair operation", () => {
  it("recognises the shapes an estimate header actually carries", () => {
    for (const line of [
      "6#APPRAISER: rob.hondros@usaa.com / 215-275-2897",
      "Phone: (610) 644-1000",
      "FAX: (610) 644-1007",
      "Adjuster: C1BU, (800) 841-3000 Business",
      "Email: geico@repairify.com",
      "All supplement requests to Supplement Hotline: 610-279-5400",
    ]) {
      expect(isContactInformationRow(line)).toBe(true);
    }
  });

  it("matches a phone GLUED to the row's column values", () => {
    // The whole point: CCC welds the columns on, so a trailing digit-boundary
    // assertion would fail exactly where the defect lives.
    expect(isContactInformationRow("4#Call CCC   800.637.851110.000.00.0")).toBe(true);
  });

  it("does not fire on money, dates, or part numbers", () => {
    for (const line of [
      "7*Repl Bumper cover 1678806106999911,308.00 Incl. 2.6",
      "12 Repl Hood 1,308.00 249.00 3.5",
      "Estimate printed 12/31/2024 10:14",
      "23 Repl RT Headlamp assy 88123-45678 902.11",
    ]) {
      expect(isContactInformationRow(line)).toBe(false);
    }
  });

  it("keeps a real operation that happens to carry a 3-3-4 identifier", () => {
    // Gated on the absence of an operation code, so the identifier survives.
    expect(isContactInformationRow("14 Repl Sensor 800.637.8511")).toBe(false);
    expect(isContactInformationRow("14 R&I Sensor 800.637.8511")).toBe(false);
  });
});

describe("the preamble never becomes scope", () => {
  const CCC_PREAMBLE = [
    "VEHICLE",
    "1#For Supplements Use CCC10.000.00.0",
    "2#Estimate Share - Questions10.000.00.0",
    "3#Call CCC   800.637.851110.000.00.0",
    "4#Non CCC Users Contact10.000.00.0",
    "FRONT BUMPER & GRILLE",
    "5 Repl Bumper cover 1,308.00 2.6",
    "6 R&I Lower grille Incl.",
  ].join("\n");

  it("drops the numbered header block and keeps the operations", () => {
    const rows = parseCccEstimateRows(CCC_PREAMBLE);
    const described = rows.map((row) => row.description ?? "");
    expect(described.some((d) => /Estimate Share|Non CCC|For Supplements|Call CCC/i.test(d))).toBe(
      false
    );
    expect(described.some((d) => /Bumper cover/i.test(d))).toBe(true);
  });

  it("never invents a price from a telephone number", () => {
    const rows = parseCccEstimateRows(CCC_PREAMBLE);
    // $110.00 came from "800.637.8511" + "10.00" running together.
    expect(rows.some((row) => row.price === 110)).toBe(false);
  });

  it("keeps a preamble row that bills real time", () => {
    // RO 22059's L9 "Rpl information labels" — "Rpl", not "Repl", so it carries
    // no recognised op code and sits above the first one that does.
    const rows = parseCccEstimateRows(
      [
        "INFORMATION LABELS",
        "1#Non CCC Users Contact10.000.00.0",
        "9 S01 Rpl information labels 0.3",
        "10 Repl Certif label 21.00",
      ].join("\n")
    );
    const described = rows.map((row) => row.description ?? "");
    expect(described.some((d) => /information labels/i.test(d))).toBe(true);
    expect(described.some((d) => /Non CCC Users/i.test(d))).toBe(false);
  });

  it("keeps a preamble operation that bills NO time at all", () => {
    // The shipped defect: "Rpl Emblem Incl." has no recognised op code and no
    // hours, so the time-only rule deleted it as boilerplate.
    const rows = parseCccEstimateRows(
      [
        "UPPER DMGS ONLY",
        "1#Non CCC Users Contact10.000.00.0",
        "2 Rpl Emblem Incl.",
        "3 Repl Bumper cover 1,308.00 2.6",
      ].join("\n")
    );
    const described = rows.map((row) => row.description ?? "");
    expect(described.some((d) => /Emblem/i.test(d))).toBe(true);
    expect(described.some((d) => /Non CCC Users/i.test(d))).toBe(false);
  });

  it("leaves a document alone when it has no preamble at all", () => {
    // Six of the eight corpus documents are this case; the rule must be inert.
    const rows = parseCccEstimateRows(
      ["HOOD", "1 Repl Hood 900.00 2.0", "2 R&I Hood emblem 0.2"].join("\n")
    );
    expect(rows.length).toBe(2);
  });
});

/**
 * The release gate, verified against the two reference bundles.
 *
 * The acceptance criterion is the one the spec states: the Test5 bundle (the
 * regression case) must FAIL and block release; the corrected Shop 22059 run
 * must PASS clean. Both bundles are checked in under tests/fixtures/deltaGate/
 * so the gate cannot be quietly weakened — loosening any rule turns the first
 * assertion red.
 *
 * Note on the two rules that were easy to get wrong, and were:
 *   R16 — unequal counters are only a defect with NO ledger to reconcile them.
 *         "vision: 0" beside "indexed: 2" is coherent when nothing needed OCR;
 *         a first cut failed the PASSING bundle on it.
 *   R18 — disclosure is the sentence the reader sees, not a boolean on the
 *         finding. A first cut checked a flag and missed the real defect.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  buildBlockedNotice,
  mayRelease,
  runDeltaReleaseGate,
  type DeltaBundle,
} from "../deltaReleaseGate";

const FIXTURES = path.join(__dirname, "../../../../tests/fixtures/deltaGate");
const load = (name: string): DeltaBundle =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

const regression = runDeltaReleaseGate(load("bundle_test5.json"));
const corrected = runDeltaReleaseGate(load("bundle_shop22059.json"));
const failedRules = (violations: typeof regression) =>
  new Set(violations.filter((v) => v.severity === "FAIL").map((v) => v.rule));

describe("the regression bundle is blocked", () => {
  it("blocks release", () => {
    expect(mayRelease(regression)).toBe(false);
    expect(regression.filter((v) => v.severity === "FAIL")).toHaveLength(24);
  });

  it("catches every recurring defect class the four graded runs kept reproducing", () => {
    expect(failedRules(regression)).toEqual(
      new Set([
        "R03", // annotations != findings — 81/69, 137/71, 85/71
        "R04", // badges mixed line numbers with finding numbers
        "R05", // a finding TITLE leaked into the label field
        "R06", // a deduction reported as missing scope
        "R07", // pre/post scan called missing where the carrier substitutes Service Mode
        "R08", // findings with no anchor — where fabrication enters
        "R09", // "MISSED on", internal vocabulary, cost-based wording
        "R10", // absent basis rendered as "0.0 @ $0.00"
        "R11", // dollar figures in prose absent from the findings
        "R13", // notes off the page and over body text
        "R14", // the OEM report rendering the delta legend
        "R15", // an authority named that was never retrieved
        "R16", // 149 / 142 / 147 for one run
        "R17", // "High" confidence on a run whose invariants failed
        "R18", // 8 of 38 shown, undisclosed
      ])
    );
  });

  it("names the substitution rather than accusing the carrier of omission", () => {
    const r07 = regression.filter((v) => v.rule === "R07");
    expect(r07).toHaveLength(2);
    for (const violation of r07) {
      expect(violation.message).toMatch(/substituted by SERVICE_MODE/);
      expect(violation.message).toMatch(/emit operation_substituted/);
    }
  });

  it("resolves an external op vocabulary through the rename map, not a second table", () => {
    // The bundle says OP_PRE_SCAN; this repo's single table says PRE_REPAIR_SCAN.
    expect(regression.some((v) => v.message.includes("PRE_REPAIR_SCAN"))).toBe(true);
    expect(regression.some((v) => v.message.includes("OP_PRE_SCAN"))).toBe(false);
  });

  it("forces confidence to low once any invariant has failed", () => {
    expect(regression.some((v) => v.rule === "R17" && /must be "low"/.test(v.message))).toBe(true);
  });

  it("produces an operator notice that says why, instead of shipping artifacts", () => {
    const notice = buildBlockedNotice(regression);
    expect(notice).toMatch(/^RELEASE BLOCKED — 24 rule violation\(s\)/);
    expect(notice).toContain("Artifacts were not produced.");
    expect(notice).toContain("FAIL R03");
  });
});

describe("the corrected bundle is released", () => {
  it("passes with no failures and no warnings", () => {
    expect(corrected.filter((v) => v.severity === "FAIL")).toEqual([]);
    expect(corrected.filter((v) => v.severity === "WARN")).toEqual([]);
    expect(mayRelease(corrected)).toBe(true);
  });

  it("does not fault a counter that is legitimately zero", () => {
    // ledger_total 2, indexed 2, vision 0, reviewed 2 — no document needed OCR.
    expect(corrected.some((v) => v.rule === "R16")).toBe(false);
  });

  it("accepts its category findings because they reconcile to the subtotal gap", () => {
    expect(corrected.some((v) => v.rule === "R12")).toBe(false);
  });
});

describe("the gate is inert on a bundle that carries nothing", () => {
  it("an empty bundle is not a failure — sections are adopted incrementally", () => {
    const violations = runDeltaReleaseGate({});
    expect(violations.filter((v) => v.severity === "FAIL")).toEqual([]);
    expect(mayRelease(violations)).toBe(true);
  });
});

describe("R20/R21 — the RO 22116 bad pairing cannot ship quietly", () => {
  /** Finding 61 as it actually rendered: two descriptions with no word in common. */
  const badPairing = {
    findings: [
      {
        id: "F61",
        type: "value_delta",
        anchors: ["t68"],
        scope: "group",
        pairing_basis: "description",
        similarity: 0.19,
        target_desc: "Cover to protect interior during repair",
        source_desc: "Color Tint",
        target_qty: 2,
        source_qty: 1,
        target_amount: 5.0,
        source_amount: 0,
        source_labor: 0,
        member_ops: ["OP_COLOR_TINT", "OP_COVER_CAR"],
      },
    ],
  };

  const violations = runDeltaReleaseGate(badPairing);

  it("four independent rules catch it, so one regression cannot hide it", () => {
    const messages = violations.filter((v) => v.severity === "FAIL").map((v) => v.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/similarity 0\.19 is below the 0\.82 floor/),
        expect.stringMatching(/paired rows share no token/),
        expect.stringMatching(/source_qty=1 but source_amount=0 and no labor/),
        expect.stringMatching(/group mixes canonical ops/),
      ])
    );
  });

  it("blocks the release", () => {
    expect(mayRelease(violations)).toBe(false);
  });

  it("an unscored description pairing is itself a failure — it cannot be audited", () => {
    const unscored = runDeltaReleaseGate({
      findings: [
        { id: "F1", anchors: ["t1"], pairing_basis: "description", target_desc: "Mask jambs", source_desc: "Mask jambs" },
      ],
    });
    expect(unscored.some((v) => /no similarity score/.test(v.message))).toBe(true);
  });

  it("a sound description pairing passes both rules", () => {
    const good = runDeltaReleaseGate({
      findings: [
        {
          id: "F1",
          anchors: ["t1"],
          scope: "group",
          pairing_basis: "description",
          similarity: 0.95,
          target_desc: "Mask jambs 4 panel",
          source_desc: "Mask jambs",
          target_qty: 1,
          source_qty: 1,
          target_amount: 15,
          source_amount: 15,
          member_ops: ["OP_MASK_JAMBS", "OP_MASK_JAMBS"],
        },
      ],
    });
    expect(good.filter((v) => v.rule === "R20" || v.rule === "R21")).toEqual([]);
  });
});

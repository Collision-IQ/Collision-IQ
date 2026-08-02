/**
 * C-9 (Work Order R4) — documented-procedure extraction derives from THIS
 * file's text only: no static topic list, no cross-RO vocabulary leakage
 * between runs. A run whose text lacks a phrase must never report it.
 */
import { describe, it, expect } from "vitest";
import { extractEstimateFacts } from "../extractors/extractEstimateFacts";

const TEXT_WITH_PROCEDURES = [
  "Preliminary Estimate",
  "84 Rpr Pre-repair scan 1.0 M",
  "65 Cavity wax application 0.2",
  "98 Final road test for safety 0.5",
  "4 Work authorization secured 1",
  "66 Test fit rear bumper 1.0",
  "108 Maintain HV battery state of charge 5.00",
].join("\n");

const TEXT_WITHOUT_PROCEDURES = [
  "Preliminary Estimate",
  "10 Repl Front bumper cover 500.00 2.0",
  "11 Rpr Hood 1.5",
  "12 Blnd LT Fender 0.8",
].join("\n");

describe("documented procedures derive from the run's own text", () => {
  it("phrases present in the text are reported", () => {
    const facts = extractEstimateFacts({ text: TEXT_WITH_PROCEDURES });
    expect(facts.documentedProcedures).toContain("Cavity wax");
    expect(facts.documentedProcedures).toContain("Final road test");
    expect(facts.documentedProcedures).toContain("Work authorization");
    expect(facts.documentedProcedures).toContain("Test fits");
    expect(facts.documentedProcedures).toContain("HV battery state-of-charge maintenance");
  });

  it("a run without those phrases reports NONE of them — no static list, no leakage", () => {
    const facts = extractEstimateFacts({ text: TEXT_WITHOUT_PROCEDURES });
    for (const label of [
      "Cavity wax",
      "Final road test",
      "Work authorization",
      "Test fits",
      "HV battery state-of-charge maintenance",
      "Pre-repair scan",
      "Post-repair scan",
    ]) {
      expect(facts.documentedProcedures).not.toContain(label);
      expect(facts.documentedHighlights).not.toContain(label);
    }
  });

  it("two consecutive runs are isolated — the second run never carries the first run's vocabulary", () => {
    const first = extractEstimateFacts({ text: TEXT_WITH_PROCEDURES });
    expect(first.documentedProcedures.length).toBeGreaterThan(0);
    const second = extractEstimateFacts({ text: TEXT_WITHOUT_PROCEDURES });
    expect(second.documentedProcedures.filter((label) => first.documentedProcedures.includes(label))).toEqual([]);
  });
});

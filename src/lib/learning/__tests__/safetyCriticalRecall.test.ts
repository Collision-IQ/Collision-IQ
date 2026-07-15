import { describe, expect, it } from "vitest";
import { evaluateLearningAnswer, type GoldAnswer } from "../answerEvaluator";
import { checkFeynmanStructure } from "../feynmanStructure";
import { rankErrorTargets } from "../errorRanking";

const seatBeltGold: GoldAnswer = {
  keyPoints: [
    { text: "seat belt inspection", aliases: ["inspect the seat belts"], required: true, safetyCritical: true },
    { text: "impact sensor", required: true, safetyCritical: true },
    { text: "occupant classification", required: false },
  ],
  expectedAuthorityMentions: ["oem procedure"],
};

function evaluate(candidateText: string, gold: GoldAnswer = seatBeltGold, safetyCritical = true) {
  return evaluateLearningAnswer({
    candidateText,
    goldAnswer: gold,
    sourceRefs: [],
    safetyCritical,
  });
}

describe("safety-critical recall", () => {
  it("grades a complete, supported answer as transferable (5)", () => {
    const result = evaluate(
      "Per the OEM procedure, perform the seat belt inspection, replace triggered impact sensor units, and verify occupant classification."
    );
    expect(result.errorCodes).toEqual([]);
    expect(result.safetyRecall).toBe(1);
    expect(result.grade).toBe(5);
  });

  it("grades a safety-critical miss as unsafe (0) with SAFETY_CRITICAL_MISS", () => {
    const result = evaluate("Per the OEM procedure, inspect the seat belts and check trim panels.");
    expect(result.errorCodes).toContain("SAFETY_CRITICAL_MISS");
    expect(result.grade).toBe(0);
    expect(result.safetyRecall).toBeLessThan(1);
  });

  it("fails unsupported-vehicle prompts that do not declare the vehicle unsupported", () => {
    const gold: GoldAnswer = { keyPoints: [], unsupportedVehicle: true };
    const confident = evaluate("The calibration takes 1.2 hours using the standard target set.", gold);
    expect(confident.grade).toBe(0);
    expect(confident.errorCodes).toContain("UNSUPPORTED_VEHICLE_NOT_DECLARED");

    const honest = evaluate("This vehicle is unsupported in the licensed data set; no coverage is available.", gold);
    expect(honest.errorCodes).not.toContain("UNSUPPORTED_VEHICLE_NOT_DECLARED");
    expect(honest.grade).toBeGreaterThanOrEqual(3);
  });

  it("zeros answers that assert forbidden claims", () => {
    const gold: GoldAnswer = {
      keyPoints: [{ text: "confirm the vehicle-specific procedure", required: true }],
      forbiddenAssertions: ["all manufacturers allow sectioning"],
    };
    const result = evaluate(
      "Confirm the vehicle-specific procedure, although all manufacturers allow sectioning at the rocker.",
      gold,
      false
    );
    expect(result.grade).toBe(0);
    expect(result.errorCodes).toContain("UNSUPPORTED_ASSERTION");
    expect(result.unsupportedClaimRate).toBeGreaterThan(0);
  });

  it("flags scope overclaims (MOTOR sandbox generalization)", () => {
    const gold: GoldAnswer = { keyPoints: [{ text: "vehicle-scoped", required: true }] };
    const result = evaluate(
      "This is vehicle-scoped data, but we have comprehensive MOTOR coverage for every vehicle.",
      gold,
      false
    );
    expect(result.errorCodes).toContain("SCOPE_OVERCLAIM");
  });

  it("requires uncertainty acknowledgement when the gold answer demands it", () => {
    const gold: GoldAnswer = {
      keyPoints: [{ text: "measure the rail", required: true }],
      requiresUncertainty: true,
    };
    const overconfident = evaluate("Measure the rail; everything else is fine.", gold, false);
    expect(overconfident.errorCodes).toContain("MISSING_UNCERTAINTY");
    expect(overconfident.grade).toBeLessThanOrEqual(2);

    const calibrated = evaluate(
      "Measure the rail; the inner structure requires verification before any conclusion.",
      gold,
      false
    );
    expect(calibrated.errorCodes).not.toContain("MISSING_UNCERTAINTY");
  });

  it("downgrades to 3 when the authority class is wrong but content is right", () => {
    const result = evaluate(
      "Perform the seat belt inspection and replace impact sensor units, plus occupant classification checks."
    );
    // authority mention "oem procedure" missing → citation gate
    expect(result.errorCodes).toContain("WRONG_AUTHORITY_CLASS");
    expect(result.grade).toBe(3);
  });
});

describe("error-led remediation selection", () => {
  it("ranks critical > high > medium, then by recurrence", () => {
    const now = new Date();
    const ranked = rankErrorTargets([
      { severity: "medium", occurrenceCount: 50, lastSeenAt: now },
      { severity: "critical", occurrenceCount: 1, lastSeenAt: now },
      { severity: "high", occurrenceCount: 9, lastSeenAt: now },
      { severity: "high", occurrenceCount: 2, lastSeenAt: now },
    ]);
    expect(ranked.map((entry) => entry.severity)).toEqual(["critical", "high", "high", "medium"]);
    expect(ranked[1].occurrenceCount).toBe(9);
  });
});

describe("Feynman structure check", () => {
  it("requires all three audience levels", () => {
    const complete = checkFeynmanStructure(
      "## Vehicle owner\nplain\n## Estimator or technician\ntech\n## Expert reviewer\nscope\nWhat would prove this explanation wrong: a procedure revision."
    );
    expect(complete.complete).toBe(true);
    expect(complete.hasFalsifiability).toBe(true);

    const missing = checkFeynmanStructure("## Vehicle owner\nplain answer only");
    expect(missing.complete).toBe(false);
  });
});

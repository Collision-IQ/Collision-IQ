import { describe, expect, it } from "vitest";
import { evaluatePromotionEligibility, type PromotionAttempt } from "../promotionRules";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-06-01T00:00:00.000Z");

function attempt(overrides: Partial<PromotionAttempt>): PromotionAttempt {
  return {
    mode: "ACTIVE_RECALL",
    grade: 5,
    citationFidelity: 1,
    errorCodes: [],
    createdAt: T0,
    ...overrides,
  };
}

const fullHistory: PromotionAttempt[] = [
  attempt({ createdAt: T0 }),
  attempt({ createdAt: new Date(T0.getTime() + 8 * DAY) }), // delayed recall pass
  attempt({ mode: "CONTRAST", createdAt: new Date(T0.getTime() + 9 * DAY) }),
  attempt({ mode: "INTERLEAVED_CASE", createdAt: new Date(T0.getTime() + 10 * DAY) }),
];

const verifiedItem = { status: "VERIFIED", safetyCritical: true, sourceFingerprint: "fp-1" };
const cleanBenchmark = { id: "run-1", completedAt: new Date(), hasRegression: false };

describe("evaluatePromotionEligibility", () => {
  it("passes when every gate is satisfied", () => {
    const result = evaluatePromotionEligibility({
      item: verifiedItem,
      attempts: fullHistory,
      benchmark: cleanBenchmark,
    });
    expect(result.failedGates).toEqual([]);
    expect(result.eligible).toBe(true);
  });

  it("rejects promotion when the referenced benchmark shows a regression", () => {
    const result = evaluatePromotionEligibility({
      item: verifiedItem,
      attempts: fullHistory,
      benchmark: { ...cleanBenchmark, hasRegression: true },
    });
    expect(result.eligible).toBe(false);
    expect(result.failedGates.join(" ")).toMatch(/regression/);
  });

  it("rejects unverified or invalidated items", () => {
    for (const status of ["DRAFT", "INVALIDATED", "RETIRED"]) {
      const result = evaluatePromotionEligibility({
        item: { ...verifiedItem, status },
        attempts: fullHistory,
        benchmark: cleanBenchmark,
      });
      expect(result.eligible).toBe(false);
      expect(result.failedGates.join(" ")).toMatch(/VERIFIED/);
    }
  });

  it("requires a delayed recall pass at least 7 days after the first pass", () => {
    const tooSoon = [
      attempt({ createdAt: T0 }),
      attempt({ createdAt: new Date(T0.getTime() + 2 * DAY) }),
      attempt({ mode: "CONTRAST", createdAt: new Date(T0.getTime() + 3 * DAY) }),
      attempt({ mode: "FULL_REPORT", createdAt: new Date(T0.getTime() + 4 * DAY) }),
    ];
    const result = evaluatePromotionEligibility({
      item: verifiedItem,
      attempts: tooSoon,
      benchmark: cleanBenchmark,
    });
    expect(result.eligible).toBe(false);
    expect(result.failedGates.join(" ")).toMatch(/delayed recall/);
  });

  it("requires contrast and novel-case transfer passes", () => {
    const noContrast = fullHistory.filter((entry) => entry.mode !== "CONTRAST");
    expect(
      evaluatePromotionEligibility({ item: verifiedItem, attempts: noContrast, benchmark: cleanBenchmark })
        .failedGates.join(" ")
    ).toMatch(/contrast/);

    const noTransfer = fullHistory.filter((entry) => entry.mode !== "INTERLEAVED_CASE");
    expect(
      evaluatePromotionEligibility({ item: verifiedItem, attempts: noTransfer, benchmark: cleanBenchmark })
        .failedGates.join(" ")
    ).toMatch(/novel-case/);
  });

  it("rejects any history containing a safety-critical miss", () => {
    const history = [...fullHistory, attempt({ grade: 0, errorCodes: ["SAFETY_CRITICAL_MISS"], createdAt: new Date(T0.getTime() + 11 * DAY) })];
    const result = evaluatePromotionEligibility({
      item: verifiedItem,
      attempts: history,
      benchmark: cleanBenchmark,
    });
    expect(result.eligible).toBe(false);
    expect(result.failedGates.join(" ")).toMatch(/safety-critical/);
  });

  it("rejects citation fidelity below 98% on the latest passing attempt", () => {
    const weakCitations = [
      ...fullHistory,
      attempt({ citationFidelity: 0.9, createdAt: new Date(T0.getTime() + 12 * DAY) }),
    ];
    const result = evaluatePromotionEligibility({
      item: verifiedItem,
      attempts: weakCitations,
      benchmark: cleanBenchmark,
    });
    expect(result.eligible).toBe(false);
    expect(result.failedGates.join(" ")).toMatch(/citation fidelity/);
  });

  it("requires a completed benchmark run", () => {
    expect(
      evaluatePromotionEligibility({ item: verifiedItem, attempts: fullHistory, benchmark: null }).eligible
    ).toBe(false);
    expect(
      evaluatePromotionEligibility({
        item: verifiedItem,
        attempts: fullHistory,
        benchmark: { id: "run-2", completedAt: null, hasRegression: false },
      }).eligible
    ).toBe(false);
  });
});

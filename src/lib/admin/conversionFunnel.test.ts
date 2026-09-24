import { describe, expect, it } from "vitest";
import { buildConversionFunnel, furthestStageOf, type FunnelAccountInput } from "./conversionFunnel";

const NOW = new Date("2026-09-24T12:00:00Z");

function account(overrides: Partial<FunnelAccountInput> & { userId: string }): FunnelAccountInput {
  return {
    email: `${overrides.userId}@example.test`,
    name: null,
    signedUpAt: new Date("2026-09-01T00:00:00Z"),
    firstUploadAt: null,
    firstReportAt: null,
    checkoutStartedAt: null,
    subscribedAt: null,
    subscriptionStatus: null,
    valueIqPaidAt: null,
    ...overrides,
  };
}

describe("buildConversionFunnel", () => {
  it("counts each stage by what actually happened and flags abandoned checkouts", () => {
    const funnel = buildConversionFunnel(
      [
        account({ userId: "signup-only" }),
        account({ userId: "uploader", firstUploadAt: new Date("2026-09-02T00:00:00Z") }),
        account({
          userId: "abandoned",
          firstUploadAt: new Date("2026-09-02T00:00:00Z"),
          firstReportAt: new Date("2026-09-03T00:00:00Z"),
          checkoutStartedAt: new Date("2026-09-04T00:00:00Z"),
        }),
        account({
          userId: "paying",
          checkoutStartedAt: new Date("2026-09-05T00:00:00Z"),
          subscribedAt: new Date("2026-09-05T00:00:00Z"),
          subscriptionStatus: "ACTIVE",
          valueIqPaidAt: new Date("2026-09-06T00:00:00Z"),
        }),
      ],
      NOW
    );

    expect(funnel.stages.map((stage) => [stage.stage, stage.count, stage.pctOfSignups])).toEqual([
      ["signed_up", 4, 100],
      ["first_upload", 2, 50],
      ["first_report", 1, 25],
      ["checkout_started", 2, 50],
      ["subscribed", 1, 25],
    ]);
    expect(funnel.abandonedCheckouts).toBe(1);
    expect(funnel.valueIqPurchases).toBe(1);
    // Closest to paying first.
    expect(funnel.accounts.map((a) => a.userId)).toEqual([
      "paying",
      "abandoned",
      "uploader",
      "signup-only",
    ]);
    expect(funnel.accounts.find((a) => a.userId === "abandoned")?.abandonedCheckout).toBe(true);
    expect(funnel.accounts.find((a) => a.userId === "paying")?.abandonedCheckout).toBe(false);
  });

  it("does not invent earlier stages: a subscriber who never uploaded is not counted as an uploader", () => {
    const subscriber = account({
      userId: "direct",
      checkoutStartedAt: new Date("2026-09-02T00:00:00Z"),
      subscribedAt: new Date("2026-09-02T00:00:00Z"),
    });
    const funnel = buildConversionFunnel([subscriber], NOW);
    expect(furthestStageOf(subscriber)).toBe("subscribed");
    expect(funnel.stages.find((stage) => stage.stage === "first_upload")?.count).toBe(0);
  });

  it("reports days since signup and handles an empty cohort", () => {
    const funnel = buildConversionFunnel([account({ userId: "a" })], NOW);
    expect(funnel.accounts[0].daysSinceSignup).toBe(23);
    const empty = buildConversionFunnel([], NOW);
    expect(empty.stages.every((stage) => stage.count === 0 && stage.pctOfSignups === null)).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { prismaMock, d } = vi.hoisted(() => {
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const prismaMock = {
  user: {
    findMany: vi.fn(async () => [
      {
        id: "u_shop",
        email: "shop@example.test",
        firstName: "Pat",
        lastName: "Lee",
        createdAt: d("2026-09-01"),
        memberships: [{ shopId: "shop_1" }],
        subscriptions: [
          {
            stripeCustomerId: "cus_1",
            stripeSubscriptionId: null,
            status: "INCOMPLETE",
            createdAt: d("2026-09-05"),
            currentPeriodStart: null,
          },
        ],
      },
      {
        id: "u_paid",
        email: "paid@example.test",
        firstName: null,
        lastName: null,
        createdAt: d("2026-09-02"),
        memberships: [],
        subscriptions: [
          {
            stripeCustomerId: "cus_2",
            stripeSubscriptionId: "sub_2",
            status: "ACTIVE",
            createdAt: d("2026-09-03"),
            currentPeriodStart: d("2026-09-04"),
          },
        ],
      },
    ]),
  },
  uploadedAttachment: {
    groupBy: vi.fn(async () => [
      // Uploaded under the shop, not the user: must still count for u_shop.
      { ownerType: "SHOP", ownerId: "shop_1", _min: { createdAt: d("2026-09-03") } },
      { ownerType: "USER", ownerId: "u_shop", _min: { createdAt: d("2026-09-04") } },
    ]),
  },
  analysisReport: { groupBy: vi.fn(async () => []) },
  dvValuationRequest: {
    groupBy: vi.fn(async () => [{ userId: "u_paid", _min: { paidAt: d("2026-09-06") } }]),
  },
};
return { prismaMock, d };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { loadConversionFunnel } from "./conversionFunnelData";

describe("loadConversionFunnel", () => {
  it("excludes platform admins, scopes to the window and attributes shop-owned uploads", async () => {
    const funnel = await loadConversionFunnel({ windowDays: 30, now: d("2026-09-24") });

    const userQuery = prismaMock.user.findMany.mock.calls[0][0] as {
      where: { isPlatformAdmin: boolean; createdAt: { gte: Date } };
    };
    expect(userQuery.where.isPlatformAdmin).toBe(false);
    expect(userQuery.where.createdAt.gte.toISOString()).toBe("2026-08-25T00:00:00.000Z");

    const shopUser = funnel.accounts.find((a) => a.userId === "u_shop")!;
    expect(shopUser.firstUploadAt?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(shopUser.checkoutStartedAt?.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(shopUser.subscribedAt).toBeNull();
    expect(shopUser.abandonedCheckout).toBe(true);
    expect(shopUser.name).toBe("Pat Lee");

    const paid = funnel.accounts.find((a) => a.userId === "u_paid")!;
    expect(paid.subscribedAt?.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(paid.subscriptionStatus).toBe("ACTIVE");
    expect(paid.valueIqPaidAt?.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(funnel.abandonedCheckouts).toBe(1);
  });

  it("all-time window applies no signup date filter", async () => {
    prismaMock.user.findMany.mockClear();
    await loadConversionFunnel({ windowDays: null, now: d("2026-09-24") });
    const where = (prismaMock.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ isPlatformAdmin: false });
  });
});

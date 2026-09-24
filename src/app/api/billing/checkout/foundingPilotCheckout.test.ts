import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionsCreate = vi.fn();
const promotionCodesList = vi.fn();

vi.mock("@/lib/billing/entitlements", () => ({
  getCurrentEntitlements: vi.fn(async () => ({ isAuthenticated: true })),
}));
vi.mock("@/lib/auth/get-or-create-app-user", () => ({
  getOrCreateAppUser: vi.fn(async () => ({ id: "user_1" })),
}));
vi.mock("@/lib/billing/catalog", () => ({
  BILLING_CATALOG: {
    pro: { priceId: "price_pro_200", mode: "subscription", lane: "subscription" },
    starter: { priceId: "price_starter", mode: "subscription", lane: "subscription" },
  },
  isBillingPlanKey: (value: string) => value === "pro" || value === "starter",
}));
vi.mock("@/lib/billing/stripe", () => ({
  getBillingReturnUrl: (path: string) => `https://app.test${path}`,
  getStripe: () => ({
    checkout: { sessions: { create: sessionsCreate } },
    promotionCodes: { list: promotionCodesList },
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ subscriptions: [{ stripeCustomerId: "cus_1" }] })),
    },
  },
}));

import { POST } from "./route";

function checkoutRequest(plan: string) {
  return new Request("https://app.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan }),
  });
}

describe("Founding Shop Pilot checkout", () => {
  beforeEach(() => {
    sessionsCreate.mockReset().mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    promotionCodesList.mockReset();
  });

  it("checks out the regular PRO price with the pilot code pre-applied", async () => {
    promotionCodesList.mockResolvedValue({ data: [{ id: "promo_pilot" }] });

    const response = await POST(checkoutRequest("founding-pilot"));

    expect(response.status).toBe(200);
    expect(promotionCodesList).toHaveBeenCalledWith({ code: "FOUNDINGSHOP", active: true, limit: 1 });
    const params = sessionsCreate.mock.calls[0][0];
    // The subscription item must be the standard Pro price so the webhook's
    // price→plan lookup resolves PRO (an unknown price falls back to STARTER).
    expect(params.line_items).toEqual([{ price: "price_pro_200", quantity: 1 }]);
    expect(params.discounts).toEqual([{ promotion_code: "promo_pilot" }]);
    expect(params.allow_promotion_codes).toBeUndefined();
    expect(params.metadata).toMatchObject({ plan: "pro", offer: "founding_pilot" });
  });

  it("never sends a pilot click to a full-price checkout once the 10 spots are gone", async () => {
    promotionCodesList.mockResolvedValue({ data: [] });

    const response = await POST(checkoutRequest("founding-pilot"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      url: "https://app.test/billing?offer=founding-pilot&pilot=full",
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("leaves standard Pro checkout unchanged (promo code field, no pre-applied discount)", async () => {
    const response = await POST(checkoutRequest("pro"));

    expect(response.status).toBe(200);
    expect(promotionCodesList).not.toHaveBeenCalled();
    const params = sessionsCreate.mock.calls[0][0];
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.discounts).toBeUndefined();
    expect(params.metadata.offer).toBe("");
  });
});

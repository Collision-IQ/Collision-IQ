import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/integrations/ccc/secure-share/webhook/[env]/route";
import { extractRqUid, isValidCccSecureShareEnvironment } from "./secureShareWebhook";

describe("CCC Secure Share webhook helpers", () => {
  it("extracts RqUID from CIECA BMS XML", () => {
    expect(
      extractRqUid("<VehicleDamageEstimateAddRq><RqUID>abc</RqUID></VehicleDamageEstimateAddRq>")
    ).toBe("abc");
  });

  it("extracts namespace-style RqUID tags", () => {
    expect(
      extractRqUid(
        "<ns:VehicleDamageEstimateAddRq><ns:RqUID>abc-ns</ns:RqUID></ns:VehicleDamageEstimateAddRq>"
      )
    ).toBe("abc-ns");
  });

  it("rejects invalid environments", () => {
    expect(isValidCccSecureShareEnvironment("sandbox")).toBe(true);
    expect(isValidCccSecureShareEnvironment("production")).toBe(true);
    expect(isValidCccSecureShareEnvironment("staging")).toBe(false);
  });
});

describe("CCC Secure Share webhook route", () => {
  it("returns 400 for an empty body", async () => {
    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/sandbox", {
        method: "POST",
        body: "",
      }),
      { params: Promise.resolve({ env: "sandbox" }) }
    );

    expect(response.status).toBe(400);
  });

  it("accepts valid XML posts", async () => {
    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/sandbox", {
        method: "POST",
        body: "<VehicleDamageEstimateAddRq><RqUID>abc</RqUID></VehicleDamageEstimateAddRq>",
        headers: {
          "content-type": "application/xml",
          "x-forwarded-for": "52.252.194.193",
        },
      }),
      { params: Promise.resolve({ env: "sandbox" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      environment: "sandbox",
      rqUid: "abc",
      duplicate: false,
    });
  });
});

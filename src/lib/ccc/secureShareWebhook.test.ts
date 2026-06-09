import { describe, expect, it } from "vitest";
import {
  GET,
  POST,
} from "@/app/api/integrations/ccc/secure-share/webhook/[[...segments]]/route";
import {
  extractRqUid,
  isValidCccSecureShareEnvironment,
  resolveCccSecureShareEnvironment,
} from "./secureShareWebhook";

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

  it("defaults base-path requests to sandbox in monitor mode", () => {
    expect(
      resolveCccSecureShareEnvironment({
        url: "https://example.test/api/integrations/ccc/secure-share/webhook",
      })
    ).toMatchObject({
      ok: true,
      environment: "sandbox",
      environmentSource: "monitor_default_sandbox",
    });
  });
});

describe("CCC Secure Share webhook route", () => {
  it("returns endpoint metadata for GET /webhook", async () => {
    const response = await GET(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook"),
      { params: Promise.resolve({}) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      endpoint: "ccc-secure-share-webhook",
      environment: "sandbox",
      environmentSource: "monitor_default_sandbox",
      accepts: "POST XML",
    });
  });

  it("returns endpoint metadata for GET /webhook/sandbox", async () => {
    const response = await GET(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/sandbox"),
      { params: Promise.resolve({ segments: ["sandbox"] }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      endpoint: "ccc-secure-share-webhook",
      environment: "sandbox",
      environmentSource: "path_segment",
      accepts: "POST XML",
    });
  });

  it("returns 400 for an empty body", async () => {
    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/sandbox", {
        method: "POST",
        body: "",
      }),
      { params: Promise.resolve({ segments: ["sandbox"] }) }
    );

    expect(response.status).toBe(400);
  });

  it("accepts empty manual validation POST /webhook/sandbox/estimate", async () => {
    const response = await POST(
      new Request(
        "https://example.test/api/integrations/ccc/secure-share/webhook/sandbox/estimate?appId=1686&trigger=manual",
        {
          method: "POST",
          body: "",
        }
      ),
      { params: Promise.resolve({ segments: ["sandbox", "estimate"] }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      validationOnly: true,
      requestKind: "manual_validation",
      environment: "sandbox",
      environmentSource: "path_segment",
      rqUid: null,
      duplicate: false,
      message: "CCC manual webhook validation accepted without BMS XML body",
    });
  });

  it("accepts empty manual validation POST /webhook", async () => {
    const response = await POST(
      new Request(
        "https://example.test/api/integrations/ccc/secure-share/webhook?appId=1686&trigger=manual",
        {
          method: "POST",
          body: "",
        }
      ),
      { params: Promise.resolve({}) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      validationOnly: true,
      requestKind: "manual_validation",
      environment: "sandbox",
      environmentSource: "monitor_default_sandbox",
      rqUid: null,
      duplicate: false,
    });
  });

  it("accepts POST /webhook", async () => {
    const response = await postXml({ segments: undefined });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      environment: "sandbox",
      environmentSource: "monitor_default_sandbox",
      requestKind: "bms_estimate",
      rqUid: "abc",
      duplicate: false,
    });
  });

  it("accepts POST /webhook/sandbox", async () => {
    const response = await postXml({ segments: ["sandbox"] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      environment: "sandbox",
      environmentSource: "path_segment",
      requestKind: "bms_estimate",
      rqUid: "abc",
      duplicate: false,
    });
  });

  it("accepts POST /webhook/production", async () => {
    const response = await postXml({ segments: ["production"] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      environment: "production",
      environmentSource: "path_segment",
      requestKind: "bms_estimate",
      rqUid: "abc",
      duplicate: false,
    });
  });

  it("accepts POST /webhook/sandbox/anything-extra", async () => {
    const response = await postXml({ segments: ["sandbox", "anything-extra"] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      environment: "sandbox",
      environmentSource: "path_segment",
      requestKind: "bms_estimate",
      rqUid: "abc",
      duplicate: false,
    });
  });

  it("uses query param env when present", async () => {
    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook?env=production", {
        method: "POST",
        body: "<VehicleDamageEstimateAddRq><RqUID>abc</RqUID></VehicleDamageEstimateAddRq>",
        headers: {
          "content-type": "application/xml",
          "x-forwarded-for": "52.252.194.193",
        },
      }),
      { params: Promise.resolve({}) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      environment: "production",
      environmentSource: "query_param",
      requestKind: "bms_estimate",
      rqUid: "abc",
      duplicate: false,
    });
  });

  it("returns 202 for non-empty monitor-mode body without RqUID", async () => {
    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook", {
        method: "POST",
        body: "<ManualValidation><Status>ok</Status></ManualValidation>",
        headers: {
          "content-type": "application/xml",
        },
      }),
      { params: Promise.resolve({}) }
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      environment: "sandbox",
      environmentSource: "monitor_default_sandbox",
      requestKind: "unknown_monitor",
      rqUid: null,
      duplicate: false,
    });
  });

  it("rejects invalid query param env", async () => {
    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook?env=bad", {
        method: "POST",
        body: "<VehicleDamageEstimateAddRq><RqUID>abc</RqUID></VehicleDamageEstimateAddRq>",
      }),
      { params: Promise.resolve({}) }
    );

    expect(response.status).toBe(400);
  });

  it("rejects a clearly invalid first environment segment", async () => {
    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/staging", {
        method: "POST",
        body: "<VehicleDamageEstimateAddRq><RqUID>abc</RqUID></VehicleDamageEstimateAddRq>",
      }),
      { params: Promise.resolve({ segments: ["staging"] }) }
    );

    expect(response.status).toBe(400);
  });

  it("defaults unknown CCC-appended path segments to sandbox", async () => {
    const response = await postXml({ segments: ["test-connection"] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      environment: "sandbox",
      environmentSource: "monitor_default_sandbox",
      rqUid: "abc",
    });
  });
});

function postXml({ segments }: { segments?: string[] }) {
  const suffix = segments?.length ? `/${segments.join("/")}` : "";
  return POST(
    new Request(`https://example.test/api/integrations/ccc/secure-share/webhook${suffix}`, {
      method: "POST",
      body: "<VehicleDamageEstimateAddRq><RqUID>abc</RqUID></VehicleDamageEstimateAddRq>",
      headers: {
        "content-type": "application/xml",
        "x-forwarded-for": "52.252.194.193",
      },
    }),
    { params: Promise.resolve({ segments }) }
  );
}

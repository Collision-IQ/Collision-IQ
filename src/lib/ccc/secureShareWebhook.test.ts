import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GET,
  POST,
} from "@/app/api/integrations/ccc/secure-share/webhook/[[...segments]]/route";
import { GET as GET_CCC_ADMIN_EVENTS } from "@/app/api/admin/ccc-secure-share/events/route";
import { GET as GET_CCC_ADMIN_EVENT_DETAIL } from "@/app/api/admin/ccc-secure-share/events/[id]/route";
import { normalizeCccBmsEstimate } from "./bmsEstimateNormalizer";
import {
  buildSanitizedCccSecureSharePreview,
  CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY,
  setCccSecureSharePreviewAdminAccessResolverForTest,
  setCccSecureSharePreviewReaderForTest,
} from "./secureSharePreview";
import {
  type CccSecureShareEventRecord,
  checkWebhookSecret,
  extractRqUid,
  isValidCccSecureShareEnvironment,
  resolveCccSecureShareEnvironment,
  setCccSecureShareEventRecorderForTest,
} from "./secureShareWebhook";

const recordedEvents: Array<CccSecureShareEventRecord & { duplicate: boolean }> = [];

beforeEach(() => {
  recordedEvents.length = 0;
  setCccSecureShareEventRecorderForTest(async (event) => {
    const duplicate = Boolean(
      event.rqUid &&
        recordedEvents.some(
          (recorded) =>
            recorded.environment === event.environment &&
            recorded.rqUid === event.rqUid
        )
    );
    recordedEvents.push({ ...event, duplicate });
    return { duplicate };
  });
});

afterEach(() => {
  setCccSecureShareEventRecorderForTest(null);
  setCccSecureSharePreviewAdminAccessResolverForTest(null);
  setCccSecureSharePreviewReaderForTest(null);
  vi.restoreAllMocks();
});

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

  it("recognizes x-secureshare-signature as present without matching it as a secret", () => {
    const result = checkWebhookSecret(
      new Headers({
        "x-secureshare-signature": "signature-value-that-must-not-be-logged",
      }),
      "sandbox",
      {
        CCC_SECURE_SHARE_SANDBOX_WEBHOOK_SECRET: "configured-secret",
        CCC_SECURE_SHARE_SECRET_MODE: "monitor",
      } as NodeJS.ProcessEnv
    );

    expect(result).toEqual({
      configured: true,
      present: true,
      signaturePresent: true,
      matched: false,
      mode: "monitor",
    });
  });

  it("does not enable strict mode when only x-secureshare-signature is present", () => {
    const result = checkWebhookSecret(
      new Headers({
        "x-secureshare-signature": "ccc-signature",
      }),
      "sandbox",
      {
        CCC_SECURE_SHARE_SANDBOX_WEBHOOK_SECRET: "configured-secret",
      } as NodeJS.ProcessEnv
    );

    expect(result.mode).toBe("monitor");
    expect(result.signaturePresent).toBe(true);
    expect(result.matched).toBe(false);
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

describe("CCC Secure Share sanitized normalized preview", () => {
  it("strips raw XML and sensitive party identifiers while preserving VIN tail/hash", () => {
    const rawXml = `
      <VehicleDamageEstimateAddRq>
        <RqUID>preview-rq</RqUID>
        <ClaimNumber>CLAIM-987654321</ClaimNumber>
        <VIN>1HGCM82633A004352</VIN>
        <ModelYear>2024</ModelYear>
        <Make>Honda</Make>
        <Model>Accord</Model>
        <OwnerName>Jane Owner</OwnerName>
        <OwnerAddress1>123 Main Street</OwnerAddress1>
        <OwnerPhone>555-111-2222</OwnerPhone>
        <OwnerEmail>jane.owner@example.test</OwnerEmail>
        <EstimateLineItem>
          <LineNumber>7</LineNumber>
          <Section>Front Lamps</Section>
          <Operation>Replace</Operation>
          <PartDescription>Headlamp assembly</PartDescription>
          <LaborType>Body</LaborType>
          <PartType>OEM</PartType>
          <Quantity>1</Quantity>
          <LaborHours>0.8</LaborHours>
          <TotalAmount>245.50</TotalAmount>
        </EstimateLineItem>
      </VehicleDamageEstimateAddRq>
    `;

    const normalized = normalizeCccBmsEstimate(rawXml);
    const preview = buildSanitizedCccSecureSharePreview(normalized);
    const serialized = JSON.stringify(preview);

    expect(serialized).not.toContain(rawXml);
    expect(serialized).not.toContain("1HGCM82633A004352");
    expect(serialized).not.toContain("CLAIM-987654321");
    expect(serialized).not.toContain("Jane Owner");
    expect(serialized).not.toContain("123 Main Street");
    expect(serialized).not.toContain("555-111-2222");
    expect(serialized).not.toContain("jane.owner@example.test");
    expect(preview.vehicleVinTail).toBe("004352");
    expect(preview.vehicleVinHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.normalizedHeaderJson).toMatchObject({
      identifiers: {
        claimNumberRedacted: "***********4321",
        claimNumberHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      evidenceBoundary: CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY,
    });
  });

  it("keeps line item preview to allowed fields only", () => {
    const preview = buildSanitizedCccSecureSharePreview(
      normalizeCccBmsEstimate(`
        <VehicleDamageEstimateAddRq>
          <RqUID>line-preview-rq</RqUID>
          <EstimateLineItem>
            <LineNumber>9</LineNumber>
            <Section>Body</Section>
            <Operation>Repair</Operation>
            <PartDescription>Quarter panel</PartDescription>
            <PartNumber>PRIVATE-PART-NUMBER</PartNumber>
            <LaborType>Body</LaborType>
            <Quantity>2</Quantity>
            <LaborHours>3.5</LaborHours>
            <BodyLaborHours>3.5</BodyLaborHours>
            <RefinishHours>1.2</RefinishHours>
            <UnitPrice>100.25</UnitPrice>
            <TotalAmount>200.50</TotalAmount>
          </EstimateLineItem>
        </VehicleDamageEstimateAddRq>
      `)
    );

    expect(preview.normalizedLineItemsPreviewJson[0]).toEqual({
      lineNumber: "9",
      section: "Body",
      operation: "Repair",
      description: "Quarter panel",
      laborType: "Body",
      partType: null,
      quantity: 2,
      laborHours: 3.5,
      bodyLaborHours: 3.5,
      paintLaborHours: 1.2,
      refinishHours: 1.2,
      unitPrice: 100.25,
      extendedAmount: 200.5,
      parseWarnings: [],
    });
    expect(JSON.stringify(preview.normalizedLineItemsPreviewJson)).not.toContain(
      "PRIVATE-PART-NUMBER"
    );
  });

  it("admin list and detail endpoints reject non-admin preview access", async () => {
    setCccSecureSharePreviewAdminAccessResolverForTest(async () => ({ isPlatformAdmin: false }));
    setCccSecureSharePreviewReaderForTest({
      list: async () => {
        throw new Error("non-admin should not read CCC preview list");
      },
      get: async () => {
        throw new Error("non-admin should not read CCC preview detail");
      },
    });

    const listResponse = await GET_CCC_ADMIN_EVENTS(
      new NextRequest("https://example.test/api/admin/ccc-secure-share/events")
    );
    const detailResponse = await GET_CCC_ADMIN_EVENT_DETAIL(
      new Request("https://example.test/api/admin/ccc-secure-share/events/event-1"),
      { params: Promise.resolve({ id: "event-1" }) }
    );

    expect(listResponse.status).toBe(403);
    expect(detailResponse.status).toBe(403);
  });

  it("admin detail preview includes CCC evidence boundaries without prohibited authority claims", async () => {
    const normalized = normalizeCccBmsEstimate(
      "<VehicleDamageEstimateAddRq><RqUID>admin-preview-rq</RqUID><EstimateLineItem><LineNumber>1</LineNumber><Operation>Replace</Operation><PartDescription>Headlamp</PartDescription></EstimateLineItem></VehicleDamageEstimateAddRq>"
    );
    const preview = buildSanitizedCccSecureSharePreview(normalized);
    setCccSecureSharePreviewAdminAccessResolverForTest(async () => ({ isPlatformAdmin: true }));
    setCccSecureSharePreviewReaderForTest({
      list: async () => [],
      get: async (id) => ({
        id,
        receivedAt: "2026-06-09T00:00:00.000Z",
        environment: "sandbox",
        requestKind: "bms_estimate",
        rqUid: "admin-preview-rq",
        appId: "1686",
        trigger: null,
        bodyLength: 100,
        contentType: "application/xml",
        sourceIp: "52.252.194.193",
        signaturePresent: true,
        secretMatched: false,
        duplicate: false,
        normalizationStatus: preview.normalizationStatus,
        normalizedLineItemCount: preview.normalizedLineItemCount,
        vehicle: {
          year: preview.vehicleYear,
          make: preview.vehicleMake,
          model: preview.vehicleModel,
          vinTail: preview.vehicleVinTail,
        },
        jurisdiction: {
          stateCode: preview.jurisdictionStateCode,
          source: preview.jurisdictionSource,
          confidence: preview.jurisdictionConfidence,
        },
        warningCount: preview.normalizationWarningsJson.length,
        normalizedHeader: preview.normalizedHeaderJson,
        jurisdictionEvidence: preview.normalizedHeaderJson.jurisdictionEvidence,
        jurisdictionResolution: preview.normalizedHeaderJson.jurisdictionResolution,
        totals: preview.normalizedHeaderJson.totals,
        lineItemPreview: preview.normalizedLineItemsPreviewJson,
        parseWarnings: [],
        normalizationWarnings: preview.normalizationWarningsJson,
        aiSafeContextPreview: [
          "CCC Secure Share source confirms this estimate line was present in the structured estimate data.",
          "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified.",
          CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY,
        ].join("\n"),
        evidenceBoundaries: {
          linePresence:
            "CCC Secure Share source confirms this estimate line was present in the structured estimate data.",
          citationGap:
            "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified.",
          authority: CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY,
        },
      }),
    });

    const response = await GET_CCC_ADMIN_EVENT_DETAIL(
      new Request("https://example.test/api/admin/ccc-secure-share/events/event-1"),
      { params: Promise.resolve({ id: "event-1" }) }
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(serialized).toContain(
      "CCC Secure Share source confirms this estimate line was present in the structured estimate data."
    );
    expect(serialized).toContain(
      "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified."
    );
    expect(serialized).toContain(CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY);
    expect(serialized).not.toContain("CCC confirms this operation is required");
    expect(serialized).not.toContain("CCC proves OEM");
    expect(serialized).not.toContain("CCC proves P-page");
    expect(serialized).not.toContain("CCC proves legal violation");
    expect(serialized).not.toContain("CCC proves policy coverage");
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
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({
      environment: "sandbox",
      environmentSource: "path_segment",
      requestKind: "manual_validation",
      appId: "1686",
      trigger: "manual",
      rqUid: null,
      bodyLength: 0,
      duplicate: false,
      processingStatus: "validation_accepted",
    });
  });

  it("accepts empty manual validation POST /webhook", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    expect(
      infoSpy.mock.calls.some(
        ([message]) => message === "[ccc-secure-share-webhook] normalized BMS metadata"
      )
    ).toBe(false);
    infoSpy.mockRestore();
  });

  it("accepts manual validation when persistence table is missing", async () => {
    const tableMissingError = Object.assign(new Error("Missing CCC webhook event table"), {
      code: "P2021",
    });
    setCccSecureShareEventRecorderForTest(async () => {
      throw tableMissingError;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(
      new Request(
        "https://example.test/api/integrations/ccc/secure-share/webhook/estimate?appId=1686&trigger=manual",
        {
          method: "POST",
          body: "",
        }
      ),
      { params: Promise.resolve({ segments: ["estimate"] }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      validationOnly: true,
      requestKind: "manual_validation",
      rqUid: null,
      duplicate: false,
    });
    expect(warnSpy.mock.calls).toEqual([
      [
        "[ccc-secure-share-webhook] persistence unavailable",
        expect.objectContaining({
          persisted: false,
          persistenceUnavailable: true,
          reason: "table_missing",
          requestKind: "manual_validation",
          appId: "1686",
          trigger: "manual",
          rqUid: null,
        }),
      ],
    ]);
  });

  it("logs x-secureshare-signature presence in monitor mode without logging the value", async () => {
    const originalSecret = process.env.CCC_SECURE_SHARE_SANDBOX_WEBHOOK_SECRET;
    const originalMode = process.env.CCC_SECURE_SHARE_SECRET_MODE;
    const signatureValue = "ccc-signature-value-that-must-not-be-logged";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      process.env.CCC_SECURE_SHARE_SANDBOX_WEBHOOK_SECRET = "configured-secret";
      process.env.CCC_SECURE_SHARE_SECRET_MODE = "monitor";

      const response = await POST(
        new Request(
          "https://example.test/api/integrations/ccc/secure-share/webhook/estimate?appId=1686&trigger=manual",
          {
            method: "POST",
            body: "",
            headers: {
              "x-secureshare-signature": signatureValue,
            },
          }
        ),
        { params: Promise.resolve({ segments: ["estimate"] }) }
      );
      const body = await response.json();
      const manualLog = infoSpy.mock.calls.find(
        ([message]) => message === "[ccc-secure-share-webhook] manual validation accepted"
      );
      const logged = JSON.stringify(infoSpy.mock.calls);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        received: true,
        validationOnly: true,
        requestKind: "manual_validation",
        duplicate: false,
      });
      expect(manualLog?.[1]).toEqual(
        expect.objectContaining({
          secretConfigured: true,
          secretPresent: true,
          signaturePresent: true,
          secretMatched: false,
          secretMode: "monitor",
        })
      );
      expect(logged).not.toContain(signatureValue);
    } finally {
      if (originalSecret === undefined) {
        delete process.env.CCC_SECURE_SHARE_SANDBOX_WEBHOOK_SECRET;
      } else {
        process.env.CCC_SECURE_SHARE_SANDBOX_WEBHOOK_SECRET = originalSecret;
      }

      if (originalMode === undefined) {
        delete process.env.CCC_SECURE_SHARE_SECRET_MODE;
      } else {
        process.env.CCC_SECURE_SHARE_SECRET_MODE = originalMode;
      }
    }
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

  it("accepts BMS estimate XML when persistence table is missing", async () => {
    const rawXml =
      "<VehicleDamageEstimateAddRq><RqUID>p2021-rq</RqUID><VIN>1HGCM82633A004352</VIN><ClaimNumber>CLAIM-123456</ClaimNumber><OwnerName>Jane Owner</OwnerName></VehicleDamageEstimateAddRq>";
    const tableMissingError = Object.assign(new Error("Missing CCC webhook event table"), {
      code: "P2021",
    });
    setCccSecureShareEventRecorderForTest(async () => {
      throw tableMissingError;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/sandbox", {
        method: "POST",
        body: rawXml,
        headers: {
          "content-type": "application/xml",
        },
      }),
      { params: Promise.resolve({ segments: ["sandbox"] }) }
    );
    const body = await response.json();
    const logged = JSON.stringify(warnSpy.mock.calls);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      received: true,
      requestKind: "bms_estimate",
      rqUid: "p2021-rq",
      duplicate: false,
    });
    expect(logged).toContain("table_missing");
    expect(logged).not.toContain(rawXml);
    expect(logged).not.toContain("1HGCM82633A004352");
    expect(logged).not.toContain("CLAIM-123456");
    expect(logged).not.toContain("Jane Owner");
  });

  it("stores metadata for the first BMS estimate event", async () => {
    const response = await postXml({ segments: ["sandbox"] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.duplicate).toBe(false);
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({
      environment: "sandbox",
      environmentSource: "path_segment",
      requestKind: "bms_estimate",
      appId: null,
      trigger: null,
      rqUid: "abc",
      rawXmlSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      bodyLength: 75,
      contentType: "application/xml",
      sourceIp: "52.252.194.193",
      headerNames: ["content-type", "x-forwarded-for"],
      secretPresent: false,
      secretMatched: false,
      duplicate: false,
      processingStatus: "received",
      parseError: null,
    });
  });

  it("normalizes only after webhook metadata persistence", async () => {
    const order: string[] = [];
    setCccSecureShareEventRecorderForTest(async (event) => {
      order.push("persist");
      recordedEvents.push({ ...event, duplicate: false });
      return { duplicate: false };
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation((message) => {
      if (message === "[ccc-secure-share-webhook] normalized BMS metadata") {
        order.push("normalize-log");
      }
    });

    const response = await postXml({ segments: ["sandbox"] });

    expect(response.status).toBe(200);
    expect(order).toEqual(["persist", "normalize-log"]);
    infoSpy.mockRestore();
  });

  it("logs only safe normalization metadata for non-empty bodies", async () => {
    const rawXml = [
      "<VehicleDamageEstimateAddRq>",
      "<RqUID>safe-rq</RqUID>",
      "<VIN>1HGCM82633A004352</VIN>",
      "<ModelYear>2024</ModelYear>",
      "<Make>Honda</Make>",
      "<Model>Accord</Model>",
      "<EstimateLineItem>",
      "<LineNumber>1</LineNumber>",
      "<Operation>Replace</Operation>",
      "<PartDescription>Headlamp assembly</PartDescription>",
      "<TotalAmount>245.50</TotalAmount>",
      "</EstimateLineItem>",
      "</VehicleDamageEstimateAddRq>",
    ].join("");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/sandbox", {
        method: "POST",
        body: rawXml,
        headers: {
          "content-type": "application/xml",
        },
      }),
      { params: Promise.resolve({ segments: ["sandbox"] }) }
    );
    const normalizedCall = infoSpy.mock.calls.find(
      ([message]) => message === "[ccc-secure-share-webhook] normalized BMS metadata"
    );

    expect(response.status).toBe(200);
    expect(normalizedCall?.[1]).toEqual({
      rqUid: "safe-rq",
      lineItemCount: 1,
      vehiclePresent: true,
      jurisdictionSource: "unknown",
      jurisdictionConfidence: "unknown",
      warningCount: 0,
    });
    expect(JSON.stringify(normalizedCall)).not.toContain(rawXml);
    expect(JSON.stringify(normalizedCall)).not.toContain("1HGCM82633A004352");
    expect(JSON.stringify(normalizedCall)).not.toContain("Headlamp assembly");
    infoSpy.mockRestore();
  });

  it("marks duplicate RqUID events as duplicate", async () => {
    const first = await postXml({ segments: ["sandbox"] });
    const second = await postXml({ segments: ["sandbox"] });
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.duplicate).toBe(false);
    expect(secondBody.duplicate).toBe(true);
    expect(recordedEvents).toHaveLength(2);
    expect(recordedEvents[0]).toMatchObject({ rqUid: "abc", duplicate: false });
    expect(recordedEvents[1]).toMatchObject({ rqUid: "abc", duplicate: true });
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
    expect(recordedEvents[0]).toMatchObject({
      requestKind: "unknown_monitor",
      rqUid: null,
      processingStatus: "metadata_only",
      parseError: "RqUID not found in webhook body.",
    });
  });

  it("does not log raw XML or sensitive CCC estimate fields", async () => {
    const rawXml = `
      <VehicleDamageEstimateAddRq>
        <RqUID>secret-rq</RqUID>
        <ClaimNumber>CLAIM-123456789</ClaimNumber>
        <VIN>1HGCM82633A004352</VIN>
        <OwnerName>Jane Owner</OwnerName>
        <OwnerAddress1>123 Main Street</OwnerAddress1>
        <OwnerCity>Los Angeles</OwnerCity>
        <OwnerState>CA</OwnerState>
        <OwnerZip>90002</OwnerZip>
        <OwnerPhone>555-111-2222</OwnerPhone>
        <OwnerEmail>jane.owner@example.test</OwnerEmail>
        <EstimateLineItem>
          <LineNumber>1</LineNumber>
          <Operation>Replace</Operation>
          <Description>Front bumper cover</Description>
        </EstimateLineItem>
      </VehicleDamageEstimateAddRq>
    `;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://example.test/api/integrations/ccc/secure-share/webhook/sandbox", {
        method: "POST",
        body: rawXml,
        headers: {
          "content-type": "application/xml",
        },
      }),
      { params: Promise.resolve({ segments: ["sandbox"] }) }
    );

    expect(response.status).toBe(200);
    const logged = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]);

    expect(logged).not.toContain(rawXml);
    expect(logged).not.toContain("1HGCM82633A004352");
    expect(logged).not.toContain("CLAIM-123456789");
    expect(logged).not.toContain("Jane Owner");
    expect(logged).not.toContain("123 Main Street");
    expect(logged).not.toContain("555-111-2222");
    expect(logged).not.toContain("jane.owner@example.test");
    expect(logged).not.toContain("Front bumper cover");
    expect(logged).toContain("secret-rq");
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

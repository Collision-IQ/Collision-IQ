import { NextResponse } from "next/server";
import {
  buildEventRecord,
  checkWebhookSecret,
  extractRqUid,
  getHeaderNames,
  getSourceIp,
  isIpAllowed,
  recordCccSecureShareEvent,
  resolveCccSecureShareEnvironment,
  sha256Hex,
  shouldEnforceIpAllowlist,
} from "@/lib/ccc/secureShareWebhook";
import { normalizeCccBmsEstimate } from "@/lib/ccc/bmsEstimateNormalizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ segments?: string[] }>;
};

export async function GET(req: Request, context: RouteContext) {
  return handleWebhookGet(req, context);
}

export async function POST(req: Request, context: RouteContext) {
  return handleWebhookPost(req, context);
}

async function handleWebhookGet(req: Request, context: RouteContext) {
  const { segments } = await context.params;
  const environmentResolution = resolveCccSecureShareEnvironment({
    segments,
    url: req.url,
  });

  if (!environmentResolution.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: environmentResolution.error,
        invalidEnvironment: environmentResolution.invalidEnvironment,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    endpoint: "ccc-secure-share-webhook",
    environment: environmentResolution.environment,
    environmentSource: environmentResolution.environmentSource,
    accepts: "POST XML",
  });
}

async function handleWebhookPost(req: Request, context: RouteContext) {
  const { segments } = await context.params;
  const environmentResolution = resolveCccSecureShareEnvironment({
    segments,
    url: req.url,
  });

  if (!environmentResolution.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: environmentResolution.error,
        invalidEnvironment: environmentResolution.invalidEnvironment,
      },
      { status: 400 }
    );
  }

  const { environment, environmentSource } = environmentResolution;
  const rawXml = await req.text();
  const url = new URL(req.url);
  const trigger = url.searchParams.get("trigger");
  const appId = url.searchParams.get("appId");
  const isManualValidation = trigger === "manual" && Boolean(appId?.trim());

  const sourceIp = getSourceIp(req.headers);
  const allowlistEnforced = shouldEnforceIpAllowlist();
  const ipAllowed = isIpAllowed(sourceIp);
  const contentType = req.headers.get("content-type");
  const headerNames = getHeaderNames(req.headers);

  if (allowlistEnforced && !ipAllowed) {
    console.warn("[ccc-secure-share-webhook] rejected ip", {
      environment,
      environmentSource,
      sourceIp,
      allowlistEnforced,
      ipAllowed,
      headerNames,
    });
    return NextResponse.json({ ok: false, error: "Source IP not allowed" }, { status: 403 });
  }

  const secretCheck = checkWebhookSecret(req.headers, environment);
  // TODO: Switch production CCC Secure Share validation to strict mode after confirming CCC's actual header/signature behavior in sandbox traffic.
  if (secretCheck.mode === "strict" && secretCheck.configured && !secretCheck.matched) {
    console.warn("[ccc-secure-share-webhook] rejected secret", {
      environment,
      environmentSource,
      secretConfigured: secretCheck.configured,
      secretPresent: secretCheck.present,
      secretMatched: secretCheck.matched,
      headerNames,
    });
    return NextResponse.json({ ok: false, error: "Invalid webhook secret" }, { status: 401 });
  }

  if (!rawXml.trim()) {
    if (isManualValidation) {
      const eventRecord = buildEventRecord({
        environment,
        environmentSource,
        requestKind: "manual_validation",
        appId,
        trigger,
        rqUid: null,
        rawXmlSha256: sha256Hex(rawXml),
        bodyLength: rawXml.length,
        contentType,
        receivedAt: new Date().toISOString(),
        sourceIp,
        headerNames,
        secretPresent: secretCheck.present,
        secretMatched: secretCheck.matched,
        processingStatus: "validation_accepted",
      });
      const { duplicate } = await recordCccSecureShareEvent(eventRecord);

      console.info("[ccc-secure-share-webhook] manual validation accepted", {
        environment,
        environmentSource,
        requestKind: "manual_validation",
        validationOnly: true,
        rqUid: null,
        rqUidMissing: true,
        bodyLength: rawXml.length,
        contentType,
        sourceIp,
        headerNames,
        trigger,
        appId,
        secretConfigured: secretCheck.configured,
        secretPresent: secretCheck.present,
        secretMatched: secretCheck.matched,
        secretMode: secretCheck.mode,
        allowlistEnforced,
        ipAllowed,
        duplicate,
      });

      return NextResponse.json({
        ok: true,
        received: true,
        validationOnly: true,
        requestKind: "manual_validation",
        environment,
        environmentSource,
        rqUid: null,
        duplicate,
        message: "CCC manual webhook validation accepted without BMS XML body",
      });
    }

    return NextResponse.json({ ok: false, error: "Empty body" }, { status: 400 });
  }

  const rqUid = extractRqUid(rawXml);
  const rawXmlSha256 = sha256Hex(rawXml);
  const receivedAt = new Date().toISOString();
  const requestKind = rqUid ? "bms_estimate" : "unknown_monitor";

  if (!rqUid && secretCheck.mode === "strict") {
    console.warn("[ccc-secure-share-webhook] rejected missing rqUid", {
      environment,
      environmentSource,
      requestKind: "unknown_monitor",
      rqUid: null,
      rqUidMissing: true,
      bodyLength: rawXml.length,
      rawXmlSha256,
      contentType,
      sourceIp,
      headerNames,
      trigger,
      appId,
      secretConfigured: secretCheck.configured,
      secretPresent: secretCheck.present,
      secretMatched: secretCheck.matched,
      secretMode: secretCheck.mode,
      allowlistEnforced,
      ipAllowed,
    });

    return NextResponse.json(
      { ok: false, error: "Missing RqUID", requestKind: "unknown_monitor" },
      { status: 400 }
    );
  }

  const eventRecord = buildEventRecord({
    environment,
    environmentSource,
    requestKind,
    appId,
    trigger,
    rqUid,
    rawXmlSha256,
    bodyLength: rawXml.length,
    contentType,
    receivedAt,
    sourceIp,
    headerNames,
    secretPresent: secretCheck.present,
    secretMatched: secretCheck.matched,
    processingStatus: rqUid ? "received" : "metadata_only",
    parseError: rqUid ? null : "RqUID not found in webhook body.",
  });
  const { duplicate } = await recordCccSecureShareEvent(eventRecord);

  tryNormalizeAndLogCccBmsMetadata({
    rawXml,
    environment,
    rqUid,
    appId,
  });

  console.info("[ccc-secure-share-webhook] received", {
    environment,
    environmentSource,
    requestKind,
    rqUid,
    rqUidMissing: !rqUid,
    bodyLength: rawXml.length,
    rawXmlSha256,
    contentType,
    sourceIp,
    headerNames,
    trigger,
    appId,
    secretConfigured: secretCheck.configured,
    secretPresent: secretCheck.present,
    secretMatched: secretCheck.matched,
    secretMode: secretCheck.mode,
    allowlistEnforced,
    ipAllowed,
    duplicate,
  });

  return NextResponse.json(
    {
      ok: true,
      received: true,
      environment,
      environmentSource,
      requestKind,
      rqUid,
      duplicate,
    },
    { status: rqUid ? 200 : 202 }
  );
}

function tryNormalizeAndLogCccBmsMetadata(params: {
  rawXml: string;
  environment: "sandbox" | "production";
  rqUid: string | null;
  appId: string | null;
}) {
  if (!params.rawXml.trim()) return;

  try {
    const normalized = normalizeCccBmsEstimate(params.rawXml, {
      environment: params.environment,
      rqUid: params.rqUid,
      appId: params.appId,
    });

    console.info("[ccc-secure-share-webhook] normalized BMS metadata", {
      rqUid: normalized.rqUid,
      lineItemCount: normalized.lineItems.length,
      vehiclePresent: Boolean(
        normalized.vehicle.vin ||
          normalized.vehicle.year ||
          normalized.vehicle.make ||
          normalized.vehicle.model ||
          normalized.vehicle.trim
      ),
      jurisdictionSource: normalized.jurisdictionResolution?.source ?? "unknown",
      jurisdictionConfidence: normalized.jurisdictionResolution?.confidence ?? "unknown",
      warningCount: normalized.parseWarnings.length,
    });
  } catch (error) {
    console.warn("[ccc-secure-share-webhook] BMS normalization skipped", {
      rqUid: params.rqUid,
      lineItemCount: 0,
      vehiclePresent: false,
      jurisdictionSource: "unknown",
      jurisdictionConfidence: "unknown",
      warningCount: 1,
      error: error instanceof Error ? error.message : "Unknown normalization error",
    });
  }
}

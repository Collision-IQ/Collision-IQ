import { NextResponse } from "next/server";
import {
  buildEventRecord,
  checkWebhookSecret,
  extractRqUid,
  getHeaderNames,
  getSourceIp,
  isIpAllowed,
  isValidCccSecureShareEnvironment,
  recordCccSecureShareEvent,
  sha256Hex,
  shouldEnforceIpAllowlist,
} from "@/lib/ccc/secureShareWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ env: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { env } = await context.params;

  if (!isValidCccSecureShareEnvironment(env)) {
    return NextResponse.json({ ok: false, error: "Invalid environment" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    endpoint: "ccc-secure-share-webhook",
    environment: env,
    accepts: "POST XML",
  });
}

export async function POST(req: Request, context: RouteContext) {
  const { env } = await context.params;

  if (!isValidCccSecureShareEnvironment(env)) {
    return NextResponse.json({ ok: false, error: "Invalid environment" }, { status: 400 });
  }

  const rawXml = await req.text();
  if (!rawXml.trim()) {
    return NextResponse.json({ ok: false, error: "Empty body" }, { status: 400 });
  }

  const sourceIp = getSourceIp(req.headers);
  const allowlistEnforced = shouldEnforceIpAllowlist();
  const ipAllowed = isIpAllowed(sourceIp);

  if (allowlistEnforced && !ipAllowed) {
    console.warn("[ccc-secure-share-webhook] rejected ip", {
      env,
      sourceIp,
      allowlistEnforced,
      ipAllowed,
      headerNames: getHeaderNames(req.headers),
    });
    return NextResponse.json({ ok: false, error: "Source IP not allowed" }, { status: 403 });
  }

  const secretCheck = checkWebhookSecret(req.headers, env);
  // TODO: Switch production CCC Secure Share validation to strict mode after confirming CCC's actual header/signature behavior in sandbox traffic.
  if (secretCheck.mode === "strict" && secretCheck.configured && !secretCheck.matched) {
    console.warn("[ccc-secure-share-webhook] rejected secret", {
      env,
      secretConfigured: secretCheck.configured,
      secretPresent: secretCheck.present,
      secretMatched: secretCheck.matched,
      headerNames: getHeaderNames(req.headers),
    });
    return NextResponse.json({ ok: false, error: "Invalid webhook secret" }, { status: 401 });
  }

  const rqUid = extractRqUid(rawXml);
  const rawXmlSha256 = sha256Hex(rawXml);
  const receivedAt = new Date().toISOString();
  const contentType = req.headers.get("content-type");
  const eventRecord = buildEventRecord({
    environment: env,
    rqUid,
    rawXmlSha256,
    bodyLength: rawXml.length,
    contentType,
    receivedAt,
    sourceIp,
  });
  const { duplicate } = await recordCccSecureShareEvent(eventRecord);

  console.info("[ccc-secure-share-webhook] received", {
    env,
    rqUid,
    bodyLength: rawXml.length,
    rawXmlSha256,
    contentType,
    sourceIp,
    headerNames: getHeaderNames(req.headers),
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
      environment: env,
      rqUid,
      duplicate,
    },
    { status: rqUid ? 200 : 202 }
  );
}

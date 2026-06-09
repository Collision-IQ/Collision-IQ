import { createHash } from "node:crypto";

export const CCC_SECURE_SHARE_ENVIRONMENTS = ["sandbox", "production"] as const;

export type CccSecureShareEnvironment = (typeof CCC_SECURE_SHARE_ENVIRONMENTS)[number];

export type CccSecureShareEventRecord = {
  environment: CccSecureShareEnvironment;
  environmentSource: CccSecureShareEnvironmentSource;
  requestKind: CccSecureShareRequestKind;
  appId: string | null;
  trigger: string | null;
  rqUid: string | null;
  rawXmlSha256: string | null;
  bodyLength: number;
  contentType: string | null;
  receivedAt: string;
  sourceIp: string | null;
  headerNames: string[];
  secretPresent: boolean;
  signaturePresent: boolean;
  secretMatched: boolean;
  processingStatus: CccSecureShareProcessingStatus;
  parseError: string | null;
};

export type SecretCheckResult = {
  configured: boolean;
  present: boolean;
  signaturePresent: boolean;
  matched: boolean;
  mode: "monitor" | "strict";
};

export type CccSecureShareEnvironmentSource =
  | "path_segment"
  | "query_param"
  | "monitor_default_sandbox";

export type CccSecureShareRequestKind =
  | "bms_estimate"
  | "manual_validation"
  | "unknown_monitor";

export type CccSecureShareProcessingStatus =
  | "received"
  | "validation_accepted"
  | "metadata_only";

export type CccSecureShareEnvironmentResolution =
  | {
      ok: true;
      environment: CccSecureShareEnvironment;
      environmentSource: CccSecureShareEnvironmentSource;
    }
  | {
      ok: false;
      error: "Invalid environment";
      invalidEnvironment: string;
    };

export const CCC_SECURE_SHARE_IP_ALLOWLIST = [
  "52.252.194.192/26",
  "52.249.38.64/26",
  "52.240.210.128/26",
  "20.236.173.64/26",
] as const;

const SECRET_HEADER_NAMES = [
  "authorization",
  "x-ccc-webhook-secret",
  "x-ccc-secureshare-secret",
  "x-webhook-secret",
] as const;

const SIGNATURE_HEADER_NAMES = ["x-secureshare-signature"] as const;

const CLEARLY_INVALID_ENVIRONMENT_SEGMENTS = new Set([
  "dev",
  "development",
  "prod",
  "staging",
  "stage",
  "test",
]);

type CccSecureShareEventRecorder = (
  event: CccSecureShareEventRecord
) => Promise<Partial<CccSecureShareEventRecordResult> & { duplicate: boolean }>;

export type CccSecureShareEventRecordResult = {
  eventId?: string;
  duplicate: boolean;
  persisted: boolean;
  persistenceUnavailable: boolean;
  reason?: "table_missing" | "persistence_error";
};

let customEventRecorder: CccSecureShareEventRecorder | null = null;

export function setCccSecureShareEventRecorderForTest(
  recorder: CccSecureShareEventRecorder | null
) {
  customEventRecorder = recorder;
}

export function isValidCccSecureShareEnvironment(
  value: string
): value is CccSecureShareEnvironment {
  return CCC_SECURE_SHARE_ENVIRONMENTS.includes(value as CccSecureShareEnvironment);
}

export function resolveCccSecureShareEnvironment(params: {
  segments?: string[];
  url: string;
  env?: NodeJS.ProcessEnv;
}): CccSecureShareEnvironmentResolution {
  const { segments = [], url } = params;
  const queryEnv = new URL(url).searchParams.get("env")?.trim().toLowerCase() ?? "";

  if (queryEnv) {
    if (!isValidCccSecureShareEnvironment(queryEnv)) {
      return {
        ok: false,
        error: "Invalid environment",
        invalidEnvironment: queryEnv,
      };
    }

    return {
      ok: true,
      environment: queryEnv,
      environmentSource: "query_param",
    };
  }

  const firstSegment = segments[0]?.trim().toLowerCase() ?? "";
  if (firstSegment) {
    if (isValidCccSecureShareEnvironment(firstSegment)) {
      return {
        ok: true,
        environment: firstSegment,
        environmentSource: "path_segment",
      };
    }

    if (CLEARLY_INVALID_ENVIRONMENT_SEGMENTS.has(firstSegment)) {
      return {
        ok: false,
        error: "Invalid environment",
        invalidEnvironment: firstSegment,
      };
    }
  }

  return {
    ok: true,
    environment: "sandbox",
    environmentSource: "monitor_default_sandbox",
  };
}

export function extractRqUid(xml: string): string | null {
  const match = xml.match(
    /<(?:(?:[A-Za-z_][\w.-]*):)?RqUID\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z_][\w.-]*):)?RqUID>/i
  );
  const value = decodeBasicXmlEntities(match?.[1] ?? "").trim();
  return value || null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function getHeaderNames(headers: Headers): string[] {
  return [...headers.keys()].sort();
}

export function getSourceIp(headers: Headers): string | null {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("cf-connecting-ip"),
  ];

  for (const candidate of candidates) {
    const ip = candidate?.split(",")[0]?.trim();
    if (ip) return stripIpv6MappedPrefix(ip);
  }

  return null;
}

export function checkWebhookSecret(
  headers: Headers,
  environment: CccSecureShareEnvironment,
  env: NodeJS.ProcessEnv = process.env
): SecretCheckResult {
  const expectedSecret = getExpectedSecret(environment, env);
  const mode = env.CCC_SECURE_SHARE_SECRET_MODE === "strict" ? "strict" : "monitor";
  const secretCandidates = getSecretCandidates(headers);
  const signaturePresent = hasAnySignatureCandidate(headers);

  if (!expectedSecret) {
    return {
      configured: false,
      present: secretCandidates.length > 0 || signaturePresent,
      signaturePresent,
      matched: false,
      mode,
    };
  }

  // TODO: Strict CCC Secure Share signature verification requires confirmation of CCC's signature algorithm and signed payload format.
  return {
    configured: true,
    present: secretCandidates.length > 0 || signaturePresent,
    signaturePresent,
    matched: secretCandidates.includes(expectedSecret),
    mode,
  };
}

export function shouldEnforceIpAllowlist(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CCC_SECURE_SHARE_ENFORCE_IP_ALLOWLIST === "true";
}

export function isIpAllowed(sourceIp: string | null): boolean {
  if (!sourceIp) return false;
  return CCC_SECURE_SHARE_IP_ALLOWLIST.some((cidr) => isIpv4InCidr(sourceIp, cidr));
}

export function buildEventRecord(params: {
  environment: CccSecureShareEnvironment;
  environmentSource: CccSecureShareEnvironmentSource;
  requestKind: CccSecureShareRequestKind;
  appId: string | null;
  trigger: string | null;
  rqUid: string | null;
  rawXmlSha256: string | null;
  bodyLength: number;
  contentType: string | null;
  receivedAt: string;
  sourceIp: string | null;
  headerNames: string[];
  secretPresent: boolean;
  signaturePresent: boolean;
  secretMatched: boolean;
  processingStatus: CccSecureShareProcessingStatus;
  parseError?: string | null;
}): CccSecureShareEventRecord {
  return {
    ...params,
    parseError: params.parseError ?? null,
  };
}

export async function recordCccSecureShareEvent(
  event: CccSecureShareEventRecord
): Promise<CccSecureShareEventRecordResult> {
  try {
    if (customEventRecorder) {
      return normalizeEventRecordResult(await customEventRecorder(event));
    }

    return recordCccSecureShareEventWithPrisma(event);
  } catch (error) {
    return handleCccPersistenceError(error, event, false);
  }
}

async function recordCccSecureShareEventWithPrisma(
  event: CccSecureShareEventRecord
): Promise<CccSecureShareEventRecordResult> {
  const { prisma } = await import("@/lib/prisma");

  let duplicate = false;
  if (event.rqUid) {
    try {
      duplicate = Boolean(
        await prisma.cccSecureShareWebhookEvent.findFirst({
          where: {
            environment: event.environment,
            rqUid: event.rqUid,
          },
          select: { id: true },
        })
      );
    } catch (error) {
      return handleCccPersistenceError(error, event, false);
    }
  }

  let eventId: string;
  try {
    const created = await prisma.cccSecureShareWebhookEvent.create({
      data: {
        environment: event.environment,
        environmentSource: event.environmentSource,
        requestKind: event.requestKind,
        appId: event.appId,
        trigger: event.trigger,
        rqUid: event.rqUid,
        rawXmlSha256: event.rawXmlSha256,
        bodyLength: event.bodyLength,
        contentType: event.contentType,
        sourceIp: event.sourceIp,
        headerNamesJson: event.headerNames,
        secretPresent: event.secretPresent,
        signaturePresent: event.signaturePresent,
        secretMatched: event.secretMatched,
        duplicate,
        receivedAt: new Date(event.receivedAt),
        processingStatus: event.processingStatus,
        parseError: event.parseError,
      },
    });
    eventId = created.id;
  } catch (error) {
    return handleCccPersistenceError(error, event, duplicate);
  }

  return {
    eventId,
    duplicate,
    persisted: true,
    persistenceUnavailable: false,
  };
}

function normalizeEventRecordResult(
  result: Partial<CccSecureShareEventRecordResult> & { duplicate: boolean }
): CccSecureShareEventRecordResult {
  return {
    eventId: result.eventId,
    duplicate: result.duplicate,
    persisted: result.persisted ?? true,
    persistenceUnavailable: result.persistenceUnavailable ?? false,
    reason: result.reason,
  };
}

function handleCccPersistenceError(
  error: unknown,
  event: CccSecureShareEventRecord,
  duplicate: boolean
): CccSecureShareEventRecordResult {
  const reason = isPrismaTableMissingError(error) ? "table_missing" : "persistence_error";

  console.warn("[ccc-secure-share-webhook] persistence unavailable", {
    environment: event.environment,
    environmentSource: event.environmentSource,
    requestKind: event.requestKind,
    appId: event.appId,
    trigger: event.trigger,
    rqUid: event.rqUid,
    bodyLength: event.bodyLength,
    rawXmlSha256: event.rawXmlSha256,
    contentType: event.contentType,
    sourceIp: event.sourceIp,
    headerNames: event.headerNames,
    secretPresent: event.secretPresent,
    signaturePresent: event.signaturePresent,
    secretMatched: event.secretMatched,
    duplicate,
    persisted: false,
    persistenceUnavailable: true,
    reason,
  });

  return {
    duplicate,
    persisted: false,
    persistenceUnavailable: true,
    reason,
  };
}

function isPrismaTableMissingError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2021"
  );
}

function getExpectedSecret(
  environment: CccSecureShareEnvironment,
  env: NodeJS.ProcessEnv
): string {
  const key =
    environment === "sandbox"
      ? "CCC_SECURE_SHARE_SANDBOX_WEBHOOK_SECRET"
      : "CCC_SECURE_SHARE_PRODUCTION_WEBHOOK_SECRET";
  return env[key]?.trim() ?? "";
}

function getSecretCandidates(headers: Headers): string[] {
  const values: string[] = [];

  for (const headerName of SECRET_HEADER_NAMES) {
    const rawValue = headers.get(headerName)?.trim();
    if (!rawValue) continue;

    if (headerName === "authorization") {
      const bearerMatch = rawValue.match(/^Bearer\s+(.+)$/i);
      if (bearerMatch?.[1]?.trim()) {
        values.push(bearerMatch[1].trim());
      }
      continue;
    }

    values.push(rawValue);
  }

  return values;
}

function hasAnySignatureCandidate(headers: Headers): boolean {
  return SIGNATURE_HEADER_NAMES.some((headerName) => Boolean(headers.get(headerName)?.trim()));
}

function decodeBasicXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function stripIpv6MappedPrefix(value: string): string {
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [range, prefixText] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  const prefix = Number(prefixText);

  if (ipInt === null || rangeInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ipv4ToInt(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) + octet;
  }

  return result >>> 0;
}

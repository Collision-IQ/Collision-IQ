import { createHash } from "node:crypto";

export const CCC_SECURE_SHARE_ENVIRONMENTS = ["sandbox", "production"] as const;

export type CccSecureShareEnvironment = (typeof CCC_SECURE_SHARE_ENVIRONMENTS)[number];

export type CccSecureShareEventRecord = {
  environment: CccSecureShareEnvironment;
  rqUid: string | null;
  rawXmlSha256: string;
  bodyLength: number;
  contentType: string | null;
  receivedAt: string;
  sourceIp: string | null;
  status: "received";
};

export type SecretCheckResult = {
  configured: boolean;
  present: boolean;
  matched: boolean;
  mode: "monitor" | "strict";
};

export type CccSecureShareEnvironmentSource =
  | "path_segment"
  | "query_param"
  | "monitor_default_sandbox";

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

const CLEARLY_INVALID_ENVIRONMENT_SEGMENTS = new Set([
  "dev",
  "development",
  "prod",
  "staging",
  "stage",
  "test",
]);

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

  if (!expectedSecret) {
    return {
      configured: false,
      present: hasAnySecretCandidate(headers),
      matched: false,
      mode,
    };
  }

  const candidates = getSecretCandidates(headers);
  return {
    configured: true,
    present: candidates.length > 0,
    matched: candidates.includes(expectedSecret),
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
  rqUid: string | null;
  rawXmlSha256: string;
  bodyLength: number;
  contentType: string | null;
  receivedAt: string;
  sourceIp: string | null;
}): CccSecureShareEventRecord {
  return {
    ...params,
    status: "received",
  };
}

export async function recordCccSecureShareEvent(
  event: CccSecureShareEventRecord
): Promise<{ duplicate: boolean }> {
  // TODO: Persist inbound CCC events and enforce idempotency by RqUID once a dedicated integration-event table exists.
  void event;
  return { duplicate: false };
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

function hasAnySecretCandidate(headers: Headers): boolean {
  return getSecretCandidates(headers).length > 0;
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

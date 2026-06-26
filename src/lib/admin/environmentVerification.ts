import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getDriveAuth } from "@/lib/drive/auth";
import {
  collisionIqProvider,
  getCollisionIqModelStartupDiagnostics,
} from "@/lib/modelConfig";
import { getDatabaseEnvironmentDiagnostics } from "@/lib/database/health";

export type VerificationStatus = "pass" | "fail" | "warn";

export type VerificationResult = {
  key: string;
  label: string;
  status: VerificationStatus;
  details: string;
  metadata?: Record<string, unknown>;
  failedDependency?: {
    name: string;
    message: string;
    code?: string | number;
  };
};

export type EnvironmentVerificationPayload = {
  ok: boolean;
  timestamp: string;
  environment: {
    nodeEnv: string | null;
    vercelEnv: string | null;
    vercelRegion: string | null;
    vercelUrl: string | null;
    gitCommitSha: string | null;
  };
  results: VerificationResult[];
};

const DEFAULT_TIMEOUT_MS = 4500;

export async function buildEnvironmentVerification(): Promise<EnvironmentVerificationPayload> {
  const timestamp = new Date().toISOString();
  const results = await Promise.all([
    verifyOpenAi(),
    verifyAnthropic(),
    verifyClerk(),
    verifyDatabase(),
    verifyRegulationDb(),
    verifySnapshotPersistence(),
    verifyDriveFolder("drive_oem_files", "Drive/OEM file access", [
      "GOOGLE_OEM_PROCEDURES_FOLDER_ID",
      "GOOGLE_OEM_POSITION_STATEMENTS_FOLDER_ID",
    ]),
    verifyDriveFolder("law_library", "Law library access", ["GOOGLE_PA_LAW_FOLDER_ID"]),
    verifyDriveFolder("policy_library", "Policy library access", ["GOOGLE_PA_INSURANCE_POLICIES_FOLDER_ID"]),
    verifyRuntimeFeatureFlags(),
    verifyObservabilityProviders(),
  ]);

  return {
    ok: results.every((result) => result.status !== "fail"),
    timestamp,
    environment: {
      nodeEnv: process.env.NODE_ENV ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      vercelRegion: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? null,
      vercelUrl: process.env.VERCEL_URL ? maskHost(process.env.VERCEL_URL) : null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA
        ? maskMiddle(process.env.VERCEL_GIT_COMMIT_SHA, 7, 4)
        : null,
    },
    results,
  };
}

async function verifyOpenAi(): Promise<VerificationResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseMetadata = {
    OPENAI_API_KEY: {
      present: Boolean(apiKey),
      value: maskSecret(apiKey),
    },
    resolvedPrimaryProvider: collisionIqProvider.primary,
    modelRouting: getCollisionIqModelStartupDiagnostics(),
  };

  if (!apiKey) {
    // OpenAI is now an optional legacy fallback (Claude is primary). A missing
    // key is expected and must not fail overall environment verification.
    return pass(
      "openai",
      "OpenAI API key (optional)",
      "OPENAI_API_KEY is not configured. This is expected — Claude is the primary provider.",
      baseMetadata
    );
  }

  const response = await probeFetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    return fail("openai", "OpenAI API key", "OpenAI metadata request failed.", baseMetadata, response.error);
  }

  return pass("openai", "OpenAI API key", "OPENAI_API_KEY is configured and provider metadata was reachable.", {
    ...baseMetadata,
    status: response.status,
  });
}

async function verifyAnthropic(): Promise<VerificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const metadata = {
    ANTHROPIC_API_KEY: maskSecret(apiKey),
    COLLISION_IQ_PRIMARY_PROVIDER: process.env.COLLISION_IQ_PRIMARY_PROVIDER ?? null,
    ANTHROPIC_MODEL_PRIMARY: process.env.ANTHROPIC_MODEL_PRIMARY ?? null,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null,
  };

  if (!apiKey) {
    return fail("anthropic", "Anthropic API key", "ANTHROPIC_API_KEY is not configured.", metadata);
  }

  const response = await probeFetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!response.ok) {
    return fail("anthropic", "Anthropic API key", "Anthropic metadata request failed.", metadata, response.error);
  }

  return pass("anthropic", "Anthropic API key", "ANTHROPIC_API_KEY is configured and provider metadata was reachable.", {
    ...metadata,
    status: response.status,
  });
}

async function verifyClerk(): Promise<VerificationResult> {
  const publishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  const adminEmails = process.env.COLLISION_IQ_PLATFORM_ADMIN_EMAILS?.trim();
  const metadata = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: maskSecret(publishable),
    CLERK_SECRET_KEY: maskSecret(secret),
    COLLISION_IQ_PLATFORM_ADMIN_EMAILS: maskEmailList(adminEmails),
  };

  if (!publishable || !secret) {
    return fail("clerk", "Clerk auth config", "Clerk publishable and secret keys must both be configured.", metadata);
  }

  if (!adminEmails) {
    return warn("clerk", "Clerk auth config", "Clerk keys are configured, but platform admin email allow-list is empty.", metadata);
  }

  return pass("clerk", "Clerk auth config", "Clerk keys and platform admin allow-list are configured.", metadata);
}

async function verifyDatabase(): Promise<VerificationResult> {
  const metadata = getDatabaseEnvironmentDiagnostics();
  if (!process.env.DATABASE_URL?.trim()) {
    return fail("database", "Database connectivity", "DATABASE_URL is not configured.", metadata);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return pass("database", "Database connectivity", "Database responded to SELECT 1.", metadata);
  } catch (error) {
    return fail("database", "Database connectivity", "Database query failed.", metadata, dependencyError("database", error));
  }
}

async function verifyRegulationDb(): Promise<VerificationResult> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*)::bigint AS count FROM "Regulation"
    `;
    const count = Number(rows[0]?.count ?? 0);
    const status = count > 0 ? "pass" : "warn";
    return {
      key: "regulation_db",
      label: "Regulation DB access",
      status,
      details: count > 0
        ? "Regulation table is reachable and contains records."
        : "Regulation table is reachable but contains no records.",
      metadata: { verifiedRegulationCount: count },
    };
  } catch (error) {
    return fail("regulation_db", "Regulation DB access", "Regulation table query failed.", {}, dependencyError("Regulation", error));
  }
}

async function verifySnapshotPersistence(): Promise<VerificationResult> {
  const id = `env-verify-${Date.now()}`;
  const generatedAt = new Date();

  try {
    await prisma.$executeRaw`
      INSERT INTO "PolicyLegalReviewSnapshot" (
        "id",
        "case_id",
        "claim_id",
        "claim_state",
        "regulation_ids_used",
        "regulation_sources_used",
        "citations_used",
        "oem_sources_used",
        "carrier_sources_used",
        "placeholder_citations",
        "policy_legal_confidence_score",
        "generated_at"
      ) VALUES (
        ${id},
        'env-verification',
        'env-verification',
        'NA',
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        0,
        ${generatedAt}
      )
    `;
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PolicyLegalReviewSnapshot" WHERE "id" = ${id} LIMIT 1
    `;
    await prisma.$executeRaw`DELETE FROM "PolicyLegalReviewSnapshot" WHERE "id" = ${id}`;

    if (rows[0]?.id === id) {
      return pass("snapshot_persistence", "Snapshot persistence", "Snapshot table accepted write/read/delete verification.", {
        table: "PolicyLegalReviewSnapshot",
      });
    }

    return fail("snapshot_persistence", "Snapshot persistence", "Snapshot write/read verification did not return the inserted record.", {
      table: "PolicyLegalReviewSnapshot",
    });
  } catch (error) {
    try {
      await prisma.$executeRaw`DELETE FROM "PolicyLegalReviewSnapshot" WHERE "id" = ${id}`;
    } catch {
      // best-effort cleanup only
    }
    return fail(
      "snapshot_persistence",
      "Snapshot persistence",
      "Snapshot persistence verification failed.",
      { table: "PolicyLegalReviewSnapshot" },
      dependencyError("PolicyLegalReviewSnapshot", error)
    );
  }
}

async function verifyDriveFolder(
  key: string,
  label: string,
  folderEnvNames: string[]
): Promise<VerificationResult> {
  const driveId = process.env.GOOGLE_SHARED_DRIVE_ID?.trim();
  const folderIds = folderEnvNames
    .map((envName) => ({ envName, id: process.env[envName]?.trim() }))
    .filter((entry): entry is { envName: string; id: string } => Boolean(entry.id));
  const metadata = {
    GOOGLE_SHARED_DRIVE_ID: maskSecret(driveId),
    folders: folderEnvNames.reduce<Record<string, string | null>>((acc, envName) => {
      acc[envName] = maskSecret(process.env[envName]?.trim());
      return acc;
    }, {}),
  };

  if (!driveId || folderIds.length === 0) {
    return fail(key, label, "Google Drive ID or required folder IDs are not configured.", metadata);
  }

  try {
    const auth = await getDriveAuth();
    const drive = google.drive({ version: "v3", auth });
    const folderResults = [];

    for (const folder of folderIds) {
      const response = await drive.files.list({
        corpora: "drive",
        driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        q: `'${folder.id}' in parents and trashed = false`,
        pageSize: 1,
        fields: "files(id,name,mimeType)",
      });
      folderResults.push({
        envName: folder.envName,
        reachable: true,
        sampleCount: response.data.files?.length ?? 0,
      });
    }

    return pass(key, label, "Google Drive folder access check completed.", {
      ...metadata,
      folderResults,
    });
  } catch (error) {
    return fail(key, label, "Google Drive folder access check failed.", metadata, dependencyError("google-drive", error));
  }
}

async function verifyRuntimeFeatureFlags(): Promise<VerificationResult> {
  const flags = {
    GOOGLE_DRIVE_ENABLED: process.env.GOOGLE_DRIVE_ENABLED ?? null,
    POLICY_LEGAL_INTELLIGENCE_ENABLED: process.env.POLICY_LEGAL_INTELLIGENCE_ENABLED ?? null,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
  };
  const missingRecommended = Object.entries(flags)
    .filter(([, value]) => value === null)
    .map(([key]) => key);

  if (missingRecommended.length > 0) {
    return warn("runtime_feature_flags", "Runtime feature flags", "Some runtime feature flags are not explicitly configured.", {
      flags,
      missingRecommended,
    });
  }

  return pass("runtime_feature_flags", "Runtime feature flags", "Runtime feature flags are configured.", { flags });
}

async function verifyObservabilityProviders(): Promise<VerificationResult> {
  const metadata = {
    SENTRY_DSN: maskSecret(process.env.SENTRY_DSN),
    NEXT_PUBLIC_SENTRY_DSN: maskSecret(process.env.NEXT_PUBLIC_SENTRY_DSN),
    VERCEL_ANALYTICS_ID: maskSecret(process.env.VERCEL_ANALYTICS_ID),
    OTEL_EXPORTER_OTLP_ENDPOINT: maskHost(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
  };
  const configured = Object.values(metadata).some(Boolean);

  if (!configured) {
    return warn("observability", "Observability providers", "No explicit observability provider environment variables were detected.", metadata);
  }

  return pass("observability", "Observability providers", "At least one observability provider is configured.", metadata);
}

async function probeFetch(
  url: string,
  init: RequestInit
): Promise<{ ok: true; status: number } | { ok: false; status?: number; error: ReturnType<typeof dependencyError> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: {
          name: new URL(url).host,
          message: `HTTP ${response.status}`,
          code: response.status,
        },
      };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: dependencyError(new URL(url).host, error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function pass(
  key: string,
  label: string,
  details: string,
  metadata?: Record<string, unknown>
): VerificationResult {
  return { key, label, status: "pass", details, metadata };
}

function warn(
  key: string,
  label: string,
  details: string,
  metadata?: Record<string, unknown>
): VerificationResult {
  return { key, label, status: "warn", details, metadata };
}

function fail(
  key: string,
  label: string,
  details: string,
  metadata?: Record<string, unknown>,
  failedDependency?: VerificationResult["failedDependency"]
): VerificationResult {
  return { key, label, status: "fail", details, metadata, failedDependency };
}

function dependencyError(name: string, error: unknown): { name: string; message: string; code?: string | number } {
  const message = sanitizeErrorMessage(error instanceof Error ? error.message : "Unknown dependency error");
  const code =
    typeof error === "object" && error && "code" in error
      ? (error as { code?: string | number }).code
      : undefined;
  return { name, message, ...(code ? { code } : {}) };
}

function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  const sensitiveValues = [
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.CLERK_SECRET_KEY,
    process.env.DATABASE_URL,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    process.env.GOOGLE_SA_JSON,
  ].filter((value): value is string => Boolean(value));

  for (const value of sensitiveValues) {
    sanitized = sanitized.split(value).join("[redacted]");
  }

  sanitized = sanitized.replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "postgres://[redacted]");
  sanitized = sanitized.replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]");
  return sanitized;
}

function maskSecret(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return maskMiddle(trimmed, Math.min(6, Math.ceil(trimmed.length / 3)), 4);
}

function maskMiddle(value: string, prefix = 4, suffix = 4): string {
  if (value.length <= prefix + suffix) return "[configured]";
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

function maskDatabaseUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.username ? `${maskMiddle(url.username, 2, 1)}@` : ""}${url.host}${url.pathname}`;
  } catch {
    return maskSecret(trimmed);
  }
}

function maskHost(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.host;
  } catch {
    return maskSecret(trimmed);
  }
}

function maskEmailList(value?: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => {
      const [local, domain] = email.split("@");
      if (!local || !domain) return "[redacted-email]";
      return `${local.slice(0, 2)}***@${domain}`;
    });
}

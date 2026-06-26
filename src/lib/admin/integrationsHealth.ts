import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getDriveAuth } from "@/lib/drive/auth";
import { getConfiguredDriveRootFolders } from "@/lib/drive/list";
import { getDatabaseEnvironmentDiagnostics } from "@/lib/database/health";
import { collisionIqModels } from "@/lib/modelConfig";
import { getStripe } from "@/lib/billing/stripe";

type Reachable = boolean | null;

type ServiceHealth = {
  configured: boolean;
  reachable: Reachable;
  model?: string | null;
  errorType: string | null;
};

export type IntegrationsHealthPayload = {
  ok: boolean;
  checkedAt: string;
  services: {
    openai: ServiceHealth & { model: string | null };
    anthropic: ServiceHealth & { model: string | null };
    googleDrive: ServiceHealth & {
      folderSearchAvailable: boolean | null;
      matchedRootAvailable: boolean | null;
    };
    googleCloud: ServiceHealth;
    elevenLabs: ServiceHealth;
    stripe: ServiceHealth & { webhookConfigured: boolean };
    clerk: ServiceHealth;
    database: ServiceHealth & { pooled: boolean | null };
    agents: {
      configured: boolean;
      available: boolean | null;
      errorType: string | null;
    };
    authorityRetrieval: {
      googleDriveAvailable: boolean;
      makeModelFolderSearchAvailable: boolean;
      canSearchByMakeModel: boolean;
      canReturnDocumentMetadata: boolean;
      canReturnDocumentContentOrSnippet: boolean;
      errorType: string | null;
    };
  };
  inventory: IntegrationInventoryItem[];
};

export type IntegrationInventoryItem = {
  integration: string;
  codePaths: string[];
  envVars: string[];
  envPresent: Record<string, boolean>;
  productionRequired: boolean;
  healthRoute: string | null;
  usedBy: Array<"web" | "mobile" | "reports" | "chat" | "admin">;
};

type ProbeFetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number }>;

export type IntegrationsHealthOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  probeFetch?: ProbeFetch;
  databasePing?: () => Promise<void>;
  driveProbe?: () => Promise<{
    reachable: boolean;
    folderSearchAvailable: boolean;
    matchedRootAvailable: boolean;
    canReturnDocumentMetadata: boolean;
    canReturnDocumentContentOrSnippet: boolean;
  }>;
  stripePing?: () => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 3500;

export async function buildIntegrationsHealth(options: IntegrationsHealthOptions = {}): Promise<IntegrationsHealthPayload> {
  const env = options.env ?? process.env;
  const probeFetch = options.probeFetch ?? defaultProbeFetch;
  const [
    openai,
    anthropic,
    googleDrive,
    googleCloud,
    elevenLabs,
    stripe,
    clerk,
    database,
    agents,
  ] = await Promise.all([
    checkOpenAi(env, probeFetch),
    checkAnthropic(env, probeFetch),
    checkGoogleDrive(env, options.driveProbe),
    checkGoogleCloud(env),
    checkElevenLabs(env, probeFetch),
    checkStripe(env, options.stripePing),
    checkClerk(env, probeFetch),
    checkDatabase(env, options.databasePing),
    checkAgents(env),
  ]);
  const authorityRetrieval = {
    googleDriveAvailable: googleDrive.configured && googleDrive.reachable === true,
    makeModelFolderSearchAvailable: googleDrive.folderSearchAvailable === true,
    canSearchByMakeModel: googleDrive.folderSearchAvailable === true,
    canReturnDocumentMetadata: googleDrive.matchedRootAvailable === true,
    canReturnDocumentContentOrSnippet: googleDrive.folderSearchAvailable === true,
    errorType: googleDrive.errorType,
  };
  const services = {
    openai,
    anthropic,
    googleDrive,
    googleCloud,
    elevenLabs,
    stripe,
    clerk,
    database,
    agents,
    authorityRetrieval,
  };

  return {
    ok: Object.entries(services).every(([, service]) => {
      if ("reachable" in service) return service.reachable !== false;
      return service.errorType === null;
    }),
    checkedAt: (options.now ?? new Date()).toISOString(),
    services,
    inventory: buildIntegrationInventory(env),
  };
}

function buildIntegrationInventory(env: NodeJS.ProcessEnv): IntegrationInventoryItem[] {
  return [
    inventoryItem(env, "Anthropic / Claude (primary)", ["src/lib/anthropic.ts", "src/lib/modelConfig.ts", "src/lib/ai/providerTextGeneration.ts", "src/app/api/chat/route.ts", "src/app/api/analysis/route.ts"], ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL_PRIMARY", "ANTHROPIC_BASE_URL"], true, "/api/admin/integrations-health", ["web", "mobile", "reports", "chat"]),
    inventoryItem(env, "Voyage AI (embeddings / RAG)", ["src/lib/rag/embed.ts", "src/app/api/search/route.ts", "src/app/api/drive/ingest/route.ts"], ["VOYAGE_API_KEY", "VOYAGE_EMBED_MODEL"], false, "/api/admin/integrations-health", ["reports", "chat"]),
    inventoryItem(env, "OpenAI (legacy / optional fallback)", ["src/lib/modelConfig.ts"], ["OPENAI_API_KEY", "COLLISION_IQ_MODEL_PRIMARY", "COLLISION_IQ_MODEL_HELPER"], false, "/api/admin/integrations-health", ["reports", "chat"]),
    inventoryItem(env, "Google Drive authority retrieval", ["src/lib/drive/auth.ts", "src/lib/drive/list.ts", "src/lib/ai/driveRetrievalService.ts", "src/app/api/reports/oem-citation-density/annotated-estimate/route.ts"], ["GOOGLE_DRIVE_ENABLED", "GOOGLE_SHARED_DRIVE_ID", "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", "GOOGLE_SA_JSON", "GOOGLE_IMPERSONATION_USER", "GOOGLE_IMPERSONATE_SUBJECT", "GOOGLE_OEM_PROCEDURES_FOLDER_ID", "GOOGLE_OEM_POSITION_STATEMENTS_FOLDER_ID"], true, "/api/admin/integrations-health", ["reports", "chat", "admin"]),
    inventoryItem(env, "Google Cloud / Google APIs", ["src/lib/drive/auth.ts", "src/app/api/drive/ingest/route.ts"], ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", "GOOGLE_SA_JSON"], false, "/api/admin/integrations-health", ["admin", "reports"]),
    inventoryItem(env, "ElevenLabs", ["src/app/api/tts/route.ts", "src/app/api/tts/status/route.ts"], ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_VOICE_ID_1", "ELEVENLABS_VOICE_ID_2", "ELEVENLABS_MODEL_ID"], false, "/api/admin/integrations-health", ["web", "mobile"]),
    inventoryItem(env, "Stripe", ["src/lib/billing/stripe.ts", "src/app/api/billing/checkout/route.ts", "src/app/api/billing/webhook/route.ts"], ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO"], true, "/api/admin/integrations-health", ["web", "mobile", "admin"]),
    inventoryItem(env, "Clerk", ["src/lib/auth/require-current-user.ts", "src/proxy.ts", "src/app/api/account/entitlements/route.ts"], ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "COLLISION_IQ_PLATFORM_ADMIN_EMAILS"], true, "/api/admin/integrations-health", ["web", "mobile", "admin"]),
    inventoryItem(env, "Neon/Postgres/Prisma", ["src/lib/prisma.ts", "src/lib/database/health.ts", "prisma/schema.prisma"], ["DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED"], true, "/api/admin/db-health", ["web", "mobile", "reports", "chat", "admin"]),
    inventoryItem(env, "Agents / internal routing", ["src/lib/ai/agentRetrievalTrace.ts", "src/app/api/internal/agent-review/route.ts"], ["ANTHROPIC_API_KEY", "COLLISION_IQ_MODEL_HELPER"], false, "/api/admin/integrations-health", ["reports", "chat", "admin"]),
    inventoryItem(env, "Egnyte", ["src/app/api/egnyte/client.ts", "src/app/api/egnyte/callback/route.ts"], ["EGNYTE_BASE_URL", "EGNYTE_API_TOKEN", "EGNYTE_CLIENT_ID", "EGNYTE_CLIENT_SECRET"], false, null, ["admin", "reports"]),
    inventoryItem(env, "MCP / model context tooling", ["package.json"], [], false, null, ["admin"]),
  ];
}

function inventoryItem(
  env: NodeJS.ProcessEnv,
  integration: string,
  codePaths: string[],
  envVars: string[],
  productionRequired: boolean,
  healthRoute: string | null,
  usedBy: IntegrationInventoryItem["usedBy"]
): IntegrationInventoryItem {
  return {
    integration,
    codePaths,
    envVars,
    envPresent: Object.fromEntries(envVars.map((name) => [name, Boolean(env[name]?.trim())])),
    productionRequired,
    healthRoute,
    usedBy,
  };
}

async function checkOpenAi(env: NodeJS.ProcessEnv, probeFetch: ProbeFetch): Promise<IntegrationsHealthPayload["services"]["openai"]> {
  const configured = Boolean(env.OPENAI_API_KEY?.trim());
  if (!configured) return { configured, reachable: null, model: collisionIqModels.primary, errorType: "missing_env" };
  const result = await checkFetchService({
    configured,
    model: collisionIqModels.primary,
    ping: () => probeFetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }),
  });
  return { ...result, model: result.model ?? collisionIqModels.primary };
}

async function checkAnthropic(env: NodeJS.ProcessEnv, probeFetch: ProbeFetch): Promise<IntegrationsHealthPayload["services"]["anthropic"]> {
  const configured = Boolean(env.ANTHROPIC_API_KEY?.trim());
  if (!configured) return { configured, reachable: null, model: collisionIqModels.anthropicPrimary, errorType: "missing_env" };
  const result = await checkFetchService({
    configured,
    model: collisionIqModels.anthropicPrimary,
    ping: () => probeFetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
    }),
  });
  return { ...result, model: result.model ?? collisionIqModels.anthropicPrimary };
}

async function checkElevenLabs(env: NodeJS.ProcessEnv, probeFetch: ProbeFetch): Promise<IntegrationsHealthPayload["services"]["elevenLabs"]> {
  const configured = Boolean(env.ELEVENLABS_API_KEY?.trim());
  if (!configured) return { configured, reachable: null, errorType: "missing_env" };
  return checkFetchService({
    configured,
    ping: () => probeFetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": env.ELEVENLABS_API_KEY ?? "" } }),
  });
}

async function checkClerk(env: NodeJS.ProcessEnv, probeFetch: ProbeFetch): Promise<IntegrationsHealthPayload["services"]["clerk"]> {
  const configured = Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() && env.CLERK_SECRET_KEY?.trim());
  if (!configured) return { configured, reachable: null, errorType: "missing_env" };
  return checkFetchService({
    configured,
    ping: () => probeFetch("https://api.clerk.com/v1/users?limit=1", { headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` } }),
  });
}

async function checkStripe(env: NodeJS.ProcessEnv, stripePing?: () => Promise<void>): Promise<IntegrationsHealthPayload["services"]["stripe"]> {
  const configured = Boolean(env.STRIPE_SECRET_KEY?.trim());
  const webhookConfigured = Boolean(env.STRIPE_WEBHOOK_SECRET?.trim());
  if (!configured) return { configured, reachable: null, webhookConfigured, errorType: "missing_env" };
  try {
    if (stripePing) {
      await stripePing();
    } else {
      await getStripe().accounts.retrieve();
    }
    return { configured, reachable: true, webhookConfigured, errorType: null };
  } catch (error) {
    return { configured, reachable: false, webhookConfigured, errorType: errorType(error) };
  }
}

async function checkDatabase(env: NodeJS.ProcessEnv, databasePing?: () => Promise<void>): Promise<IntegrationsHealthPayload["services"]["database"]> {
  const diagnostics = getDatabaseEnvironmentDiagnostics();
  const configured = Boolean(env.DATABASE_URL?.trim());
  if (!configured) return { configured, reachable: null, pooled: null, errorType: "missing_env" };
  try {
    if (databasePing) {
      await databasePing();
    } else {
      await prisma.$queryRaw`SELECT 1`;
    }
    return { configured, reachable: true, pooled: diagnostics.DATABASE_URL.pooled, errorType: null };
  } catch (error) {
    return { configured, reachable: false, pooled: diagnostics.DATABASE_URL.pooled, errorType: errorType(error) };
  }
}

async function checkGoogleDrive(env: NodeJS.ProcessEnv, driveProbe?: IntegrationsHealthOptions["driveProbe"]): Promise<IntegrationsHealthPayload["services"]["googleDrive"]> {
  const configured = env.GOOGLE_DRIVE_ENABLED === "true" && Boolean(env.GOOGLE_SHARED_DRIVE_ID?.trim()) && Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim() || env.GOOGLE_SA_JSON?.trim());
  if (!configured) {
    return { configured, reachable: null, folderSearchAvailable: null, matchedRootAvailable: null, errorType: "missing_env" };
  }
  try {
    const result = driveProbe ? await driveProbe() : await defaultDriveProbe(env);
    return {
      configured,
      reachable: result.reachable,
      folderSearchAvailable: result.folderSearchAvailable,
      matchedRootAvailable: result.matchedRootAvailable,
      errorType: result.reachable ? null : "drive_unreachable",
    };
  } catch (error) {
    return { configured, reachable: false, folderSearchAvailable: false, matchedRootAvailable: false, errorType: driveErrorType(error) };
  }
}

async function checkGoogleCloud(env: NodeJS.ProcessEnv): Promise<IntegrationsHealthPayload["services"]["googleCloud"]> {
  const configured = Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim() || env.GOOGLE_SA_JSON?.trim() || env.GOOGLE_CLIENT_ID?.trim());
  return {
    configured,
    reachable: configured ? null : null,
    errorType: configured ? "no_safe_ping_available" : "missing_env",
  };
}

async function checkAgents(env: NodeJS.ProcessEnv): Promise<IntegrationsHealthPayload["services"]["agents"]> {
  return {
    configured: Boolean(env.OPENAI_API_KEY?.trim()),
    available: true,
    errorType: null,
  };
}

async function checkFetchService(params: {
  configured: boolean;
  model?: string | null;
  ping: () => Promise<{ ok: boolean; status?: number }>;
}): Promise<ServiceHealth & { model?: string | null }> {
  try {
    const response = await params.ping();
    return {
      configured: params.configured,
      reachable: response.ok,
      model: params.model,
      errorType: response.ok ? null : statusErrorType(response.status),
    };
  } catch (error) {
    return {
      configured: params.configured,
      reachable: false,
      model: params.model,
      errorType: errorType(error),
    };
  }
}

async function defaultDriveProbe(env: NodeJS.ProcessEnv) {
  const driveId = env.GOOGLE_SHARED_DRIVE_ID?.trim();
  const roots = getConfiguredDriveRootFolders();
  if (!driveId || roots.length === 0) {
    return {
      reachable: false,
      folderSearchAvailable: false,
      matchedRootAvailable: false,
      canReturnDocumentMetadata: false,
      canReturnDocumentContentOrSnippet: false,
    };
  }
  const auth = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });
  const root = roots[0];
  const metadata = await drive.files.get({
    fileId: root.id,
    supportsAllDrives: true,
    fields: "id,name,mimeType",
  });
  const list = await drive.files.list({
    corpora: "drive",
    driveId,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${root.id}' in parents and trashed = false`,
    pageSize: 1,
    fields: "files(id,name,mimeType)",
  });
  return {
    reachable: Boolean(metadata.data.id),
    folderSearchAvailable: true,
    matchedRootAvailable: Boolean(metadata.data.id),
    canReturnDocumentMetadata: Boolean(list.data.files?.[0]?.id || metadata.data.id),
    canReturnDocumentContentOrSnippet: Boolean(list.data.files?.length),
  };
}

async function defaultProbeFetch(url: string, init: RequestInit): Promise<{ ok: boolean; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function statusErrorType(status?: number) {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status && status >= 500) return "provider_unavailable";
  return "request_failed";
}

function errorType(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code ?? "").toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (code.includes("abort") || message.includes("abort") || message.includes("timeout")) return "timeout";
  if (code === "401" || code === "403" || message.includes("unauthorized") || message.includes("forbidden")) return "auth_failed";
  if (message.includes("missing")) return "missing_env";
  if (message.includes("network") || message.includes("fetch failed")) return "network_error";
  return "request_failed";
}

export function driveErrorType(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const response = record.response && typeof record.response === "object"
    ? record.response as Record<string, unknown>
    : {};
  const responseData = response.data && typeof response.data === "object"
    ? response.data as Record<string, unknown>
    : {};
  const apiError = responseData.error && typeof responseData.error === "object"
    ? responseData.error as Record<string, unknown>
    : {};
  const errors = Array.isArray(apiError.errors)
    ? apiError.errors.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
  const status = Number(record.code ?? response.status ?? apiError.code ?? 0);
  const reasonText = [
    record.code,
    record.status,
    record.statusText,
    apiError.status,
    record.message,
    apiError.message,
    ...errors.flatMap((item) => [item.reason, item.message, item.domain]),
    error instanceof Error ? error.message : String(error),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (reasonText.includes("accessnotconfigured") || reasonText.includes("api has not been used") || reasonText.includes("disabled")) {
    return "drive_api_disabled";
  }
  if (reasonText.includes("invalid_grant") || reasonText.includes("jwt") || reasonText.includes("invalid credentials")) {
    return "service_account_auth_failed";
  }
  if (reasonText.includes("unauthorized_client") || reasonText.includes("client is unauthorized") || reasonText.includes("not authorized to access this resource/api")) {
    return "domain_delegation_failed";
  }
  if (reasonText.includes("delegation") || reasonText.includes("subject") || reasonText.includes("impersonat")) {
    return "impersonation_failed";
  }
  if (status === 429 || reasonText.includes("rate limit") || reasonText.includes("ratelimitexceeded") || reasonText.includes("userratelimitexceeded")) {
    return "rate_limited";
  }
  if (status === 404 || reasonText.includes("filenotfound") || reasonText.includes("not found")) {
    return "folder_not_found";
  }
  if (reasonText.includes("invalid sharing request") || reasonText.includes("invalid folder") || reasonText.includes("invalid file id") || reasonText.includes("malformed")) {
    return "invalid_folder_id";
  }
  if (status === 401) {
    return "service_account_auth_failed";
  }
  if (status === 403) {
    if (reasonText.includes("shared drive") || reasonText.includes("driveid") || reasonText.includes("teamdrive")) {
      return "shared_drive_access_denied";
    }
    return "folder_access_denied";
  }

  return errorType(error);
}

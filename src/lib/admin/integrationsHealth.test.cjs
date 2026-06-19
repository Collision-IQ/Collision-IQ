/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function registerTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { buildIntegrationsHealth } = require("./integrationsHealth.ts");

const tests = [];

function run(name, test) {
  tests.push({ name, test });
}

const baseEnv = {
  OPENAI_API_KEY: "sk-test-openai-secret",
  ANTHROPIC_API_KEY: "anthropic-secret",
  GOOGLE_DRIVE_ENABLED: "true",
  GOOGLE_SHARED_DRIVE_ID: "drive-id-secret",
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: "service-account-secret",
  GOOGLE_IMPERSONATION_USER: "user@example.com",
  GOOGLE_OEM_PROCEDURES_FOLDER_ID: "folder-one-secret",
  GOOGLE_OEM_POSITION_STATEMENTS_FOLDER_ID: "folder-two-secret",
  ELEVENLABS_API_KEY: "eleven-secret",
  STRIPE_SECRET_KEY: "stripe-secret",
  STRIPE_WEBHOOK_SECRET: "webhook-secret",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
  CLERK_SECRET_KEY: "clerk-secret",
  DATABASE_URL: "postgres://user:pass@example.neon.tech/db",
};

run("integrations health returns safe service statuses and inventory booleans", async () => {
  const payload = await buildIntegrationsHealth({
    env: baseEnv,
    now: new Date("2026-06-18T12:00:00.000Z"),
    probeFetch: async () => ({ ok: true, status: 200 }),
    databasePing: async () => undefined,
    stripePing: async () => undefined,
    driveProbe: async () => ({
      reachable: true,
      folderSearchAvailable: true,
      matchedRootAvailable: true,
      canReturnDocumentMetadata: true,
      canReturnDocumentContentOrSnippet: true,
    }),
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.checkedAt, "2026-06-18T12:00:00.000Z");
  assert.equal(payload.services.openai.configured, true);
  assert.equal(payload.services.openai.reachable, true);
  assert.equal(payload.services.googleDrive.folderSearchAvailable, true);
  assert.equal(payload.services.authorityRetrieval.googleDriveAvailable, true);
  assert.equal(payload.services.stripe.webhookConfigured, true);
  const driveInventory = payload.inventory.find((item) => item.integration === "Google Drive authority retrieval");
  assert.ok(driveInventory);
  assert.equal(driveInventory.envPresent.GOOGLE_SHARED_DRIVE_ID, true);
});

run("integrations health output does not expose configured secret values", async () => {
  const payload = await buildIntegrationsHealth({
    env: baseEnv,
    probeFetch: async () => ({ ok: false, status: 401 }),
    databasePing: async () => undefined,
    stripePing: async () => undefined,
    driveProbe: async () => ({
      reachable: false,
      folderSearchAvailable: false,
      matchedRootAvailable: false,
      canReturnDocumentMetadata: false,
      canReturnDocumentContentOrSnippet: false,
    }),
  });
  const serialized = JSON.stringify(payload);

  for (const secret of Object.values(baseEnv).filter((value) => value.length > 4 && value !== "true")) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
  assert.match(serialized, /auth_failed|drive_unreachable/);
});

run("integrations health route requires platform admin and returns safe payload", async () => {
  const originalLoad = Module._load;
  const routePath = path.join(process.cwd(), "src", "app", "api", "admin", "integrations-health", "route.ts");
  delete require.cache[require.resolve(routePath)];
  Module._load = function loadWithRouteMocks(request, parent, isMain) {
    if (request === "@/lib/auth/require-current-user") {
      class UnauthorizedError extends Error {
        constructor(message, status = 401) {
          super(message);
          this.status = status;
        }
      }
      return {
        UnauthorizedError,
        requireCurrentUser: async () => ({ isPlatformAdmin: true }),
      };
    }
    if (request === "@/lib/admin/integrationsHealth") {
      return {
        buildIntegrationsHealth: async () => ({
          ok: true,
          checkedAt: "2026-06-18T12:00:00.000Z",
          services: {
            openai: { configured: true, reachable: true, model: "gpt-5.5", errorType: null },
            anthropic: { configured: false, reachable: null, model: null, errorType: "missing_env" },
            googleDrive: { configured: false, reachable: null, folderSearchAvailable: null, matchedRootAvailable: null, errorType: "missing_env" },
            googleCloud: { configured: false, reachable: null, errorType: "missing_env" },
            elevenLabs: { configured: false, reachable: null, errorType: "missing_env" },
            stripe: { configured: false, reachable: null, webhookConfigured: false, errorType: "missing_env" },
            clerk: { configured: true, reachable: true, errorType: null },
            database: { configured: true, reachable: true, pooled: true, errorType: null },
            agents: { configured: true, available: true, errorType: null },
            authorityRetrieval: {
              googleDriveAvailable: false,
              makeModelFolderSearchAvailable: false,
              canSearchByMakeModel: false,
              canReturnDocumentMetadata: false,
              canReturnDocumentContentOrSnippet: false,
              errorType: "missing_env",
            },
          },
          inventory: [],
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const route = require(routePath);
    const response = await route.GET();
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.services.openai.model, "gpt-5.5");
    assert.equal(json.services.authorityRetrieval.googleDriveAvailable, false);
  } finally {
    Module._load = originalLoad;
  }
});

(async () => {
  for (const { name, test } of tests) {
    try {
      await test();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }
})();

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
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const MODEL_CONFIG_PATH = path.join(process.cwd(), "src", "lib", "modelConfig.ts");
const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "COLLISION_IQ_PRIMARY_PROVIDER",
  "COLLISION_IQ_MODEL_PRIMARY",
  "COLLISION_IQ_MODEL",
  "COLLISION_IQ_MODEL_HELPER",
  "COLLISION_IQ_SUPPLEMENT_MODEL",
  "OPENCLAW_GATEWAY_URL",
  "OPENAI_API_KEY",
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function loadModelConfig(env) {
  for (const key of ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      process.env[key] = env[key];
    } else {
      delete process.env[key];
    }
  }
  delete require.cache[require.resolve(MODEL_CONFIG_PATH)];
  return require(MODEL_CONFIG_PATH);
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  delete require.cache[require.resolve(MODEL_CONFIG_PATH)];
}

function run(name, test) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    restoreEnv();
  }
}

run("Anthropic/Claude is the default primary provider after migration", () => {
  const { collisionIqProvider, collisionIqModels } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    ANTHROPIC_API_KEY: "test-key",
  });

  assert.equal(collisionIqProvider.primary, "anthropic");
  assert.equal(collisionIqModels.anthropicPrimary, "claude-fable-5");
});

run("OpenAI remains available as an explicit opt-in provider (gpt-5.5)", () => {
  const { collisionIqModels, collisionIqProvider, getCollisionIqModelStartupDiagnostics } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    COLLISION_IQ_PRIMARY_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
  });

  assert.equal(collisionIqProvider.primary, "openai");
  assert.equal(collisionIqModels.primary, "gpt-5.5");
  assert.equal(collisionIqModels.helper, "gpt-5.5");
  assert.equal(collisionIqModels.supplement, "gpt-5.5");
  assert.deepEqual(
    getCollisionIqModelStartupDiagnostics().map((item) => ({
      provider: item.provider,
      model: item.model,
      fallbackUsed: item.fallbackUsed,
      keyPresent: item.keyPresent,
    })),
    [
      { provider: "openai", model: "gpt-5.5", fallbackUsed: true, keyPresent: true },
      { provider: "openai", model: "gpt-5.5", fallbackUsed: true, keyPresent: true },
      { provider: "openai", model: "gpt-5.5", fallbackUsed: true, keyPresent: true },
    ]
  );
});

run("GPT-5.5 Responses payload omits unsupported sampling parameters", () => {
  const { buildOpenAiResponsesRequest } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    OPENAI_API_KEY: "test-key",
  });

  const request = buildOpenAiResponsesRequest({
    model: "gpt-5.5",
    temperature: 0.7,
    top_p: 0.9,
    input: "Review the repair estimate.",
    reasoning: { effort: "medium" },
    tools: [{ type: "web_search_preview" }],
  });

  assert.equal(request.model, "gpt-5.5");
  assert.equal(request.input, "Review the repair estimate.");
  assert.deepEqual(request.reasoning, { effort: "medium" });
  assert.deepEqual(request.tools, [{ type: "web_search_preview" }]);
  assert.equal(Object.hasOwn(request, "temperature"), false);
  assert.equal(Object.hasOwn(request, "top_p"), false);
});

run("GPT-5.5 Responses payload normalizes assistant history to output_text", () => {
  const { buildOpenAiResponsesRequest } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    OPENAI_API_KEY: "test-key",
  });

  const request = buildOpenAiResponsesRequest({
    model: "gpt-5.5",
    temperature: 0.2,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "What changed?" }],
      },
      {
        role: "assistant",
        content: [{ type: "input_text", text: "The estimate gap changed." }],
      },
    ],
    reasoning: { effort: "medium" },
    tools: [{ type: "web_search_preview" }],
  });

  assert.equal(Object.hasOwn(request, "temperature"), false);
  assert.equal(request.model, "gpt-5.5");
  assert.deepEqual(request.reasoning, { effort: "medium" });
  assert.deepEqual(request.tools, [{ type: "web_search_preview" }]);
  assert.equal(request.input[0].content[0].type, "input_text");
  assert.equal(request.input[1].content[0].type, "output_text");
});

run("explicit non-GPT-5.5 Responses model keeps supported temperature", () => {
  const {
    buildOpenAiResponsesRequest,
    supportsOpenAiResponsesSamplingParameters,
  } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    OPENAI_API_KEY: "test-key",
  });

  assert.equal(supportsOpenAiResponsesSamplingParameters("gpt-4.1"), true);
  const request = buildOpenAiResponsesRequest({
    model: "gpt-4.1",
    temperature: 0.2,
    input: "Summarize the file.",
  });

  assert.equal(request.temperature, 0.2);
});

run("analysis supplement candidates do not default to stale mini model", () => {
  const { collisionIqModels } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    OPENAI_API_KEY: "test-key",
  });

  const supplementModel = collisionIqModels.supplement;
  const staleMiniModel = `gpt-${"5.4"}-mini`;
  assert.equal(supplementModel, "gpt-5.5");
  assert.notEqual(supplementModel, staleMiniModel);
});

run("explicit lower-cost helper override is allowed but not silent fallback", () => {
  const { collisionIqModels, getCollisionIqModelDiagnostic } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    OPENAI_API_KEY: "test-key",
    COLLISION_IQ_MODEL_HELPER: "gpt-5.5-fast",
  });

  const diagnostic = getCollisionIqModelDiagnostic({
    stage: "analysis_supplement_candidates",
    provider: "openai",
    role: "helper",
    model: collisionIqModels.helper,
  });

  assert.equal(collisionIqModels.helper, "gpt-5.5-fast");
  assert.equal(diagnostic.fallbackUsed, false);
  assert.equal(diagnostic.envKey, "COLLISION_IQ_MODEL_HELPER");
});

run("production OpenClaw local default falls back to OpenAI", () => {
  const { collisionIqProvider, collisionIqModels } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    COLLISION_IQ_PRIMARY_PROVIDER: "openclaw",
    OPENAI_API_KEY: "test-key",
  });

  assert.equal(collisionIqProvider.primary, "openai");
  assert.equal(collisionIqModels.primary, "gpt-5.5");
});

run("production OpenClaw requires explicit non-local service URL", () => {
  const { collisionIqProvider } = loadModelConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    COLLISION_IQ_PRIMARY_PROVIDER: "openclaw",
    OPENCLAW_GATEWAY_URL: "https://openclaw.example.test",
  });

  assert.equal(collisionIqProvider.primary, "openclaw");
});

run("Citation Density prompt path uses configured Claude model routing", () => {
  const files = [
    "src/app/api/reports/citation-density/annotated-estimate/route.ts",
    "src/app/api/reports/oem-citation-density/annotated-estimate/route.ts",
    "src/lib/ai/openaiPromptRunner.ts",
  ];
  const combined = files.map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");

  const stalePattern = new RegExp(`\\bgpt-${"5\\.4"}(?:-(?:mini|nano))?\\b`, "i");
  assert.doesNotMatch(combined, stalePattern);
  assert.match(combined, /collisionIqModels\.anthropicPrimary/);
  assert.match(combined, /logCollisionIqModelDiagnostic/);
});

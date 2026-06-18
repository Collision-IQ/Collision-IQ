#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://www.collision-iq.ai";
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bpk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /\beyJ[A-Za-z0-9._-]{20,}\b/,
];

main().catch((error) => {
  console.error("[analysis-smoke] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

async function main() {
  const authHeaders = readAuthHeaders();
  const baseUrl = (process.env.ANALYSIS_SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const payload = buildPayload();

  const response = await fetch(`${baseUrl}/api/analysis`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  const parsed = parseJson(responseText);
  if (containsSecret(responseText)) {
    throw new Error("Smoke response appears to contain a secret-like value.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Authentication failed (${response.status}). Use a current production Clerk browser session cookie via ANALYSIS_SMOKE_COOKIE, or a Clerk session JWT accepted by this deployment via ANALYSIS_SMOKE_BEARER_TOKEN/CLERK_SESSION_JWT. Do not use Clerk API keys, OAuth access tokens, or template JWTs from a different Clerk instance.`
    );
  }
  if (!response.ok) {
    const code = parsed && typeof parsed === "object" ? parsed.error || parsed.code || parsed.message : null;
    throw new Error(`Analysis request failed (${response.status})${code ? `: ${code}` : ""}.`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Analysis response was not valid JSON.");
  }

  assertNoContextLengthFailure(parsed);
  const modelDiagnostics = assertModelDiagnostics(parsed.modelDiagnostics);
  const contextBudget = assertContextBudgetDiagnostics(parsed.contextBudget);
  assertGeneratedReportsExcluded(contextBudget);
  assertPolicyDocsBudgeted(contextBudget);
  assertFileDiagnostics(contextBudget);

  console.log("[analysis-smoke] ok", {
    baseUrl,
    reportIdPresent: Boolean(parsed.reportId),
    providerModels: modelDiagnostics.map((entry) => ({
      stage: entry.stage,
      provider: entry.provider,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort,
      fallbackUsed: entry.fallbackUsed,
      keyPresent: entry.keyPresent,
    })),
    contextBudget: {
      rawAttachmentTextChars: contextBudget.rawAttachmentTextChars,
      selectedContextTextChars: contextBudget.selectedContextTextChars,
      droppedContextChars: contextBudget.droppedContextChars,
      contextBudgetLimit: contextBudget.contextBudgetLimit,
      contextReductionApplied: contextBudget.contextReductionApplied,
      generatedReportArtifactExcluded: contextBudget.generatedReportArtifactExcluded,
      policyExtractionConfidence: contextBudget.policyExtractionConfidence,
      policyVehicleMismatchPresent: Boolean(contextBudget.policyVehicleMismatch),
      attachmentCount: contextBudget.attachmentClassifications.length,
      excludedPrimaryCount: contextBudget.attachmentClassifications.filter((item) => item.excludedAsPrimary).length,
    },
  });
}

function buildPayload() {
  const payloadPath = process.env.ANALYSIS_SMOKE_PAYLOAD_JSON?.trim();
  if (payloadPath) {
    const absolute = path.resolve(payloadPath);
    const payload = parseJson(fs.readFileSync(absolute, "utf8"));
    if (!payload || typeof payload !== "object") {
      throw new Error("ANALYSIS_SMOKE_PAYLOAD_JSON must point to a JSON object.");
    }
    return payload;
  }

  const artifactIds = (process.env.ANALYSIS_SMOKE_ARTIFACT_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!artifactIds.length) {
    throw new Error("Set ANALYSIS_SMOKE_ARTIFACT_IDS to comma-separated uploaded attachment ids, or provide ANALYSIS_SMOKE_PAYLOAD_JSON.");
  }

  return {
    artifactIds,
    activeCaseId: process.env.ANALYSIS_SMOKE_ACTIVE_CASE_ID?.trim() || null,
    userIntent: process.env.ANALYSIS_SMOKE_USER_INTENT?.trim() ||
      "Production smoke: verify analysis context budget, generated-report exclusion, policy chunking, estimator reasoning, and provider diagnostics.",
    reviewProgress: {
      uploaded: artifactIds.length,
      indexed: artifactIds.length,
      visionProcessed: 0,
      reviewedForDetermination: 0,
      reviewableFileCount: artifactIds.length,
      excludedFromReviewCount: 0,
      excludedFromReviewFiles: [],
      excludedFromReviewReasons: [],
      totalKnownFiles: artifactIds.length,
    },
  };
}

function readRequiredEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Set one of: ${names.join(", ")}. Do not commit this value.`);
}

function readAuthHeaders() {
  const cookie = process.env.ANALYSIS_SMOKE_COOKIE?.trim();
  if (cookie) {
    return { cookie };
  }

  const token = readRequiredEnv(["ANALYSIS_SMOKE_BEARER_TOKEN", "CLERK_SESSION_JWT"]);
  return { authorization: `Bearer ${token}` };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function containsSecret(value) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function assertNoContextLengthFailure(response) {
  const serialized = JSON.stringify(response);
  if (/context_length_exceeded/i.test(serialized)) {
    throw new Error("Response contains context_length_exceeded.");
  }
  if (response.error === "CONTEXT_BUDGET_EXCEEDED") {
    throw new Error("Analysis blocked with CONTEXT_BUDGET_EXCEEDED.");
  }
}

function assertModelDiagnostics(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Response missing modelDiagnostics.");
  }
  for (const entry of value) {
    if (entry.provider !== "openai") {
      throw new Error(`Expected OpenAI provider, saw ${entry.provider}.`);
    }
    if (entry.model !== "gpt-5.5") {
      throw new Error(`Expected gpt-5.5 model, saw ${entry.model}.`);
    }
    for (const key of ["stage", "reasoningEffort", "fallbackUsed", "keyPresent"]) {
      if (!(key in entry)) throw new Error(`Model diagnostic missing ${key}.`);
    }
  }
  return value;
}

function assertContextBudgetDiagnostics(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Response missing contextBudget diagnostics.");
  }
  for (const key of [
    "rawAttachmentTextChars",
    "selectedContextTextChars",
    "droppedContextChars",
    "contextBudgetLimit",
    "contextReductionApplied",
    "generatedReportArtifactExcluded",
    "attachmentClassifications",
    "toolUsageTrace",
  ]) {
    if (!(key in value)) throw new Error(`Context budget missing ${key}.`);
  }
  if (!Array.isArray(value.attachmentClassifications) || value.attachmentClassifications.length === 0) {
    throw new Error("Context budget missing attachment classifications.");
  }
  return value;
}

function assertGeneratedReportsExcluded(contextBudget) {
  const reports = contextBudget.attachmentClassifications.filter((item) =>
    item.documentClass === "generated_report_artifact"
  );
  if (reports.some((item) => !item.excludedAsPrimary)) {
    throw new Error("Generated report artifact was not excluded as primary evidence.");
  }
}

function assertPolicyDocsBudgeted(contextBudget) {
  const policies = contextBudget.attachmentClassifications.filter((item) =>
    item.documentClass === "policy_document"
  );
  for (const policy of policies) {
    if (policy.rawTextChars > 12000 && policy.selectedTextChars >= policy.rawTextChars) {
      throw new Error("Large policy document was not reduced/chunked before analysis.");
    }
  }
}

function assertFileDiagnostics(contextBudget) {
  for (const item of contextBudget.attachmentClassifications) {
    for (const key of ["filename", "documentClass", "rawTextChars", "selectedTextChars", "excludedAsPrimary"]) {
      if (!(key in item)) throw new Error(`Attachment classification missing ${key}.`);
    }
  }
}

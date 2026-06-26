import "server-only";
import {
  collisionIqModels,
  collisionIqProvider,
  logCollisionIqModelDiagnostic,
  type CollisionIqPrimaryProvider,
} from "@/lib/modelConfig";
import {
  generateClaudeMessage,
  responsesInputToClaudeMessages,
  type ClaudeEffort,
  type ResponsesInput,
} from "@/lib/anthropic";

type OpenClawModule = {
  generateOpenClawText(params: {
    instructions?: string;
    input: unknown;
  }): Promise<{ output_text: string; model: string }>;
  getOpenClawAvailability(): {
    available: boolean;
    command: string;
    entryJs: string;
    description: string;
    reason?: string;
  };
};

export type ProviderTextGenerationResult = {
  output_text: string;
  provider: CollisionIqPrimaryProvider;
  model: string;
};

// `openai` and `temperature` are retained in the call signatures for backward
// compatibility with existing call sites, but are ignored — Claude is the
// primary provider and rejects sampling parameters. They will be removed as
// call sites are cleaned up.
type LegacyOpenAiArg = unknown;

export async function generatePrimaryText(params: {
  openai?: LegacyOpenAiArg;
  stage: string;
  instructions?: string;
  input: ResponsesInput;
  temperature?: number;
  effort?: ClaudeEffort;
  maxTokens?: number;
}): Promise<ProviderTextGenerationResult> {
  if (collisionIqProvider.primary === "openclaw") {
    const openclawResult = await tryOpenClaw({
      stage: params.stage,
      instructions: params.instructions,
      input: params.input,
    });
    if (openclawResult) return openclawResult;
  }

  return generateAnthropicText({
    stage: params.stage,
    instructions: params.instructions,
    input: params.input,
    effort: params.effort,
    maxTokens: params.maxTokens,
  });
}

export async function generateSupplementText(params: {
  openai?: LegacyOpenAiArg;
  stage: string;
  openAiModel?: string;
  input: ResponsesInput;
  temperature?: number;
  effort?: ClaudeEffort;
  maxTokens?: number;
}): Promise<ProviderTextGenerationResult> {
  if (collisionIqProvider.primary === "openclaw") {
    const openclawResult = await tryOpenClaw({
      stage: params.stage,
      input: params.input,
    });
    if (openclawResult) return openclawResult;
  }

  return generateAnthropicText({
    stage: params.stage,
    input: params.input,
    effort: params.effort,
    maxTokens: params.maxTokens,
  });
}

async function tryOpenClaw(params: {
  stage: string;
  instructions?: string;
  input: ResponsesInput;
}): Promise<ProviderTextGenerationResult | null> {
  const { generateOpenClawText, getOpenClawAvailability } = await loadOpenClawModule();
  const openclaw = getOpenClawAvailability();
  if (!openclaw.available) {
    console.warn("[provider-routing] OpenClaw configured but unavailable; falling back to Claude.", {
      stage: params.stage,
      reason: openclaw.reason,
      command: openclaw.command,
      entryJs: openclaw.entryJs,
    });
    return null;
  }

  logCollisionIqModelDiagnostic({
    stage: params.stage,
    provider: "openclaw",
    role: "openclawPrimary",
    model: collisionIqModels.openclawPrimary,
  });
  const response = await generateOpenClawText({
    instructions: params.instructions,
    input: params.input,
  });

  return {
    output_text: response.output_text,
    provider: "openclaw",
    model: response.model,
  };
}

async function loadOpenClawModule(): Promise<OpenClawModule> {
  return await import(/* webpackIgnore: true */ "../openclaw") as OpenClawModule;
}

async function generateAnthropicText(params: {
  stage: string;
  instructions?: string;
  input: ResponsesInput;
  effort?: ClaudeEffort;
  maxTokens?: number;
}): Promise<ProviderTextGenerationResult> {
  const model = collisionIqModels.anthropicPrimary;
  logCollisionIqModelDiagnostic({
    stage: params.stage,
    provider: "anthropic",
    role: "anthropicPrimary",
    model,
  });

  const result = await generateClaudeMessage({
    model,
    system: params.instructions,
    messages: responsesInputToClaudeMessages(params.input),
    effort: params.effort,
    maxTokens: params.maxTokens,
  });

  return {
    output_text: result.text,
    provider: "anthropic",
    model: result.model,
  };
}

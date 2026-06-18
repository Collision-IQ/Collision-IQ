import "server-only";
import type OpenAI from "openai";
import {
  collisionIqModels,
  collisionIqProvider,
  logCollisionIqModelDiagnostic,
  type CollisionIqPrimaryProvider,
} from "@/lib/modelConfig";
import { generateOpenClawText, getOpenClawAvailability } from "@/lib/openclaw";

type OpenAIResponseInput = Parameters<OpenAI["responses"]["create"]>[0];

export type ProviderTextGenerationResult = {
  output_text: string;
  provider: CollisionIqPrimaryProvider;
  model: string;
};

export async function generatePrimaryText(params: {
  openai: OpenAI;
  stage: string;
  instructions?: string;
  input: OpenAIResponseInput["input"];
  temperature?: number;
}): Promise<ProviderTextGenerationResult> {
  if (collisionIqProvider.primary === "anthropic") {
    return generateAnthropicText({
      stage: params.stage,
      instructions: params.instructions,
      input: params.input,
      temperature: params.temperature,
    });
  }

  if (collisionIqProvider.primary === "openclaw") {
    const openclaw = getOpenClawAvailability();
    if (openclaw.available) {
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

    console.warn("[provider-routing] OpenClaw configured but unavailable; falling back to OpenAI.", {
      stage: params.stage,
      reason: openclaw.reason,
      command: openclaw.command,
      entryJs: openclaw.entryJs,
    });
  }

  logCollisionIqModelDiagnostic({
    stage: params.stage,
    provider: "openai",
    role: "primary",
    model: collisionIqModels.primary,
  });
  const response = await params.openai.responses.create({
    model: collisionIqModels.primary,
    instructions: params.instructions,
    temperature: params.temperature,
    input: params.input,
  });

  return {
    output_text: response.output_text ?? "",
    provider: "openai",
    model: collisionIqModels.primary,
  };
}

export async function generateSupplementText(params: {
  openai: OpenAI;
  stage: string;
  openAiModel: string;
  input: OpenAIResponseInput["input"];
  temperature?: number;
}): Promise<ProviderTextGenerationResult> {
  if (collisionIqProvider.primary === "anthropic") {
    return generateAnthropicText({
      stage: params.stage,
      input: params.input,
      temperature: params.temperature,
    });
  }

  if (collisionIqProvider.primary === "openclaw") {
    const openclaw = getOpenClawAvailability();
    if (openclaw.available) {
      logCollisionIqModelDiagnostic({
        stage: params.stage,
        provider: "openclaw",
        role: "openclawPrimary",
        model: collisionIqModels.openclawPrimary,
      });
      const response = await generateOpenClawText({
        input: params.input,
      });

      return {
        output_text: response.output_text,
        provider: "openclaw",
        model: response.model,
      };
    }

    console.warn("[provider-routing] OpenClaw configured but unavailable; falling back to OpenAI.", {
      stage: params.stage,
      reason: openclaw.reason,
      command: openclaw.command,
      entryJs: openclaw.entryJs,
    });
  }

  logCollisionIqModelDiagnostic({
    stage: params.stage,
    provider: "openai",
    role: params.openAiModel === collisionIqModels.supplement
      ? "supplement"
      : params.openAiModel === collisionIqModels.helper
        ? "helper"
        : "primary",
    model: params.openAiModel,
  });
  const response = await params.openai.responses.create({
    model: params.openAiModel,
    temperature: params.temperature,
    input: params.input,
  });

  return {
    output_text: response.output_text ?? "",
    provider: "openai",
    model: params.openAiModel,
  };
}

async function generateAnthropicText(params: {
  stage: string;
  instructions?: string;
  input: OpenAIResponseInput["input"];
  temperature?: number;
}): Promise<ProviderTextGenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when COLLISION_IQ_PRIMARY_PROVIDER=anthropic.");
  }

  const model = collisionIqModels.anthropicPrimary;
  logCollisionIqModelDiagnostic({
    stage: params.stage,
    provider: "anthropic",
    role: "anthropicPrimary",
    model,
  });
  const response = await fetch(`${collisionIqProvider.anthropicBaseUrl.replace(/\/+$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: params.temperature,
      system: params.instructions || undefined,
      messages: [
        {
          role: "user",
          content: openAiInputToText(params.input),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw Object.assign(new Error(`Anthropic request failed (${response.status}).`), {
      status: response.status,
      statusCode: response.status,
      code: "anthropic_request_failed",
      provider: "anthropic",
      body: body.slice(0, 500),
    });
  }

  const data = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
  };

  return {
    output_text: data.content
      ?.filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim() ?? "",
    provider: "anthropic",
    model,
  };
}

function openAiInputToText(input: OpenAIResponseInput["input"]) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input.map((message) => {
    if (!message || typeof message !== "object") return "";
    const role = "role" in message ? String(message.role) : "user";
    const content = "content" in message ? message.content : "";
    return `[${role}]\n${openAiContentToText(content)}`;
  }).filter(Boolean).join("\n\n");
}

function openAiContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    if ("text" in part && typeof part.text === "string") return part.text;
    if ("type" in part && part.type === "input_image") return "[Image input omitted from Anthropic text route.]";
    if ("type" in part && part.type === "input_file") return "[File input omitted from Anthropic text route.]";
    return "";
  }).filter(Boolean).join("\n");
}

// src/lib/anthropic.ts
//
// Shared Anthropic (Claude) client + helpers for Collision IQ.
//
// This is the single choke point for all Claude text generation. It replaces
// the previous OpenAI Responses API integration. Key design points:
//   - Uses the official @anthropic-ai/sdk.
//   - Defaults to claude-opus-4-8 (see modelConfig.ANTHROPIC_MODEL_FALLBACK).
//   - Streams every request and uses .finalMessage() so large reports never
//     hit HTTP idle timeouts (max_tokens can be well above 16k).
//   - Adaptive thinking is on by default with high effort for the dense,
//     forensic report work that drives Collision IQ accuracy.
//   - NEVER passes temperature / top_p / top_k (rejected with 400 on
//     claude-opus-4-8 / 4.7 and Fable 5).

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  classifyRetryableProviderError,
  type RetryableProviderErrorDetails,
} from "@/lib/ai/providerRetryableError";
import { collisionIqModels, collisionIqProvider } from "@/lib/modelConfig";

let anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey,
      baseURL: collisionIqProvider.anthropicBaseUrl,
      maxRetries: 2,
    });
  }

  return anthropicClient;
}

export function classifyAnthropicProviderError(
  error: unknown,
  stage = "anthropic"
): RetryableProviderErrorDetails {
  return classifyRetryableProviderError(error, {
    provider: "anthropic",
    stage,
  });
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    return Reflect.get(getAnthropicClient(), prop, receiver);
  },
});

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type GenerateClaudeMessageParams = {
  /** Top-level system prompt (Claude `system`). */
  system?: string;
  /** Claude-format message turns. */
  messages: Anthropic.MessageParam[];
  /** Override the model; defaults to the configured Anthropic primary. */
  model?: string;
  /** Output cap. Streamed, so large values are safe. */
  maxTokens?: number;
  /** Reasoning/thoroughness dial. Defaults to "high" for report quality. */
  effort?: ClaudeEffort;
  /** Set false to disable adaptive thinking (e.g. terse classification). */
  thinking?: boolean;
};

export type GenerateClaudeMessageResult = {
  text: string;
  model: string;
  stopReason: string | null;
};

/**
 * Core Claude text generation. Streams the request, returns the joined text of
 * all text blocks. Adaptive thinking + high effort by default.
 */
export async function generateClaudeMessage(
  params: GenerateClaudeMessageParams
): Promise<GenerateClaudeMessageResult> {
  const model = params.model ?? collisionIqModels.anthropicPrimary;
  const maxTokens = params.maxTokens ?? 32000;

  const stream = getAnthropicClient().messages.stream({
    model,
    max_tokens: maxTokens,
    ...(params.system ? { system: params.system } : {}),
    messages: params.messages,
    ...(params.thinking === false ? {} : { thinking: { type: "adaptive" } }),
    output_config: { effort: params.effort ?? "high" },
  });

  const message = await stream.finalMessage();

  const text = message.content
    .filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

  return {
    text,
    model: message.model ?? model,
    stopReason: message.stop_reason ?? null,
  };
}

// ---------------------------------------------------------------------------
// OpenAI Responses input -> Claude content conversion
//
// The rest of the codebase still builds prompt content in the OpenAI Responses
// "input" shape (arrays of { role, content: [{type:"input_text"|"input_image"
// |"input_file", ...}] }). Rather than rewrite every call site, we translate
// that shape into Claude content blocks here so images and PDFs flow through
// to Claude vision instead of being dropped.
// ---------------------------------------------------------------------------

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export type ResponsesContentPart = Record<string, unknown>;
export type ResponsesInputItem = {
  role?: string;
  content?: string | ResponsesContentPart[];
};
export type ResponsesInput = string | ResponsesInputItem[] | ResponsesContentPart[];

function parseDataUrl(value: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.*)$/s.exec(value.trim());
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), data: match[2] };
}

function convertContentPart(
  part: ResponsesContentPart
): Anthropic.ContentBlockParam[] {
  const type = typeof part.type === "string" ? part.type : "";

  if (type === "input_text" || type === "output_text" || type === "text") {
    const text = typeof part.text === "string" ? part.text : "";
    return text ? [{ type: "text", text }] : [];
  }

  if (type === "input_image") {
    const url = typeof part.image_url === "string" ? part.image_url : "";
    if (!url) return [];
    const parsed = parseDataUrl(url);
    if (parsed && SUPPORTED_IMAGE_MEDIA_TYPES.has(parsed.mediaType)) {
      return [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: parsed.mediaType as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
            data: parsed.data,
          },
        },
      ];
    }
    if (/^https?:\/\//i.test(url)) {
      return [{ type: "image", source: { type: "url", url } }];
    }
    return [
      { type: "text", text: "[Image input could not be decoded for Claude.]" },
    ];
  }

  if (type === "input_file") {
    const fileData = typeof part.file_data === "string" ? part.file_data : "";
    const parsed = fileData ? parseDataUrl(fileData) : null;
    if (parsed && parsed.mediaType === "application/pdf") {
      return [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: parsed.data },
        },
      ];
    }
    const filename = typeof part.filename === "string" ? part.filename : "file";
    return [{ type: "text", text: `[File input ${filename} could not be decoded for Claude.]` }];
  }

  // Unknown shape with a text field — best-effort.
  if (typeof part.text === "string" && part.text) {
    return [{ type: "text", text: part.text }];
  }
  return [];
}

function convertContent(
  content: string | ResponsesContentPart[] | undefined
): Anthropic.ContentBlockParam[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) =>
    part && typeof part === "object" ? convertContentPart(part) : []
  );
}

function normalizeRole(role: string | undefined): "user" | "assistant" {
  return role === "assistant" ? "assistant" : "user";
}

/**
 * Convert an OpenAI Responses `input` value into Claude messages. System/
 * developer turns are folded into a user turn (callers pass the real system
 * prompt via `instructions`). Empty messages are dropped; if everything is
 * empty we emit a single benign user turn so the request is valid.
 */
export function responsesInputToClaudeMessages(
  input: ResponsesInput
): Anthropic.MessageParam[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input || "(no content)" }];
  }
  if (!Array.isArray(input)) {
    return [{ role: "user", content: "(no content)" }];
  }

  // Distinguish an array of message objects (have a `role`) from a bare array
  // of content parts.
  const looksLikeMessages = input.some(
    (item) => item && typeof item === "object" && "role" in item
  );

  const messages: Anthropic.MessageParam[] = [];

  if (looksLikeMessages) {
    for (const item of input as ResponsesInputItem[]) {
      if (!item || typeof item !== "object") continue;
      const blocks = convertContent(item.content);
      if (blocks.length === 0) continue;
      messages.push({ role: normalizeRole(item.role), content: blocks });
    }
  } else {
    const blocks = (input as ResponsesContentPart[]).flatMap((part) =>
      part && typeof part === "object" ? convertContentPart(part) : []
    );
    if (blocks.length > 0) {
      messages.push({ role: "user", content: blocks });
    }
  }

  if (messages.length === 0) {
    return [{ role: "user", content: "(no content)" }];
  }

  // Claude requires the first message to be from the user.
  if (messages[0].role !== "user") {
    messages.unshift({ role: "user", content: "(begin)" });
  }

  return messages;
}

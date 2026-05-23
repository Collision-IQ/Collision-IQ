// src/lib/openai.ts

import OpenAI from "openai";
import {
  classifyRetryableProviderError,
  type RetryableProviderErrorDetails,
} from "@/lib/ai/providerRetryableError";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}

export function classifyOpenAIProviderError(
  error: unknown,
  stage = "openai"
): RetryableProviderErrorDetails {
  return classifyRetryableProviderError(error, {
    provider: "openai",
    stage,
  });
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getOpenAIClient(), prop, receiver);
  },
});

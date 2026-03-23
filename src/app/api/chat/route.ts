export const runtime = "nodejs";

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { extractContext } from "@/lib/ai/context/extractContext";
import { classifyIntent } from "@/lib/ai/intent/classifyIntent";
import {
  runRetrieval,
  type RetrievalHit,
} from "@/lib/ai/orchestrator/retrievalOrchestrator";
import {
  getUploadedAttachments,
  saveUploadedAttachment,
} from "@/lib/uploadedAttachmentStore";

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const SYSTEM_PROMPT = `
You are a collision estimator.

Review the estimate and explain what this repair actually is.

Focus on:
- what kind of repair this is
- how the work is structured
- what stands out

Do not walk through every operation step-by-step.

Do not explain everything.

Instead:
- summarize the repair approach
- highlight key decisions (repair vs replace)
- call out anything meaningful

Keep it concise and natural.
`;

type UploadedDocument = {
  text?: string;
  filename: string;
  mime?: string;
};

type IncomingMessage = {
  role: string;
  content: unknown;
};

type ChatRequestBody = {
  messages?: IncomingMessage[];
  attachmentIds?: string[];
  attachments?: Array<{
    filename: string;
    type: string;
    text?: string;
    imageDataUrl?: string;
  }>;
};

function extractDocuments(body: ChatRequestBody): UploadedDocument[] {
  const uploadedAttachments =
    Array.isArray(body.attachments) && body.attachments.length > 0
      ? body.attachments.map((attachment) =>
          saveUploadedAttachment({
            filename: attachment.filename,
            type: attachment.type,
            text: attachment.text ?? "",
            imageDataUrl: attachment.imageDataUrl,
          })
        )
      : getUploadedAttachments(body.attachmentIds || []);

  return uploadedAttachments.map((attachment) => ({
    filename: attachment.filename,
    mime: attachment.type,
    text: attachment.text,
  }));
}

function extractFallbackUserMessage(messages: IncomingMessage[] = []): string {
  const lastUserMessage =
    [...messages]
      .reverse()
      .find((message) => message?.role === "user" && typeof message?.content === "string") ?? null;

  return lastUserMessage && typeof lastUserMessage.content === "string"
    ? lastUserMessage.content
    : "";
}

function extractTotalsLite(text: string): string {
  const laborMatches = text.match(/(\d+\.\d+)\s*hrs/g);
  return laborMatches ? laborMatches.slice(0, 3).join(", ") : "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const documents = extractDocuments(body);
    const attachedContext = documents
      .map((document) => document.text || "")
      .filter(Boolean)
      .join("\n\n");
    const estimateText = attachedContext;
    const fallbackUserMessage = extractFallbackUserMessage(body.messages || []);
    const userInput = estimateText || fallbackUserMessage;
    const intent = classifyIntent(fallbackUserMessage, documents.length > 0);
    const contextBlock = `
[Context for reasoning]

When relevant, consider:
- labor hours vs repair scope (are they realistic?)
- part types (OEM vs aftermarket) and implications
- whether the repair approach aligns with proper procedures

Do not force these - only use them if they matter.
`.trim();
    const totalsBlock = `
[Estimate totals reference]
Labor entries detected: ${extractTotalsLite(estimateText)}
`.trim();

    let matches: RetrievalHit[] = [];
    const shouldRunRetrieval =
      intent === "estimate_review" || intent === "estimate_compare";

    if (shouldRunRetrieval && userInput) {
      const retrievalContext = extractContext(userInput);
      matches = await runRetrieval({
        query: fallbackUserMessage || "estimate review",
        ...retrievalContext,
      });
    }

    const retrievalText = matches
      .slice(0, 3)
      .map((match) => match.content)
      .join("\n\n");
    const retrievalBlock = retrievalText
      ? `[Relevant reference information]\n${retrievalText}`
      : "";

    const response = await openai.responses.create({
      model: "gpt-4o",
      temperature: 0.4,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "system",
          content: [{ type: "input_text", text: contextBlock }],
        },
        {
          role: "system",
          content: [{ type: "input_text", text: totalsBlock }],
        },
        ...(retrievalBlock
          ? [
              {
                role: "system" as const,
                content: [{ type: "input_text" as const, text: retrievalBlock }],
              },
            ]
          : []),
        {
          role: "user",
          content: [{ type: "input_text", text: userInput }],
        },
      ],
    });

    const outputText =
      "output_text" in response && typeof response.output_text === "string"
        ? response.output_text
        : "";

    return new Response(outputText, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Chat route error:", error);
    const message = error instanceof Error ? error.message : "Chat failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

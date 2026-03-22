export const runtime = "nodejs";

import OpenAI from "openai";
import { NextResponse } from "next/server";
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
- how the work is being performed
- what matters about it

Ignore:
- vehicle details
- administrative lines
- generic estimate sections

Do not walk through every step.

Instead:
- identify the repair type
- explain the structure of the job
- highlight what stands out

Write naturally, like you're discussing the repair with another estimator.

Keep it clear, concise, and grounded in the estimate.
Avoid explaining every step unless it adds value.
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const documents = extractDocuments(body);
    const attachedContext = documents
      .map((document) => document.text || "")
      .filter(Boolean)
      .join("\n\n");
    const fallbackUserMessage = extractFallbackUserMessage(body.messages || []);
    const userInput = attachedContext || fallbackUserMessage;

    const response = await openai.responses.create({
      model: "gpt-4o",
      temperature: 0.4,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
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

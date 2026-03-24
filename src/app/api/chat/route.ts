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

const MODEL = process.env.COLLISION_IQ_MODEL || "gpt-5.4";

type UploadedDocument = {
  filename: string;
  mime?: string;
  text?: string;
  imageDataUrl?: string;
};

type MessageContentPart = {
  type?: string;
  text?: string;
};

type IncomingMessage = {
  role: string;
  content: unknown;
};

type IncomingAttachment = {
  filename: string;
  type: string;
  text?: string;
  imageDataUrl?: string;
};

type ChatRequestBody = {
  messages?: IncomingMessage[];
  attachmentIds?: string[];
  attachments?: IncomingAttachment[];
};

const SYSTEM_INSTRUCTIONS = `
You are Collision-IQ, a senior collision estimator and repair strategist.

Think like a real estimator, not a narrator.

If the user asks a direct question, answer that question directly.

When estimates, repair documents, photos, scans, OEM material, or related files are attached:
- understand the repair strategy before answering
- focus on what materially matters, not line-by-line coverage
- pay closest attention to labor realism, access burden, repair vs replace posture, structural or safety implications, scan and calibration relevance, and estimate completeness
- identify what is actually driving the cost: visible damage, hidden damage potential, access, procedure, electronics, setup, teardown, or estimating style
- make soft professional judgments when supported: light, heavy, conservative, aggressive, efficient, incomplete, access-driven, damage-driven, overbuilt, underwritten
- infer the likely repair path behind the listed operations when reasonable
- compare estimating posture and repair strategy when multiple estimates are present
- when useful, say which estimate is stronger and why
- use OEM or procedure context only when it materially changes the conclusion
- do not paraphrase the estimate line by line
- do not try to mention everything
- be concise, natural, and direct

When no documents are attached:
- answer as a collision repair intelligence assistant for VIN decoding, OEM procedures, part questions, structural questions, diminished value, negotiation strategy, total loss logic, and general automotive knowledge

For ACV or diminished value answers:
- you may provide a rough preview range when the current material supports it
- do not present any ACV or diminished value result as a final appraisal, final ACV, or binding diminished value conclusion
- if you provide a number or range, label it as a preliminary preview
- mention confidence and missing inputs when they materially limit the preview
- if the value is not determinable, explain why and list the key missing inputs when possible
- every ACV or diminished value answer must end with: For a full valuation, continue at https://www.collision.academy/

Write in short paragraphs.
Use bullets only when they genuinely improve comparison, negotiation, or rebuttal clarity.
Avoid rigid templates.
`.trim();

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const candidate = part as MessageContentPart;
          return typeof candidate.text === "string" ? candidate.text : "";
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractLatestUserMessage(messages: IncomingMessage[] = []): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message?.role === "user");

  return lastUserMessage ? extractTextContent(lastUserMessage.content).trim() : "";
}

function formatRecentConversation(messages: IncomingMessage[] = []): string {
  return messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .slice(-8)
    .map((message) => {
      const content = extractTextContent(message.content).trim();
      if (!content) return "";
      return `${message.role.toUpperCase()}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

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
    imageDataUrl: attachment.imageDataUrl,
  }));
}

function formatDocuments(documents: UploadedDocument[]): string {
  return documents
    .map((document, index) => {
      const label = `Attachment ${index + 1}: ${document.filename}${
        document.mime ? ` (${document.mime})` : ""
      }`;

      const textBlock = document.text?.trim()
        ? document.text.trim()
        : "[No extracted text available]";

      return `### ${label}\n${textBlock}`;
    })
    .join("\n\n---\n\n");
}

function buildModelInput(params: {
  userMessage: string;
  conversationContext: string;
  documents: UploadedDocument[];
}): string {
  const sections: string[] = [];

  if (params.userMessage) {
    sections.push(`User request:\n${params.userMessage}`);
  }

  if (params.conversationContext) {
    sections.push(`Recent conversation:\n${params.conversationContext}`);
  }

  if (params.documents.length > 0) {
    sections.push(`Attached documents:\n${formatDocuments(params.documents)}`);
  }

  if (sections.length === 0) {
    sections.push("No user message or document text was provided.");
  }

  return sections.join("\n\n");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;

    const documents = extractDocuments(body);
    const userMessage = extractLatestUserMessage(body.messages || []);
    const conversationContext = formatRecentConversation(body.messages || []);
    const input = buildModelInput({
      userMessage,
      conversationContext,
      documents,
    });

    const response = await openai.responses.create({
      model: MODEL,
      instructions: SYSTEM_INSTRUCTIONS,
      temperature: 0.7,
      input,
    });

    const outputText =
      typeof response.output_text === "string" && response.output_text.trim()
        ? response.output_text.trim()
        : "I reviewed the material, but I couldn't generate a usable response.";

    return new Response(outputText, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Chat route error:", error);

    const message =
      error instanceof Error ? error.message : "Unexpected chat route failure.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/*
Vibe coding notes:
- This keeps chat clean. No classifier goblin. No builder maze. No prompt lasagna.
- The user's actual question always goes to the model, even when attachments exist.
- Attachments stay labeled, so comparisons stop becoming document soup.
- The model is told to evaluate repair strategy, not cosplay as a PDF narrator.
- This is the right base before adding stage-two OEM / Drive retrieval.

Best next upgrade:
1. first pass = estimate judgment
2. conditional retrieval = OEM / Drive / web only when needed
3. second pass = refined answer

That gives you estimator brain first, context second.
*/

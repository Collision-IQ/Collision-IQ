import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // Required for Vercel streaming

// 🔐 Environment safety check
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const messages = body.messages || [];
    const documents = body.documents || [];

    // 🔹 Combine uploaded document text (if any)
    let documentText = "";

    type UploadedDocument = {
      text?: string;
    };

    if (Array.isArray(documents) && documents.length > 0) {
      documentText = (documents as UploadedDocument[])
      .map((doc) => doc.text ?? "")
      .join("\n\n");
    }

    // 🔹 Basic safety cap to prevent token overflow
    const MAX_CHARS = 12000;
    const safeDocumentText = documentText.slice(0, MAX_CHARS);

    // 🔹 Build final message array
    const finalMessages = [
      {
        role: "system",
        content:
          "You are a professional collision repair analyst. Provide structured, accurate, and practical analysis. If a document is provided, use it as the primary source of truth.",
      },
      ...(safeDocumentText
        ? [
            {
              role: "system",
              content: `Attached Document Context:\n\n${safeDocumentText}`,
            },
          ]
        : []),
      ...messages,
    ];

    // 🔹 Create streaming completion
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: finalMessages,
      temperature: 0.3,
      stream: true,
    });

    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(content));
              }
            }
          } catch (streamError) {
            console.error("Streaming error:", streamError);
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("Chat route error:", error);
    return NextResponse.json(
      { error: "Chat failed." },
      { status: 500 }
    );
  }
}

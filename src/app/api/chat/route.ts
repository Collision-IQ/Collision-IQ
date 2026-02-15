import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.3,
      stream: true,
    });

    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
          controller.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain",
        },
      }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Chat failed." }, { status: 500 });
  }
}

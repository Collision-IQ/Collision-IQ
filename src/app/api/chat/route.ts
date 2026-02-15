import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return Response.json(
        { error: "Invalid messages payload." },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.4, // More professional, less random
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: `
You are Collision IQ — an expert automotive appraisal and OEM procedure assistant.

Guidelines:
- Provide structured responses.
- Use clear section headers.
- Follow OEM logic.
- Prioritize safety.
- If ADAS is involved, mention recalibration requirements.
- Do NOT hallucinate torque specs.
- When unsure, state assumptions clearly.
- Respond like a professional shop foreman or collision estimator.
          `,
        },
        ...messages,
      ],
    });

    const reply = completion.choices?.[0]?.message?.content;

    if (!reply) {
      return Response.json(
        { error: "No response from model." },
        { status: 500 }
      );
    }

    return Response.json({ reply });

  } catch (err: unknown) {
    console.error("OpenAI error:", err);

    let errorMessage = "AI connection failed.";

    if (err instanceof Error) {
      errorMessage = err.message;
    }

    return Response.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

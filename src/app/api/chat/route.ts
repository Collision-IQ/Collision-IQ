import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return Response.json(
        { error: "Invalid messages payload." },
        { status: 400 }
      );
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Level 5 reasoning model
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are Collision IQ — an expert automotive appraisal and OEM procedure analysis assistant. Provide professional, structured, technically accurate responses. Avoid vague replies.",
        },
        ...messages,
      ],
    });

    const reply = response.choices?.[0]?.message?.content;

    if (!reply) {
      return Response.json(
        { error: "No response from OpenAI." },
        { status: 500 }
      );
    }

    return Response.json({ reply });
  } catch (error: any) {
    console.error("OpenAI error:", error);

    return Response.json(
      { error: "AI connection failed." },
      { status: 500 }
    );
  }
}

import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body.messages)
      ? body.messages
      : [];

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || !last.content?.trim()) {
      return new Response(
        JSON.stringify({ error: "Missing user message" }),
        { status: 400 }
      );
    }

    const systemInstructions = `
You are Collision-IQ, the official assistant for Collision Academy.

Purpose:
- Help repair centers and policyholders demand safe, OEM-compliant repairs.
- Reference OEM documentation concepts and insurance policy practices.
- Do NOT provide legal advice.
- Provide educational guidance, checklists, and next steps.

Behavior:
- Be concise, professional, and action-oriented.
- Ask clarifying questions when key claim info is missing.
`;

    const history = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: systemInstructions,
        },
        {
          role: "user",
          content: history,
        },
      ],
    });

    return new Response(
      JSON.stringify({
        reply: response.output_text,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500 }
    );
  }
}

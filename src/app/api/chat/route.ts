import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

function buildSystemInstructions() {
  return `
You are Collision-IQ, the official assistant for Collision Academy.

Mission:
- Help repair centers and policyholders demand safe, OEM-compliant repairs.
- Provide documentation-first guidance: what to ask for, what to reference, what to do next.
- You may discuss general insurance policy practices and repair standards.
- You do NOT provide legal advice. Do not claim to be an attorney. Encourage consulting a qualified professional for legal counsel.

Style:
- Professional, concise, action-oriented.
- Prefer bullet points, checklists, and clear next steps.
- Ask 1–3 clarifying questions if missing key facts (state, carrier, vehicle, estimate, goal).

Safety / Guardrails:
- Do not instruct wrongdoing.
- Avoid sensitive personal data; request only what’s necessary (no SSNs, etc.).
`;
}

function toTranscript(messages: ClientMessage[]) {
  // Keep history small (cost + speed + safety)
  const trimmed = messages.slice(-12);
  return trimmed
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "Server misconfigured: missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as { messages?: ClientMessage[] };
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || !last.content?.trim()) {
      return Response.json(
        { error: "Missing user message." },
        { status: 400 }
      );
    }

    const system = buildSystemInstructions();
    const transcript = toTranscript(messages);

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: transcript },
      ],
    });

    return Response.json(
      { reply: response.output_text ?? "" },
      { status: 200 }
    );
  } catch (err: any) {
    return Response.json(
      {
        error: "Chat request failed.",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}

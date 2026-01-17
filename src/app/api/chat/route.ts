import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

// Server-side, legal-safe system prompt
const SYSTEM_PROMPT = `
You are Collision-IQ, the official assistant for Collision Academy.

ROLE
- Provide documentation-first guidance for OEM-compliant repairs and claim strategy.
- Serve repair centers and policyholders.
- Focus on safe repairs, OEM procedures, estimate review strategy, and clear next steps.

SCOPE (you may help with)
- OEM repair planning concepts (procedures, position statements, safety systems)
- Diminished Value (DV) documentation basics
- Total loss dispute strategy (comps, condition, options, documentation)
- Right to Appraisal (RTA) process explanations (high-level)
- Communication strategy with carriers/adjusters/shops
- Checklists and what documents to request

LEGAL / SAFETY
- You are NOT an attorney and do NOT provide legal advice.
- Do not draft threats/harassment or instructions for wrongdoing.
- Do not guarantee outcomes or claim certainty about laws.
- If legal interpretation is requested, provide general info and recommend a qualified professional.

STYLE
- Professional, concise, calm.
- Prefer bullet points, checklists, and step-by-step actions.
- Ask 1–3 clarifying questions if key facts are missing.

RESPONSE FORMAT
1) Quick assessment (1–2 sentences)
2) Clarifying questions (if needed)
3) Documentation-based guidance (bullets)
4) Next steps checklist (bullets)
5) Optional: when to upload documents / choose a package

DATA HANDLING
- Ask only for what’s necessary. Do not request SSN, banking, or unnecessary personal data.
`;

// Keep history small (cost/speed) but enough for continuity
function normalizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: ClientMessage[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as any).role;
    const content = (item as any).content;

    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;

    const trimmed = content.trim();
    if (!trimmed) continue;

    cleaned.push({ role, content: trimmed });
  }

  // Keep last 12 messages
  return cleaned.slice(-12);
}

function buildTranscript(messages: ClientMessage[]) {
  // Transcript approach keeps the API simple + deterministic.
  // Later you can switch to structured tool calls if needed.
  return messages
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

    const body = await req.json().catch(() => ({}));
    const messages = normalizeMessages((body as any).messages);

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") {
      return Response.json(
        { error: "Missing user message." },
        { status: 400 }
      );
    }

    const transcript = buildTranscript(messages);

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      // Optional tuning:
      temperature: 0.2,
      max_output_tokens: 650,
    });

    return Response.json(
      {
        reply: resp.output_text ?? "",
      },
      { status: 200 }
    );
  } catch (err: any) {
    // Never leak secrets. Keep message safe for the UI.
    const message = err?.message ?? String(err);

    // Common issue: model name, key, billing, rate limit, etc.
    // We return a short UI-safe error, and include `detail` for your local debugging.
    return Response.json(
      {
        error: "Chat request failed.",
        detail: message,
      },
      { status: 500 }
    );
  }
}

// Optional: explicitly reject other methods cleanly
export async function GET() {
  return Response.json({ error: "Method Not Allowed" }, { status: 405 });
}

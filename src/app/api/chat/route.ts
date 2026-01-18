// src/app/api/chat/route.ts
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel: allows longer streaming if needed (optional)
// export const maxDuration = 60;

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ClientMessage = { role: "user" | "assistant"; content: string };
type ClientDocument = { name?: string; text: string };

const SYSTEM_PROMPT = `
You are Collision-IQ, the official assistant for Collision Academy.

You provide documentation-first guidance for OEM-compliant repairs and claim strategy.
You are NOT an attorney. You do NOT provide legal advice. You do not guarantee outcomes.
Ask for missing details (state, carrier, vehicle year/make/model, goal, estimate/supplement).
Prefer bullet points, checklists, and next steps.

When documents are provided, cite them as: [Doc: <name>] and quote short excerpts.
If doc content is insufficient, say so and ask for what’s missing.
`.trim();

function normalizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m: any) =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m?.content === "string"
    )
    .map((m: any) => ({ role: m.role, content: String(m.content).trim() }))
    .filter((m: ClientMessage) => m.content.length > 0)
    .slice(-12);
}

function clampText(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}

function buildDocContext(docs: ClientDocument[]) {
  if (!Array.isArray(docs) || docs.length === 0) return "";

  // Hard safety limits: keep context bounded
  const MAX_DOCS = 6;
  const MAX_DOC_CHARS_EACH = 25_000;

  const selected = docs.slice(0, MAX_DOCS).map((d, i) => {
    const name = (d?.name ?? `Document ${i + 1}`).slice(0, 80);
    const text = clampText(String(d?.text ?? ""), MAX_DOC_CHARS_EACH);
    return `---\n[Doc: ${name}]\n${text}\n`;
  });

  return `\n\nDOCUMENTS PROVIDED BY USER:\n${selected.join("\n")}\n---\n`;
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const messages = normalizeMessages((body as any).messages);
  const documents = Array.isArray((body as any).documents)
    ? ((body as any).documents as ClientDocument[])
    : [];

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "No messages provided" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const docContext = buildDocContext(documents);

  // We stream as SSE so your UI can read chunks reliably
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        // Include doc context in system prompt (bounded)
        const system = SYSTEM_PROMPT + docContext;

        const completion = await openai.chat.completions.create({
          model: MODEL,
          temperature: 0.2,
          stream: true,
          messages: [{ role: "system", content: system }, ...messages],
        });

        send("meta", { model: MODEL });

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) send("delta", { text: delta });
        }

        send("done", {});
        controller.close();
      } catch (err: any) {
        send("error", { message: err?.message ?? String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

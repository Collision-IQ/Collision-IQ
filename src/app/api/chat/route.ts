import OpenAI from "openai";
import { NextResponse } from "next/server";
import { mcpCallTool } from "@/lib/mcpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `
You are Collision-IQ, the official assistant for Collision Academy.

You provide documentation-first guidance for OEM-compliant repairs and claim strategy.
You are NOT an attorney. You do NOT provide legal advice. You do not guarantee outcomes.
Ask for missing details (state, carrier, vehicle year/make/model, goal, estimate/supplement).
Prefer bullet points, checklists, and next steps.
`.trim();

function normalizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => m?.role && typeof m?.content === "string")
    .map((m: any) => ({ role: m.role, content: String(m.content).trim() }))
    .filter((m: ClientMessage) => (m.role === "user" || m.role === "assistant") && m.content.length > 0)
    .slice(-12);
}

function transcript(messages: ClientMessage[]) {
  return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
}

// Very simple router: if the user pasted CSV, call MCP parse_csv.
// Later we will upgrade to true model tool-calling.
function looksLikeCsv(text: string) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return false;
  // crude heuristic: at least one comma in first line and 2nd line
  return lines[0].includes(",") && lines[1].includes(",");
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const messages = normalizeMessages((body as any).messages);

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") {
      return NextResponse.json({ error: "Missing user message." }, { status: 400 });
    }

    let toolContext = "";

    // If user pasted CSV, parse with MCP tool
    if (looksLikeCsv(last.content)) {
      const toolResult = await mcpCallTool({
        toolName: "parse_csv",
        args: { csvText: last.content, maxRows: 50 },
      });

      toolContext += `\n\n[MCP TOOL: parse_csv result]\n${JSON.stringify(toolResult, null, 2)}\n`;
    }

    // If user is asking for doc review but pasted plain text, we can generate checklist
    if (last.content.length > 400 && /estimate|supplement|policy|procedure/i.test(last.content)) {
      const toolResult = await mcpCallTool({
        toolName: "document_review_checklist",
        args: { docType: "other", text: last.content },
      });

      toolContext += `\n\n[MCP TOOL: document_review_checklist result]\n${JSON.stringify(toolResult, null, 2)}\n`;
    }

    const prompt = `${SYSTEM_PROMPT}\n\nConversation:\n${transcript(messages)}\n${toolContext}\n\nASSISTANT:`;

    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
      temperature: 0.2,
      max_output_tokens: 750,
    });

    return NextResponse.json({ reply: resp.output_text ?? "" }, { status: 200 });
  } catch (err: any) {
    console.error("POST /api/chat failed:", err);
    return NextResponse.json(
      { error: "Chat request failed.", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

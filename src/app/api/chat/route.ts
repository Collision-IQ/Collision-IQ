import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createMcpBridge } from "@/lib/mcpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

Tool use:
- You MAY call parse_csv only when the user provides CSV text or explicitly asks for CSV parsing.
- Do not invent CSV rows. If incomplete/malformed, ask for clarification.
`.trim();

function normalizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => m?.role && typeof m?.content === "string")
    .map((m: any) => ({ role: m.role, content: String(m.content).trim() }))
    .filter(
      (m: ClientMessage) =>
        (m.role === "user" || m.role === "assistant") && m.content.length > 0
    )
    .slice(-12);
}

function clampText(text: string, maxChars: number) {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function safeJsonParse(input: unknown) {
  if (typeof input !== "string") return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const messages = normalizeMessages((body as any).messages);

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") {
      return NextResponse.json(
        { error: "Missing user message." },
        { status: 400 }
      );
    }

    // Guardrails: keep pasted content from exploding tokens
    const MAX_MSG_CHARS = 60_000;
    const boundedMessages = messages.map((m) => ({
      ...m,
      content: clampText(m.content, MAX_MSG_CHARS),
    }));

    const mcp = await createMcpBridge();
    try {
      const toolsList = await mcp.client.listTools();

      // Read-only allowlist
      const ALLOWED = new Set(["parse_csv"]);

      // Expose only allowlisted MCP tools to the model
      const tools = (toolsList.tools ?? [])
        .filter((t: any) => ALLOWED.has(t.name))
        .map((t: any) => ({
          type: "function" as const,
          name: t.name,
          description: t.description ?? "",
          parameters: t.inputSchema ?? { type: "object", properties: {} },
        }));

      const input = [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        ...boundedMessages.map((m) => ({
          role: m.role,
          content: [{ type: "input_text", text: m.content }],
        })),
      ];

      // Initial call
      let resp = await openai.responses.create({
        model: "gpt-4o-mini",
        input: input as any,
        tools: tools as any,
        temperature: 0.2,
        max_output_tokens: 750,
      });

      // ---- Tool loop ----
      while (true) {
        // TS FIX: OpenAI SDK typing may not include function_call shape.
        // We treat output as runtime objects and narrow manually.
        const output = ((resp as any).output ?? []) as any[];

        const calls = output.filter((o) => o?.type === "function_call") as any[];
        if (calls.length === 0) break;

        const toolOutputs: any[] = [];

        for (const call of calls) {
          const toolName = String(call.name ?? "");
          const callId = String(call.call_id ?? "");

          if (!ALLOWED.has(toolName)) {
            toolOutputs.push({
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({ error: `Tool not allowed: ${toolName}` }),
            });
            continue;
          }

          const args =
            typeof call.arguments === "string"
              ? safeJsonParse(call.arguments) ?? {}
              : (call.arguments ?? {});

          // clamp CSV payloads
          if (toolName === "parse_csv" && typeof args?.csvText === "string") {
            args.csvText = clampText(args.csvText, 120_000);
          }

          try {
            const result = await mcp.client.callTool({
              name: toolName,
              arguments: args,
            });

            toolOutputs.push({
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(result),
            });
          } catch (e: any) {
            toolOutputs.push({
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                error: e?.message ?? "Tool call failed",
              }),
            });
          }
        }

        // Continue with tool outputs
        resp = await openai.responses.create({
          model: "gpt-4o-mini",
          input: [
            ...input,
            // Include tool outputs as tool messages
            ...toolOutputs.map((t) => ({
              role: "tool",
              tool_call_id: t.call_id,
              content: [{ type: "output_text", text: t.output }],
            })),
          ] as any,
          temperature: 0.2,
          max_output_tokens: 750,
        });
      }

            return NextResponse.json(
        { reply: (resp as any).output_text ?? "" },
        { status: 200 }
      );
    } finally {
      await mcp.close();
    }
  } catch (err: any) {
    console.error("POST /api/chat failed:", err);
    return NextResponse.json(
      { error: "Chat request failed.", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}


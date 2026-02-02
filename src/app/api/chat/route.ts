// src/app/api/chat/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

/**
 * COLLISION IQ — PROFESSIONAL SYSTEM CONTEXT (PHASE 2+)
 * This defines the assistant’s role, scope, and guardrails.
 * Update this text when services or positioning change.
 */
const SYSTEM_CONTEXT: ChatMessage = {
  role: "system",
  content: `
You are Collision IQ, a professional automotive insurance claim assistant for Collision Academy.

PRIMARY ROLE:
You function like an experienced claims and repair support professional. You help policyholders,
repair facilities, and industry stakeholders with:
- Claim handling best practices and documentation standards
- Damage analysis and professional appraisal principles
- Vehicle valuation methodology (including total loss and diminished value concepts)
- OEM-aligned repair planning considerations (procedures, position statements, safety steps)
- Clear explanations of how insurance claims typically work

NOT LEGAL ADVICE:
You are not a lawyer and must not provide legal advice. You may explain general concepts and
typical processes, but you must encourage users to consult qualified professionals (e.g., an attorney,
public adjuster where permitted, or their state department of insurance) for legal interpretation or disputes.

POLICY VS INSURANCE LAW (IMPORTANT DISTINCTION):
- "Policy language" is the contract between the insured and the carrier (declarations, endorsements,
  exclusions, conditions). Help users understand how to locate and read relevant sections, but do not
  claim definitive interpretation without the actual policy text.
- "Insurance law" generally refers to statutes and regulations governing insurers and claim practices,
  which can vary by state. You may describe common patterns (timelines, good-faith handling concepts,
  appraisal clauses), but must clearly state that requirements vary by jurisdiction and policy.

STATE-AWARE GUIDANCE:
When a question depends on legal/regulatory details (appraisal rights, claim timelines, total loss rules,
diminished value availability, unfair claims practices, etc.), you should ask for:
1) The user’s state (and sometimes the loss location if different),
2) The insurer (optional but helpful),
3) Claim type (first-party vs third-party), and
4) Vehicle year/make/model (if valuation/repair-related).
Then give general guidance and explicitly note: "This varies by state and policy language."

OEM SOURCE DISCLAIMERS:
- You may provide high-level OEM-aligned guidance (safe repair approach, documentation best practices,
  ADAS considerations, calibration/scan principles, typical component R&R planning steps).
- Do not imply you are quoting proprietary OEM service information unless the user provides it.
- When exact OEM procedures/torque specs/calibration steps are required, instruct users to reference the
  OEM service information system or a verified repair database, or to provide the relevant OEM text for review.
- Emphasize safety and verification: ADAS calibrations, structural repairs, weld/bond procedures, and
  scan/calibration steps require verified documentation and qualified execution.

COLLISION ACADEMY SERVICES (SUPPORTING ROLE — NOT A SALES PITCH):
Collision Academy offers professional documentation and valuation services that can support users when
formal insurer-facing deliverables are needed:
- Diminished Value documentation
- Total Loss Value Dispute support
- Right to Appraisal process guidance

BEHAVIOR GUIDELINES:
- Be accurate, neutral, and practical. Prioritize education and next-step clarity.
- Do not invent services, pricing, laws, or OEM procedures.
- If information is uncertain or jurisdiction-specific, say so and ask clarifying questions (especially state).
- When appropriate, suggest documentation the user should gather (estimate, supplement, photos, policy,
  valuation report, CCC/Mitchell/Audatex report, repair plan, scan results, OEM position statements).
- Keep responses structured and actionable (checklists, steps, “what to ask the insurer/body shop,” etc.).
`.trim(),
};

function normalizeMessages(body: any): ChatMessage[] {
  if (Array.isArray(body?.messages) && body.messages.length) {
    return body.messages
      .filter(
        (m: any) =>
          m &&
          typeof m.content === "string" &&
          typeof m.role === "string"
      )
      .map((m: any) => ({
        role: m.role as ChatRole,
        content: m.content,
      }));
  }

  if (typeof body?.message === "string" && body.message.trim()) {
    return [{ role: "user", content: body.message.trim() }];
  }

  return [];
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY" },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userMessages = normalizeMessages(body);

  if (!userMessages.length) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }

  const messages: ChatMessage[] = [SYSTEM_CONTEXT, ...userMessages];

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "OpenAI request failed", status: upstream.status, details: text },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n").map((l) => l.trim());
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;

              const data = line.replace(/^data:\s*/, "");
              if (data === "[DONE]") {
                controller.close();
                return;
              }

              try {
                const json = JSON.parse(data);
                const delta: string | undefined = json?.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                // Ignore malformed chunks
              }
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
